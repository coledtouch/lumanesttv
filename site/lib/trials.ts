// Free 24-hour trials (docs/trials.md). A visitor asks for a trial before any provider account or line exists, and the
// request waits in D1 until the owner approves or declines it in /manage. Only an approval reaches the provider: it
// readies a 24-hour trial line and creates the customer with it, and the provider emails the customer hub invitation.
// The provider's trial-line API isn't documented yet, so the owner creates the line in the reseller panel and enters
// its ID; provisionTrialLine is the one place that changes when lines can be created automatically.
import {z} from 'zod';
import {bunny, settings, ServiceError} from './mybunny.ts';
import {db} from './paypal.ts';
import {digest, mac} from './player-crypto.ts';
import {lineExpiry, throttle, type RenewalLine} from './renewal.ts';
import {clientNetwork, clientPrefix} from './extras.ts';
import {portalReady, type ProviderAccount} from './provider-readiness.ts';
import {isTrialDevice} from './trial-devices.ts';

const MINUTE = 60 * 1000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const TRIAL_HOURS = 24;
const MAX_BODY_BYTES = 2048;
/** New requests wait while this many are pending. */
const MAX_PENDING = 50;
/** Requests (other than declined ones) one household network may make in NETWORK_WINDOW. */
const NETWORK_TRIALS = 2;
const NETWORK_WINDOW = 30 * DAY;
/** An approval still setting up after this long can be resolved by hand. */
const STUCK_AFTER = 10 * MINUTE;
/**
 * A line the owner enters must end about 24 hours from now, so a trial lasts the 24 hours the terms promise: a paid or
 * reviewer line's ID typed by mistake, or a spare trial line made long before, is refused.
 */
const SHORTEST_TRIAL_LINE = 20 * HOUR, LONGEST_TRIAL_LINE = 26 * HOUR;
/** Only a time with a zone says exactly when a line ends; a date alone, or a time without a zone, would be read as UTC. */
const zonedTime = /[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i;
const reference = /^[A-Za-z0-9-]{1,64}$/;
const statusToken = /^[A-Za-z0-9_-]{43}$/;
const singleLine = /^[^\x00-\x1f\x7f]+$/;
const textControl = /[\x00-\x08\x0b-\x1f\x7f]/;
const closedLineStatus = ['expired', 'disabled', 'banned', 'suspended'];

export type TrialState = 'pending' | 'declined' | 'activating' | 'active' | 'needs_review' | 'resolved' | 'ended';
export type PublicTrialState = 'pending' | 'declined' | 'setting_up' | 'active' | 'ended' | 'support';
type TrialRow = {id: string; email: string; name: string; device: string; state: TrialState; created: number; decided: number | null; attempted: number | null; line_id: number | null; customer_id: number | null; expires: number | null; message: string | null; error: string | null; resolution: string | null};
export type TrialQueueRow = Pick<TrialRow, 'id' | 'created' | 'name' | 'email' | 'device' | 'line_id' | 'customer_id' | 'expires' | 'decided' | 'error' | 'message' | 'resolution'> & {state: TrialState; attempted: boolean; same_network: number; same_email: number};
export type TrialStatus = {state: PublicTrialState; requested_at: string; expires_at?: string; message?: string};

function playerKey() {
  const value = settings().PLAYER_COOKIE_KEY || '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
/** Trials are offered only when switched on and everything an approval needs is configured. */
export function trialsReady() {
  const e = settings();
  return e.TRIALS_ENABLED === 'true' && Boolean(e.MYBUNNY_API_KEY) && Boolean(e.CUSTOMER_PORTAL_URL) && Boolean(playerKey());
}

function unavailable() {return new ServiceError(503, 'trials_unavailable', 'Free trials aren’t available right now. You can choose a plan instead.');}
function invalidRequest() {return new ServiceError(400, 'invalid_request', 'Check your name, email and device, then try again.');}
function statusNotFound() {return new ServiceError(404, 'trial_not_found', 'We couldn’t find that trial request. Check the link from your request.');}
function ownerNotFound() {return new ServiceError(404, 'trial_not_found', 'This trial request was not found.');}
function notPending() {return new ServiceError(409, 'trial_not_pending', 'This trial request has already been decided. Refresh the list.');}
function lineInUse() {return new ServiceError(409, 'trial_line_in_use', 'That line is already used by another trial request. Create a new trial line for this request and enter its ID. Nothing was changed.');}
/** Thrown by provisionTrialLine only before anything at the provider changed, so the request can go back to pending. */
class ProviderUnchanged extends ServiceError {}

// Public routes never show storage faults; their own refusals pass through.
async function stored<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch (error) {
    if (error instanceof ServiceError && error.code !== 'storage_unavailable') throw error;
    throw unavailable();
  }
}

/** Strict body reader for the public trial forms: JSON only, at most 2 KB, a plain object. */
export async function readTrialJSON(req: Request, invalid: () => ServiceError = invalidRequest): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw new ServiceError(415, 'json_required', 'Send this form as JSON.');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ServiceError(413, 'request_too_large', 'This trial request is too large.');
  const reader = req.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {await reader.cancel(); throw new ServiceError(413, 'request_too_large', 'This trial request is too large.');}
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
    throw invalid();
  } finally {reader.releaseLock();}
}

