import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {randomBytes, createHash, scrypt, timingSafeEqual} from 'node:crypto';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {ServiceError, settings} from './mybunny';

export const OWNER_EMAIL = 'support@lumanest.tv';
export const OWNER_COOKIE = '__Host-lumanest_owner';
export const OWNER_EXPIRED_COOKIE = `${OWNER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const OWNER_ID = 'owner';
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 8 * 1024;
const PASSWORD_OPTIONS = {N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024};
const DUMMY_HASH = 'scrypt$32768$8$3$00000000000000000000000000000000$' + '00'.repeat(64);
let passwordJobs = 0;
type Credential = {id: string; email: string; password_hash: string; recovery_hash: string; version: string};
export type Owner = {userId: string; email: string; displayName: string; method: 'password' | 'bootstrap'};

function database() {
  if (!env.DB) throw new ServiceError(503, 'owner_storage_unavailable', 'Owner sign-in is temporarily unavailable. Please try again.');
  return env.DB;
}
async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch (error) {
    if (error instanceof ServiceError) throw error;
    // Database details must never be exposed and a missing schema must not enable bootstrap access.
    throw new ServiceError(503, 'owner_storage_unavailable', 'Owner sign-in is temporarily unavailable. Please try again.');
  }
}
function hash(value: string) {return createHash('sha256').update(value).digest('hex');}
function freshToken() {return randomBytes(32).toString('hex');}
function validCredential(row: Credential) {
  return row.id === OWNER_ID && row.email === OWNER_EMAIL && /^[a-f0-9]{32}$/.test(row.version) && /^[a-f0-9]{64}$/.test(row.recovery_hash) && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(row.password_hash);
}
async function credential(): Promise<Credential | null> {
  const row = await storage(() => database().prepare('SELECT id,email,password_hash,recovery_hash,version FROM owner_credentials WHERE id=?').bind(OWNER_ID).first<Credential>());
  if (row && !validCredential(row)) throw new ServiceError(503, 'owner_storage_unavailable', 'Owner sign-in is temporarily unavailable. Please try again.');
  return row;
}
export async function ownerConfigured() {return Boolean(await credential());}

function cookieValue(requestHeaders: Headers) {
  const values = (requestHeaders.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(OWNER_COOKIE + '='));
  if (values.length !== 1) return '';
  const value = values[0].slice(OWNER_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
export function ownerSessionCookie(token: string) {
  return `${OWNER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
async function passwordOwner(requestHeaders: Headers): Promise<Owner | null> {
  const token = cookieValue(requestHeaders);
  if (!token) return null;
  const row = await storage(() => database().prepare('SELECT c.id,c.email FROM owner_sessions s JOIN owner_credentials c ON c.id=s.owner_id AND c.version=s.credential_version WHERE s.token_hash=? AND s.expires>?').bind(hash(token), Date.now()).first<{id: string; email: string}>());
  if (!row || row.id !== OWNER_ID || row.email !== OWNER_EMAIL) return null;
  return {userId: OWNER_ID, email: OWNER_EMAIL, displayName: 'LumaNest owner', method: 'password'};
}
async function bootstrapOwner(): Promise<Owner | null> {
  const trustedId = settings().ADMIN_USER_ID;
  if (!trustedId) throw new ServiceError(503, 'owner_not_configured', 'The owner identity has not been configured.');
  const user = await getChatGPTUser();
  if (!user || user.userId !== trustedId) return null;
  return {userId: user.userId, email: OWNER_EMAIL, displayName: 'LumaNest owner', method: 'bootstrap'};
}
export async function getOwner(): Promise<Owner | null> {
  if (await credential()) return passwordOwner(await headers());
  return bootstrapOwner();
}
export async function requireBootstrapOwner(): Promise<Owner> {
  if (await credential()) throw new ServiceError(409, 'owner_already_configured', 'Owner sign-in is already set up. Use your LumaNest email and password.');
  const owner = await bootstrapOwner();
  if (!owner) {
    const user = await getChatGPTUser();
    throw new ServiceError(user ? 403 : 401, user ? 'forbidden' : 'sign_in_required', user ? 'Only the existing site owner can set up owner sign-in.' : 'Verify the existing site owner before setting up owner sign-in.');
  }
  return owner;
}
export async function requireOwner(): Promise<Owner> {
  if (await credential()) {
    const owner = await passwordOwner(await headers());
    if (!owner) throw new ServiceError(401, 'owner_sign_in_required', 'Sign in with your LumaNest owner email and password.');
    return owner;
  }
  const owner = await bootstrapOwner();
  if (owner) return owner;
  const user = await getChatGPTUser();
  throw new ServiceError(user ? 403 : 401, user ? 'forbidden' : 'sign_in_required', user ? 'Only the site owner can use the management console.' : 'Sign in to continue.');
}

export async function readOwnerJSON(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw new ServiceError(415, 'json_required', 'Send this form as JSON.');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ServiceError(413, 'request_too_large', 'This sign-in request is too large.');
  const reader = req.body?.getReader();
  if (!reader) throw new ServiceError(400, 'invalid_request', 'Complete the sign-in form.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {await reader.cancel(); throw new ServiceError(413, 'request_too_large', 'This sign-in request is too large.');}
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
    throw new ServiceError(400, 'invalid_request', 'Complete the sign-in form.');
  } finally {reader.releaseLock();}
}
function exactKeys(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) throw new ServiceError(400, 'invalid_request', 'Complete the sign-in form.');
}
function inputEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 254 || value.length < 1) throw new ServiceError(400, 'invalid_request', 'Enter your owner email.');
  return value.trim().toLowerCase();
}
function inputPassword(value: unknown, newPassword: boolean) {
  if (typeof value !== 'string' || value.length < (newPassword ? 16 : 1) || value.length > 128) throw new ServiceError(400, 'invalid_password', newPassword ? 'Choose a password between 16 and 128 characters.' : 'Enter your password.');
  return value;
}
async function derive(password: string, salt: string): Promise<Buffer> {
  // A scrypt job needs about 32 MiB. Bound concurrent work in each 128 MiB isolate.
  if (passwordJobs >= 1) throw new ServiceError(503, 'owner_sign_in_busy', 'Owner sign-in is busy. Please try again in a moment.', '3');
  passwordJobs++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, Buffer.from(salt, 'hex'), 64, PASSWORD_OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
  } catch {
    throw new ServiceError(503, 'owner_sign_in_unavailable', 'Owner sign-in is temporarily unavailable. Please try again.', '3');
  } finally {passwordJobs--;}
}
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
async function passwordMatches(password: string, encoded: string) {
  const parts = encoded.split('$');
  const candidate = await derive(password, parts[4]);
  return timingSafeEqual(candidate, Buffer.from(parts[5], 'hex'));
}
function recovery() {
  const raw = freshToken();
  return {code: raw.toUpperCase().match(/.{8}/g)!.join('-'), digest: hash(raw)};
}
function recoveryMatches(value: string, expected: string) {
  const normalized = value.trim().replace(/-/g, '').toLowerCase();
  const candidate = hash(normalized);
  return /^[a-f0-9]{64}$/.test(normalized) && timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
}

