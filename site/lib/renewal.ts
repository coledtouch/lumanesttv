import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {bunny, settings, ServiceError} from './mybunny.ts';
import {db, createCheckout, paypalReady} from './paypal.ts';
import {open, seal, digest} from './player-crypto.ts';
import {plans, periods, retailPrice} from './plans.ts';
import {portalReady, renewalOffer, walletCanActivate} from './provider-readiness.ts';

export const RENEWAL_COOKIE = '__Secure-lumanest_renewal';
const COOKIE_PATH = '/api/player/renew';
const SESSION_SECONDS = 60 * 60;
const QUOTE_SECONDS = 15 * 60;
const MAX_BODY_BYTES = 2048;
export const RENEWAL_EXPIRED_COOKIE = `${RENEWAL_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

type RenewalSession = {purpose: 'lumanest-renewal-v1'; lineId: number; username: string; credential: string; exp: number};
type QuoteSession = {purpose: 'lumanest-renewal-quote-v1'; lineId: number; devices: number; credential: string; amounts: number[]; lineStatus: string; expiresAt: string | null; exp: number};
export type RenewalLine = {id: number; username: string; password: string; devices: number; status: string; on_site: boolean; expires_at?: string; days_left?: number; prices?: {renew?: {months: number; price: number | string}[]}};
type RenewalOffer = {months: number; amount: number; currency: 'USD'; available: boolean};
export type RenewalQuote = {line: {username: string; devices: number; status: string; expires_at: string | null; days_left: number | null}; offers: RenewalOffer[]; quote_token: string; checkout_available: boolean; message: string | null};

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/),
  password: z.string().min(1).max(150).regex(/^[^\x00-\x1f\x7f]+$/)
}).strict();
const checkoutSchema = z.object({
  months: z.number().refine(value => periods.includes(value as 3 | 6 | 12)),
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(100).regex(/^[^\x00-\x1f\x7f]*$/).default(''),
  quoteToken: z.string().min(1).max(MAX_BODY_BYTES)
}).strict();

function unavailable() {return new ServiceError(503, 'renewal_unavailable', 'Renewal is temporarily unavailable. Please try again shortly or contact support.');}
function invalidLogin() {return new ServiceError(401, 'invalid_line_login', 'The line login was not accepted. Check your line username and password.');}
function expiredSession() {return new ServiceError(401, 'renewal_sign_in_required', 'Sign in with your current line login to renew.');}
function changedQuote() {return new ServiceError(409, 'renewal_quote_changed', 'Your renewal options changed or expired. Refresh your options and review the total before continuing. No payment has been taken.');}
function secret() {
  const value = settings().PLAYER_COOKIE_KEY || '';
  if (!/^[a-f0-9]{64}$/.test(value)) throw unavailable();
  return value;
}
function equalDigest(left: string, right: string) {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function credentialDigest(username: string, password: string) {
  return digest('lumanest-renewal-credential-v1:' + JSON.stringify([username, password]));
}
async function providerRead(path: string, missing?: () => ServiceError): Promise<unknown> {
  await throttle('provider-read', 'shared', 60, 60 * 1000);
  try {return await bunny(path);}
  catch (error) {
    if (missing && error instanceof ServiceError && [404, 410].includes(error.status)) throw missing();
    throw unavailable();
  }
}
function renewableLine(value: unknown, allowIneligible = false): RenewalLine | null {
  if (!value || typeof value !== 'object') return null;
  const line = value as Partial<RenewalLine>;
  if (!Number.isSafeInteger(line.id) || Number(line.id) <= 0 || typeof line.username !== 'string' || line.username.length < 1 || line.username.length > 100 ||
    typeof line.password !== 'string' || line.password.length < 1 || line.password.length > 150 || !plans.some(plan => plan.devices === line.devices) ||
    typeof line.status !== 'string' || typeof line.on_site !== 'boolean' || (!allowIneligible && (!['active', 'expired'].includes(line.status) || line.on_site !== true))) return null;
  return line as RenewalLine;
}

// The existing anti-abuse table stores only a purpose-specific hash, never an IP or line login.
async function throttle(purpose: string, subject: string, maximum: number, window = 15 * 60 * 1000) {
  const now = Date.now(), bucket = Math.floor(now / window);
  const id = await digest(JSON.stringify(['renewal-v1', purpose, subject, bucket]));
  try {
    await db().prepare('DELETE FROM player_login_attempts WHERE expires<?').bind(now).run();
    await db().prepare('INSERT INTO player_login_attempts (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').bind(id, now + 2 * window).run();
    const attempts = await db().prepare('SELECT count FROM player_login_attempts WHERE id=?').bind(id).first<{count: number}>();
    if (!attempts || !Number.isSafeInteger(attempts.count)) throw unavailable();
    if (attempts.count > maximum) throw new ServiceError(429, 'renewal_rate_limit', window === 60 * 1000 ? 'Renewal is busy. Please try again in one minute.' : 'Too many renewal attempts. Please try again in 15 minutes.', String(window / 1000));
  } catch (error) {if (error instanceof ServiceError) throw error; throw unavailable();}
}
function client(req: Request) {return req.headers.get('cf-connecting-ip') || 'unknown';}

export async function readRenewalJSON(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw new ServiceError(415, 'json_required', 'Send this form as JSON.');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ServiceError(413, 'request_too_large', 'This renewal request is too large.');
  const reader = req.body?.getReader();
  if (!reader) throw new ServiceError(400, 'invalid_request', 'Complete the renewal form.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {await reader.cancel(); throw new ServiceError(413, 'request_too_large', 'This renewal request is too large.');}
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(400, 'invalid_request', 'Complete the renewal form.');
  } finally {reader.releaseLock();}
}

export async function ownLine(req: Request, allowIneligible = false): Promise<RenewalLine> {
  const values = (req.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(RENEWAL_COOKIE + '='));
  if (values.length !== 1) throw expiredSession();
  let session: RenewalSession;
  try {session = await open<RenewalSession>(values[0].slice(RENEWAL_COOKIE.length + 1), secret());}
  catch (error) {if (error instanceof ServiceError) throw error; throw expiredSession();}
  if (!session || session.purpose !== 'lumanest-renewal-v1' || !Number.isSafeInteger(session.lineId) || session.lineId <= 0 ||
    typeof session.username !== 'string' || session.username.length < 1 || session.username.length > 100 ||
    typeof session.credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session.credential) ||
    !Number.isFinite(session.exp) || session.exp <= Date.now() || session.exp > Date.now() + SESSION_SECONDS * 1000) throw expiredSession();
  // This subject is taken only from a valid encrypted session, before spending a provider request.
  await throttle('session-line', String(session.lineId), 30);
  const line = renewableLine(await providerRead('/lines/' + session.lineId, expiredSession), allowIneligible);
  if (!line || line.id !== session.lineId || line.username !== session.username || !equalDigest(session.credential, await credentialDigest(line.username, line.password))) throw expiredSession();
  return line;
}

export function lineExpiry(line: RenewalLine) {
  return typeof line.expires_at === 'string' && Number.isFinite(Date.parse(line.expires_at)) ? new Date(line.expires_at).toISOString() : null;
}
export async function quote(line: RenewalLine): Promise<RenewalQuote> {
  const offers = periods.map(months => ({months, amount: retailPrice(line.devices, months), currency: 'USD' as const, available: false}));
  let ready = false;
  if (paypalReady() && line.on_site === true && ['active', 'expired'].includes(line.status)) {
    const account = await providerRead('/account') as {balance?: unknown; site?: {status?: string; address?: string}};
    if (portalReady(account?.site, settings().CUSTOMER_PORTAL_URL, settings().CUSTOMER_PORTAL_PRIMARY_URL)) {
      for (const offer of offers) {
        try {offer.available = walletCanActivate(account.balance, renewalOffer(line, offer.months).cost);}
        catch {offer.available = false;}
      }
      ready = offers.some(offer => offer.available);
    }
  }
  return {
    line: {username: line.username, devices: line.devices, status: line.status,
      expires_at: lineExpiry(line),
      days_left: typeof line.days_left === 'number' && Number.isFinite(line.days_left) ? line.days_left : null},
    offers, quote_token: await seal({purpose: 'lumanest-renewal-quote-v1', lineId: line.id, devices: line.devices,
      credential: await credentialDigest(line.username, line.password), amounts: offers.map(offer => offer.amount), lineStatus: line.status, expiresAt: lineExpiry(line), exp: Date.now() + QUOTE_SECONDS * 1000} satisfies QuoteSession, secret()),
    checkout_available: ready,
    message: ready ? null : 'Renewal checkout is temporarily unavailable. Please try again shortly or contact support.'
  };
}

export async function loginRenewal(req: Request, body: Record<string, unknown>, manageSubscription = false) {
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, 'invalid_request', 'Enter your line username and password.');
  const input = parsed.data;
  await throttle('login-ip', client(req), 8);
  await throttle('login-user', input.username, 12);
  const result = await providerRead('/lines?' + new URLSearchParams({username: input.username, ...(manageSubscription ? {} : {on_site: 'true'}), limit: '2', offset: '0'}));
  // bunny() returns the provider envelope's data array. Two matches fail closed.
  if (!Array.isArray(result) || result.length !== 1) throw invalidLogin();
  const found = result[0] as {id?: number; username?: string; on_site?: boolean};
  if (!found || !Number.isSafeInteger(found.id) || Number(found.id) <= 0 || found.username !== input.username || (!manageSubscription && found.on_site !== true)) throw invalidLogin();
  const line = renewableLine(await providerRead('/lines/' + found.id, invalidLogin), manageSubscription);
  const offered = await credentialDigest(input.username, input.password);
  const expected = await credentialDigest(line?.username || input.username, line?.password || 'not-a-valid-line-password');
  if (!line || line.id !== found.id || line.username !== input.username || !equalDigest(offered, expected)) throw invalidLogin();
  if (manageSubscription && !await db().prepare('SELECT id FROM subscriptions WHERE line_id=? LIMIT 1').bind(line.id).first()) throw invalidLogin();
  const credentials: RenewalSession = {purpose: 'lumanest-renewal-v1', lineId: line.id, username: line.username, credential: expected, exp: Date.now() + SESSION_SECONDS * 1000};
  return {quote: await quote(line), cookie: `${RENEWAL_COOKIE}=${await seal(credentials, secret())}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`};
}

export async function renewalQuote(req: Request) {
  await throttle('quote-ip', client(req), 30);
  return quote(await ownLine(req));
}

export async function verifiedRenewalQuote(req: Request, quoteToken: string) {
  if (typeof quoteToken !== 'string' || !quoteToken || quoteToken.length > MAX_BODY_BYTES) throw changedQuote();
  const line = await ownLine(req);
  let snapshot: QuoteSession;
  try {snapshot = await open<QuoteSession>(quoteToken, secret());}
  catch (error) {if (error instanceof ServiceError) throw error; throw changedQuote();}
  const now = Date.now();
  if (!snapshot || snapshot.purpose !== 'lumanest-renewal-quote-v1' || snapshot.lineId !== line.id || snapshot.devices !== line.devices ||
    !Number.isFinite(snapshot.exp) || snapshot.exp <= now || snapshot.exp > now + QUOTE_SECONDS * 1000 ||
    typeof snapshot.credential !== 'string' || !equalDigest(snapshot.credential, await credentialDigest(line.username, line.password)) ||
    !Array.isArray(snapshot.amounts) || snapshot.amounts.length !== periods.length ||
    periods.some((months, index) => snapshot.amounts[index] !== retailPrice(line.devices, months)) ||
    snapshot.lineStatus !== line.status || snapshot.expiresAt !== lineExpiry(line)) throw changedQuote();
  return line;
}
export async function renewalWriteLimit(req: Request, lineId: number) {
  await throttle('checkout-ip', client(req), 8);
  await throttle('checkout-line', String(lineId), 4);
}
export async function renewalCheckout(req: Request, body: Record<string, unknown>) {
  if (typeof body.quoteToken !== 'string' || !body.quoteToken || body.quoteToken.length > MAX_BODY_BYTES) throw changedQuote();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, 'invalid_request', 'Choose a renewal period and enter your receipt email.');
  const line = await verifiedRenewalQuote(req, parsed.data.quoteToken);
  await renewalWriteLimit(req, line.id);
  const subscriptions = await import('./subscriptions.ts');
  const current = await quote(line);
  if (!current.offers.find(offer => offer.months === parsed.data.months)?.available) throw unavailable();
  // createCheckout makes three fresh provider reads; reserve those slots in the shared budget.
  for (let count = 0; count < 3; count++) await throttle('provider-read', 'shared', 60, 60 * 1000);
  try {return await subscriptions.withBillingLineLock(line.id, async () => {
    await subscriptions.assertPayOnceAllowed(line.id);
    return createCheckout({months: parsed.data.months, email: parsed.data.email, name: parsed.data.name, devices: line.devices, lineId: line.id}, new URL(req.url).origin);
  });}
  catch (error) {
    // Payment connection errors are authored by our payment library. Never forward provider response text.
    if (error instanceof ServiceError && (error.code.startsWith('recurring_') || ['renewal_plan_changed', 'paypal_outcome_unknown', 'paypal_auth_failed', 'paypal_error', 'paypal_response_invalid'].includes(error.code))) throw error;
    throw unavailable();
  }
}