// Keyed hashes (purpose 'trial-client') name the requester's email and household network without keeping the
// network's address; each input is versioned so the two can never collide.
async function keyed(value: string) {
  const key = playerKey();
  if (!key) throw unavailable();
  return mac(value, key, 'trial-client');
}
/** The requester's network: an IPv4 address, or the /48 an IPv6 address lies in (lib/extras.ts). */
function networkKey(req: Request) {return keyed('trial-network-v1\n' + clientNetwork(clientPrefix(req.headers.get('cf-connecting-ip'))));}
function emailKey(email: string) {return keyed('trial-email-v1\n' + email.toLowerCase());}
function base64url(bytes: Uint8Array) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');}
function newToken() {return base64url(crypto.getRandomValues(new Uint8Array(32)));}
function statusHash(token: string) {return digest('trial-status:' + token);}
// The token stays in the fragment, so it never reaches a server log, a Referer or a query string.
function statusUrl(token: string) {return '/trial/status#' + token;}

async function limit(purpose: string, subject: string, maximum: number, window: number, message: string, record = true) {
  try {await throttle(purpose, subject, maximum, window, record);}
  catch (error) {
    if (error instanceof ServiceError && error.status === 429) throw new ServiceError(429, 'trial_rate_limit', message, error.retryAfter);
    throw unavailable();
  }
}

const requestSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(singleLine),
  email: z.string().trim().email().max(254),
  device: z.string().refine(isTrialDevice),
  consent: z.literal(true),
  website: z.literal('').optional()
}).strict();