async function throttle(req: Request, action: 'login' | 'recover' | 'setup' | 'recovery-code') {
  const now = Date.now();
  const securityAction = action === 'recover' || action === 'recovery-code';
  const period = securityAction ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const limits = securityAction ? [5, 20, 10] : action === 'setup' ? [10, 30, 20] : [10, 100, 30];
  const scopes = ['ip:' + (req.headers.get('cf-connecting-ip') || 'unknown'), 'global', 'account:' + OWNER_EMAIL];
  const statements = scopes.map((scope, index) => database().prepare(`INSERT INTO owner_auth_attempts (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN owner_auth_attempts.expires<=? THEN 1 ELSE owner_auth_attempts.count+1 END, expires=CASE WHEN owner_auth_attempts.expires<=? THEN excluded.expires ELSE owner_auth_attempts.expires END RETURNING count,expires`).bind(hash(action + ':' + scope), now + period, now, now));
  const results = await storage(() => database().batch<{count: number; expires: number}>(statements));
  let retryAfter = 0;
  results.forEach((result, index) => {
    const row = result.results[0];
    if (!row || !Number.isSafeInteger(row.count) || !Number.isSafeInteger(row.expires)) throw new ServiceError(503, 'owner_storage_unavailable', 'Owner sign-in is temporarily unavailable. Please try again.');
    if (row.count > limits[index]) retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil((row.expires - now) / 1000)));
  });
  if (retryAfter) throw new ServiceError(429, 'owner_rate_limit', 'Too many attempts. Please wait before trying again.', String(retryAfter));
}
function sessionInsert(token: string, version: string) {
  return database().prepare('INSERT INTO owner_sessions (token_hash,owner_id,credential_version,expires) SELECT ?,id,version,? FROM owner_credentials WHERE id=? AND version=?').bind(hash(token), Date.now() + SESSION_SECONDS * 1000, OWNER_ID, version);
}
const rejectedLogin = () => new ServiceError(401, 'invalid_owner_login', 'The owner email or password was not accepted.');