/** POST /api/trial: queues a request for the owner and returns its private status link. Nothing reaches the provider. */
export async function requestTrial(req: Request) {
  if (!trialsReady()) throw unavailable();
  const body = await readTrialJSON(req);
  // The hidden "website" field is left empty by people. A bot that fills it is told it worked; nothing is stored or counted.
  if (typeof body.website === 'string' && body.website !== '') return {state: 'pending' as const, status_url: statusUrl(newToken())};
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest();
  const {name, email, device} = parsed.data;
  const network = await networkKey(req), owner = await emailKey(email);
  await limit('trial-network', network, 3, HOUR, 'Too many trial requests from this network. Please try again later.');
  // The shared limit counts only requests that are stored, so refused attempts can't use it up for everyone else.
  const busy = 'We’re getting a lot of trial requests. Please try again later.';
  await limit('trial-shared', 'shared', 30, HOUR, busy, false);
  const token = newToken(), now = Date.now(), since = now - NETWORK_WINDOW;
  // One statement, so two requests at once can't both pass the checks.
  const inserted = await stored(async () => db().prepare(
    "INSERT INTO trial_requests (id,status_hash,email,email_key,name,device,network,state,created) SELECT ?,?,?,?,?,?,?,'pending',? " +
    "WHERE NOT EXISTS (SELECT 1 FROM trial_requests WHERE email_key=? AND state<>'declined') " +
    "AND (SELECT COUNT(*) FROM trial_requests WHERE network=? AND state<>'declined' AND created>?)<? " +
    "AND (SELECT COUNT(*) FROM trial_requests WHERE state='pending')<?"
  ).bind(crypto.randomUUID(), await statusHash(token), email, owner, name, device, network, now, owner, network, since, NETWORK_TRIALS, MAX_PENDING).run());
  if (inserted.meta.changes === 1) {
    // The request is stored, so a failure to count it changes nothing for the requester.
    await limit('trial-shared', 'shared', 30, HOUR, busy).catch(() => {});
    return {state: 'pending' as const, status_url: statusUrl(token)};
  }
  // The network is checked first: a network that has used its trials can't learn whether other addresses asked.
  throw await stored(async () => {
    const used = await db().prepare("SELECT COUNT(*) AS count FROM trial_requests WHERE network=? AND state<>'declined' AND created>?").bind(network, since).first<{count: number}>();
    if ((used?.count || 0) >= NETWORK_TRIALS) return new ServiceError(409, 'trial_network_used', 'A free trial has already been requested from this home network. Choose a plan, or contact support if that isn’t right.');
    if (await db().prepare("SELECT 1 AS found FROM trial_requests WHERE email_key=? AND state<>'declined' LIMIT 1").bind(owner).first()) {
      return new ServiceError(409, 'trial_already_requested', 'A free trial has already been requested with this email address.');
    }
    return new ServiceError(503, 'trials_busy', busy);
  });
}

function iso(ms: number) {return new Date(ms).toISOString();}
/** A trial whose expiry has passed is ended on every read, before clean-up records it. */
function effectiveState(row: {state: TrialState; expires: number | null}, now: number): TrialState {
  return row.state === 'active' && row.expires !== null && row.expires < now ? 'ended' : row.state;
}
function publicState(state: TrialState): PublicTrialState {
  return state === 'pending' || state === 'declined' || state === 'active' || state === 'ended' ? state : state === 'activating' ? 'setting_up' : 'support';
}

/** POST /api/trial/status: what the requester may see. Never the email, name, line or customer. */
export async function trialStatus(req: Request): Promise<TrialStatus> {
  const body = await readTrialJSON(req, statusNotFound);
  const token = Object.keys(body).length === 1 && typeof body.token === 'string' ? body.token : '';
  if (!statusToken.test(token)) throw statusNotFound();
  await limit('trial-status', await networkKey(req), 60, 15 * MINUTE, 'Too many status checks. Please try again in a few minutes.');
  const hash = await statusHash(token);
  const row = await stored(() => db().prepare('SELECT state,created,expires,message FROM trial_requests WHERE status_hash=?').bind(hash).first<Pick<TrialRow, 'state' | 'created' | 'expires' | 'message'>>());
  if (!row) throw statusNotFound();
  const state = publicState(effectiveState(row, Date.now()));
  return {
    state, requested_at: iso(row.created),
    ...((state === 'active' || state === 'ended') && row.expires !== null ? {expires_at: iso(row.expires)} : {}),
    ...(state === 'declined' && row.message ? {message: row.message} : {})
  };
}

/** The owner's queue names a missing migration (deployed before 0011 was applied) instead of a generic fault. */
export async function ownerTrials<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch (error) {
    if (!(error instanceof ServiceError) && error instanceof Error && /no such table: trial_requests/i.test(error.message)) {
      throw new ServiceError(503, 'trials_storage_missing', 'Trial requests need migration 0011_trial_requests.sql. Apply it, then refresh.');
    }
    throw error;
  }
}

/** GET /api/manage/trials: pending requests first (oldest first), then those needing review, then the rest (newest first). */
export async function trialQueue(now = Date.now()): Promise<{trials: TrialQueueRow[]; pending_count: number}> {
  const rows = await db().prepare(
    'SELECT t.id,t.created,t.name,t.email,t.device,t.state,t.line_id,t.customer_id,t.expires,t.decided,t.attempted,t.error,t.message,t.resolution,' +
    '(SELECT COUNT(*) FROM trial_requests o WHERE o.network=t.network AND o.id<>t.id AND o.created>?) AS same_network,' +
    '(SELECT COUNT(*) FROM trial_requests o WHERE o.email_key=t.email_key AND o.id<>t.id) AS same_email ' +
    "FROM trial_requests t ORDER BY CASE t.state WHEN 'pending' THEN 0 WHEN 'needs_review' THEN 1 WHEN 'activating' THEN 1 ELSE 2 END," +
    "CASE WHEN t.state='pending' THEN t.created ELSE -t.created END LIMIT 200"
  ).bind(now - NETWORK_WINDOW).all<TrialRow & {same_network: number; same_email: number}>();
  const pending = await db().prepare("SELECT COUNT(*) AS count FROM trial_requests WHERE state='pending'").first<{count: number}>();
  return {
    trials: (rows.results || []).map(row => ({
      id: row.id, created: row.created, name: row.name, email: row.email, device: row.device, state: effectiveState(row, now),
      line_id: row.line_id, customer_id: row.customer_id, expires: row.expires, decided: row.decided, attempted: row.attempted !== null,
      error: row.error, message: row.message, resolution: row.resolution, same_network: row.same_network, same_email: row.same_email
    })),
    pending_count: pending?.count || 0
  };
}

async function ownerRow(id: unknown) {
  if (typeof id !== 'string' || !reference.test(id)) throw ownerNotFound();
  const row = await db().prepare('SELECT * FROM trial_requests WHERE id=?').bind(id).first<TrialRow>();
  if (!row) throw ownerNotFound();
  return row;
}
function lineNumber(value: unknown) {
  const number = typeof value === 'string' && /^\d{1,16}$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw new ServiceError(400, 'invalid_request', 'Enter the ID of the trial line you created in the provider panel.');
  return number;
}
async function lineTaken(lineId: number, id: string) {
  return Boolean(await db().prepare('SELECT 1 AS found FROM trial_requests WHERE line_id=? AND id<>? LIMIT 1').bind(lineId, id).first());
}
function customerId(data: unknown) {
  const result = data as {id?: unknown; customer?: {id?: unknown} | null} | null | undefined;
  const id = result?.customer?.id ?? result?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('The provider has not confirmed the customer.');
  return id;
}

type ProviderLine = {id?: unknown; status?: unknown; customer_id?: unknown; customer?: unknown; expires_at?: unknown; days_left?: unknown};
/**
 * Readies the provider line a trial uses and returns its ID and expiry (ms). For now the owner creates a 24-hour trial
 * line in the reseller panel and enters its ID: this checks that line and marks it as a site trial. When the provider
 * documents its trial endpoint, creating the line belongs here (with its own idempotency key, 'trial-line-' + row.id),
 * and approveTrial doesn't change. Throws ProviderUnchanged only while nothing at the provider has changed.
 */