export async function loginOwner(req: Request, input: Record<string, unknown>) {
  exactKeys(input, ['email', 'password']);
  const email = inputEmail(input.email);
  const password = inputPassword(input.password, false);
  await throttle(req, 'login');
  const row = await credential();
  // Derive the same key even for an unknown email or an unconfigured owner.
  const matches = await passwordMatches(password, row?.password_hash || DUMMY_HASH);
  if (!row || email !== OWNER_EMAIL || !matches) throw rejectedLogin();
  const token = freshToken();
  const result = await storage(() => sessionInsert(token, row.version).run());
  if (result.meta.changes !== 1) throw rejectedLogin();
  return {token};
}
export async function setupOwner(req: Request, input: Record<string, unknown>) {
  exactKeys(input, ['password']);
  const password = inputPassword(input.password, true);
  await requireBootstrapOwner();
  await throttle(req, 'setup');
  const encoded = await passwordHash(password);
  const code = recovery();
  const version = randomBytes(16).toString('hex');
  const token = freshToken();
  const now = Date.now();
  const results = await storage(() => database().batch([
    database().prepare('INSERT INTO owner_credentials (id,email,password_hash,recovery_hash,version,created,updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(OWNER_ID, OWNER_EMAIL, encoded, code.digest, version, now, now),
    sessionInsert(token, version)
  ]));
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new ServiceError(409, 'owner_already_configured', 'Owner sign-in is already set up. Use your LumaNest email and password.');
  return {token, recoveryCode: code.code};
}
export async function recoverOwner(req: Request, input: Record<string, unknown>) {
  exactKeys(input, ['email', 'recoveryCode', 'password']);
  const email = inputEmail(input.email);
  const password = inputPassword(input.password, true);
  if (typeof input.recoveryCode !== 'string' || input.recoveryCode.length < 1 || input.recoveryCode.length > 128) throw new ServiceError(400, 'invalid_request', 'Enter your saved recovery code.');
  await throttle(req, 'recover');
  const row = await credential();
  const matches = recoveryMatches(input.recoveryCode, row?.recovery_hash || '00'.repeat(32));
  if (!row || email !== OWNER_EMAIL || !matches) throw new ServiceError(401, 'invalid_recovery', 'The owner email or recovery code was not accepted.');
  const encoded = await passwordHash(password);
  const code = recovery();
  const version = randomBytes(16).toString('hex');
  const token = freshToken();
  const results = await storage(() => database().batch([
    database().prepare('UPDATE owner_credentials SET password_hash=?,recovery_hash=?,version=?,updated=? WHERE id=? AND version=? AND recovery_hash=?').bind(encoded, code.digest, version, Date.now(), OWNER_ID, row.version, row.recovery_hash),
    sessionInsert(token, version)
  ]));
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new ServiceError(401, 'invalid_recovery', 'The owner email or recovery code was not accepted.');
  return {token, recoveryCode: code.code};
}
export async function logoutOwner(req: Request, input: Record<string, unknown>) {
  exactKeys(input, []);
  const token = cookieValue(req.headers);
  if (token) await storage(() => database().prepare('DELETE FROM owner_sessions WHERE token_hash=?').bind(hash(token)).run());
}
export async function rotateRecoveryCode(req: Request, input: Record<string, unknown>) {
  exactKeys(input, ['password']);
  const password = inputPassword(input.password, false);
  const token = cookieValue(req.headers);
  if (!token || !await passwordOwner(req.headers)) throw new ServiceError(401, 'owner_sign_in_required', 'Sign in with your LumaNest owner email and password.');
  await throttle(req, 'recovery-code');
  const row = await credential();
  const matches = await passwordMatches(password, row?.password_hash || DUMMY_HASH);
  if (!row || !matches) throw rejectedLogin();
  const code = recovery();
  const now = Date.now();
  const result = await storage(() => database().prepare('UPDATE owner_credentials SET recovery_hash=?,updated=? WHERE id=? AND version=? AND recovery_hash=? AND EXISTS (SELECT 1 FROM owner_sessions s WHERE s.owner_id=owner_credentials.id AND s.credential_version=owner_credentials.version AND s.token_hash=? AND s.expires>?)').bind(code.digest, now, OWNER_ID, row.version, row.recovery_hash, hash(token), now).run());
  if (result.meta.changes !== 1) throw new ServiceError(409, 'owner_security_changed', 'Owner security changed while this request was being processed. Sign in again and try once more.');
  return {recoveryCode: code.code};
}