async function provisionTrialLine(row: TrialRow, lineId: number, attempted: number): Promise<{lineId: number; expires: number}> {
  let data: unknown;
  try {data = await bunny('/lines/' + lineId);}
  catch (error) {
    if (error instanceof ServiceError && [404, 410].includes(error.status)) throw new ProviderUnchanged(409, 'trial_line_not_found', 'The provider has no line with that ID. Check the trial line ID and try again. Nothing was changed.');
    // Reading the line changed nothing either.
    if (error instanceof ServiceError) throw new ProviderUnchanged(error.status, error.code, error.message, error.retryAfter);
    throw new ProviderUnchanged(502, 'outcome_unknown', 'The provider returned an unreadable line. Nothing was changed; try again.');
  }
  const wrapped = data as {line?: unknown} | null;
  const line = (wrapped && typeof wrapped === 'object' && wrapped.line && typeof wrapped.line === 'object' ? wrapped.line : data) as ProviderLine | null;
  if (!line || typeof line !== 'object' || line.id !== lineId) throw new ProviderUnchanged(409, 'trial_line_not_found', 'The provider did not return that line. Check the trial line ID and try again. Nothing was changed.');
  if (typeof line.status !== 'string' || closedLineStatus.includes(line.status.toLowerCase())) throw new ProviderUnchanged(409, 'trial_line_unusable', 'That line is expired, disabled or suspended at the provider. Create a new trial line and enter its ID. Nothing was changed.');
  if ((line.customer_id !== undefined && line.customer_id !== null) || (line.customer !== undefined && line.customer !== null)) throw new ProviderUnchanged(409, 'trial_line_in_use', 'That line already belongs to a customer. Create a new trial line for this request and enter its ID. Nothing was changed.');
  const now = Date.now(), reported = lineExpiry(line as RenewalLine), rough = reported === null ? null : Date.parse(reported);
  const ends = typeof line.expires_at === 'string' && zonedTime.test(line.expires_at) ? rough : null;
  const days = typeof line.days_left === 'number' && Number.isFinite(line.days_left) ? line.days_left : null;
  const expired = () => new ProviderUnchanged(409, 'trial_line_unusable', 'That line has already expired. Create a new trial line and enter its ID. Nothing was changed.');
  const notTrial = () => new ProviderUnchanged(409, 'trial_line_not_trial', 'That line doesn’t end about 24 hours from now, so it isn’t a fresh 24-hour trial line. Create a new 24-hour trial line for this request and enter its ID. Nothing was changed.');
  if (ends !== null) {
    if (ends <= now) throw expired();
    if (ends < now + SHORTEST_TRIAL_LINE || ends > now + LONGEST_TRIAL_LINE) throw notTrial();
  } else {
    // Without an exact end, a date or a day count must still fit a trial line (a zone shifts a date by 14 hours at most).
    // A line reporting neither, such as one with no end date, is refused.
    if (rough === null && days === null) throw notTrial();
    if ((rough !== null && rough < now - DAY) || (days !== null && days < 0)) throw expired();
    if ((rough !== null && rough > now + 2 * DAY) || (days !== null && days > 1)) throw notTrial();
  }
  // From here on the provider changes: any failure leaves the request in review.
  await bunny('/lines/' + lineId, 'PATCH', {on_site: true, note: 'LumaNest trial ' + row.id.slice(0, 8)});
  return {lineId, expires: ends ?? attempted + TRIAL_HOURS * HOUR};
}

async function review(id: string, error: unknown) {
  const code = error instanceof ServiceError && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code) ? error.code : 'activation_not_confirmed';
  console.error('lumanest_trial_needs_review', JSON.stringify({code}));
  await db().prepare("UPDATE trial_requests SET state='needs_review',error=? WHERE id=? AND state='activating'").bind(code, id).run();
  return {id, state: 'needs_review' as const, message: 'The trial needs review: check the line and customer in your provider panel, then resolve it with a note.'};
}

/**
 * Approves a pending request with the provider line the owner created. The row is claimed (attempted set) before the
 * provider changes anything; after that, any failure leaves it in needs_review, and it is never retried automatically.
 */
export async function approveTrial(id: unknown, lineInput: unknown) {
  const row = await ownerRow(id), lineId = lineNumber(lineInput);
  if (row.state !== 'pending' || row.attempted !== null) throw notPending();
  if (await lineTaken(lineId, row.id)) throw lineInUse();
  // The invitation is the customer's only way in, so the hub must be able to send it first.
  const account = await bunny('/account') as ProviderAccount;
  if (!portalReady(account?.site, settings().CUSTOMER_PORTAL_URL, settings().CUSTOMER_PORTAL_PRIMARY_URL) || account?.site?.email_ready !== true) {
    throw new ServiceError(503, 'invitations_not_ready', 'The customer hub can’t send invitation emails yet. Finish its setup in the provider panel, then approve again. Nothing was changed.');
  }
  const attempted = Date.now();
  const claim = await db().prepare("UPDATE trial_requests SET state='activating',attempted=?,decided=?,line_id=?,error=NULL WHERE id=? AND state='pending' AND attempted IS NULL AND NOT EXISTS (SELECT 1 FROM trial_requests o WHERE o.line_id=? AND o.id<>?)")
    .bind(attempted, attempted, lineId, row.id, lineId, row.id).run();
  if (claim.meta.changes !== 1) {
    const latest = await db().prepare('SELECT state,attempted FROM trial_requests WHERE id=?').bind(row.id).first<{state: string; attempted: number | null}>();
    throw latest?.state === 'pending' && latest.attempted === null ? lineInUse() : notPending();
  }
  let line: {lineId: number; expires: number};
  try {line = await provisionTrialLine(row, lineId, attempted);}
  catch (error) {
    if (!(error instanceof ProviderUnchanged)) return review(row.id, error);
    await db().prepare("UPDATE trial_requests SET state='pending',attempted=NULL,decided=NULL,line_id=NULL WHERE id=? AND state='activating' AND attempted=?").bind(row.id, attempted).run();
    throw error;
  }
  try {
    const created = await bunny('/customers', 'POST', {email: row.email, name: row.name, line_ids: [line.lineId], send_invitation: true}, 'trial-' + row.id);
    const saved = await db().prepare("UPDATE trial_requests SET state='active',customer_id=?,expires=?,error=NULL WHERE id=? AND state='activating'").bind(customerId(created), line.expires, row.id).run();
    if (saved.meta.changes !== 1) {
      const latest = await db().prepare('SELECT state FROM trial_requests WHERE id=?').bind(row.id).first<{state: TrialState}>();
      return {id: row.id, state: latest?.state || 'needs_review', message: 'The customer was created, but this request changed meanwhile. Check it in your provider panel.'};
    }
  } catch (error) {return review(row.id, error);}
  return {id: row.id, state: 'active' as const, message: 'Trial approved. The customer has been emailed their login.'};
}

export async function declineTrial(id: unknown, message: unknown) {
  if (typeof id !== 'string' || !reference.test(id)) throw ownerNotFound();
  let text: string | null = null;
  if (message !== undefined && message !== null && message !== '') {
    if (typeof message !== 'string' || message.length > 500 || textControl.test(message)) throw new ServiceError(400, 'invalid_request', 'Keep the message to the requester to 500 characters of plain text.');
    text = message.trim() || null;
  }
  const result = await db().prepare("UPDATE trial_requests SET state='declined',decided=?,message=? WHERE id=? AND state='pending' AND attempted IS NULL").bind(Date.now(), text, id).run();
  if (result.meta.changes !== 1) {
    await ownerRow(id);
    throw notPending();
  }
  return {id, state: 'declined' as const, message: 'Trial request declined.'};
}

/** Closes a trial whose approval needs review, or one still setting up after 10 minutes, with the owner's note. */
export async function resolveTrial(id: unknown, note: unknown, now = Date.now()) {
  if (typeof id !== 'string' || !reference.test(id)) throw ownerNotFound();
  if (typeof note !== 'string' || note.trim().length < 3 || note.length > 500 || textControl.test(note)) throw new ServiceError(400, 'resolution_note_required', 'Describe how this trial was resolved (3–500 characters).');
  const result = await db().prepare("UPDATE trial_requests SET state='resolved',resolution=?,decided=? WHERE id=? AND (state='needs_review' OR (state='activating' AND attempted<?))")
    .bind(note.trim(), now, id, now - STUCK_AFTER).run();
  if (result.meta.changes !== 1) {
    await ownerRow(id);
    throw new ServiceError(409, 'trial_not_resolvable', 'Only a trial that needs review, or one still setting up after 10 minutes, can be resolved.');
  }
  return {id, state: 'resolved' as const, message: 'Trial marked resolved.'};
}
