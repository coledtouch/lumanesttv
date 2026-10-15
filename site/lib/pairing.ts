// QR pairing for the TV apps, modelled on the OAuth device authorization grant (RFC 8628).
// The TV asks for a pairing, shows a QR code and a short code, and polls with a secret device code.
// The customer opens the code on their phone, signs in to the web player and approves; the TV then
// receives its playlist login once. Only a hash of the device code is stored, and the login itself is
// sealed with the player key until the TV collects it.
import qrcode from 'qrcode-generator';
import {z} from 'zod';
import {ServiceError} from './mybunny';
import {db} from './paypal';
import {digest, open, seal} from './player-crypto';
import {assertNotRevoked, playerSecret, session, tvAccount} from './player';
import {SITE_URL} from '../app/site';

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_INTERVAL_S = 5;
const MAX_ACTIVE_PER_CLIENT = 10;
// No vowels (so codes never spell words) and no 0/O/1/I lookalikes.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
export const DEVICES = ['android', 'samsung', 'lg'] as const;
export const DEVICE_NAMES: Record<(typeof DEVICES)[number], string> = {android: 'Android TV / Google TV / Fire TV', samsung: 'Samsung TV', lg: 'LG TV'};
export type TvAccount = ReturnType<typeof tvAccount>;

export const corsHeaders = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'};

function base64url(bytes: Uint8Array) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');}
function randomCode() {
  const out: string[] = [];
  // Rejection sampling keeps every symbol equally likely.
  while (out.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 252 && out.length < 8) out.push(ALPHABET[b % ALPHABET.length]);
  return out.join('');
}
/** Accepts "abcd-efgh", "ABCD EFGH" and similar; returns the 8 stored characters or ''. */
export function normalizeUserCode(value: string) {
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 8 && [...code].every(c => ALPHABET.includes(c)) ? code : '';
}
export const displayCode = (code: string) => code.slice(0, 4) + '-' + code.slice(4);
export function pairingURL(code: string) {return SITE_URL + '/pair?code=' + displayCode(code);}
/** QR modules as rows of "0"/"1", so each app draws it without its own QR encoder. */
export function qrRows(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount(), rows: string[] = [];
  for (let r = 0; r < size; r++) {let row = ''; for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? '1' : '0'; rows.push(row);}
  return rows;
}
async function clientId(req: Request) {return digest('pair-client:' + (req.headers.get('cf-connecting-ip') || 'unknown'));}

export async function startPairing(req: Request, body: unknown) {
  const {device} = z.object({device: z.enum(DEVICES)}).strict().parse(body);
  const now = Date.now(), client = await clientId(req);
  await db().prepare('DELETE FROM device_pairings WHERE expires<?').bind(now).run();
  const active = await db().prepare('SELECT COUNT(*) AS count FROM device_pairings WHERE client=?').bind(client).first<{count: number}>();
  if ((active?.count || 0) >= MAX_ACTIVE_PER_CLIENT) throw new ServiceError(429, 'pairing_rate_limit', 'Too many pairing codes. Try again in a few minutes.', '120');
  const deviceCode = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const deviceHash = await digest('pair-device:' + deviceCode);
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = randomCode();
    const inserted = await db().prepare('INSERT OR IGNORE INTO device_pairings (device_hash,user_code,device,client,status,payload,created,expires) VALUES (?,?,?,?,?,NULL,?,?)')
      .bind(deviceHash, userCode, device, client, 'pending', now, now + PAIRING_TTL_MS).run();
    if (!inserted.meta.changes) continue;
    const url = pairingURL(userCode);
    return {deviceCode, userCode: displayCode(userCode), verificationUri: SITE_URL + '/pair', verificationUriComplete: url, qr: qrRows(url), expiresIn: PAIRING_TTL_MS / 1000, interval: PAIRING_INTERVAL_S};
  }
  throw new ServiceError(503, 'pairing_unavailable', 'Pairing is busy. Please try again.');
}

export async function pollPairing(body: unknown): Promise<{status: 'pending'} | {status: 'expired'} | {status: 'approved'; account: TvAccount}> {
  const {deviceCode} = z.object({deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(body);
  const deviceHash = await digest('pair-device:' + deviceCode), now = Date.now();
  // Deleting with RETURNING hands an approved login to exactly one poll.
  const row = await db().prepare("DELETE FROM device_pairings WHERE device_hash=? AND status='approved' AND expires>=? RETURNING payload").bind(deviceHash, now).first<{payload: string}>();
  if (row?.payload) {
    try {return {status: 'approved', account: await open<TvAccount>(row.payload, playerSecret(), 'device-pairing')};}
    catch {return {status: 'expired'};}
  }
  const pending = await db().prepare("SELECT expires FROM device_pairings WHERE device_hash=? AND status='pending'").bind(deviceHash).first<{expires: number}>();
  return pending && pending.expires >= now ? {status: 'pending'} : {status: 'expired'};
}

async function approvalLimit(req: Request) {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const id = await digest('pair-approve:' + (req.headers.get('cf-connecting-ip') || 'unknown') + ':' + bucket);
  await db().prepare('INSERT INTO player_login_attempts (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').bind(id, Date.now() + 30 * 60 * 1000).run();
  const attempts = await db().prepare('SELECT count FROM player_login_attempts WHERE id=?').bind(id).first<{count: number}>();
  if ((attempts?.count || 0) > 20) throw new ServiceError(429, 'pairing_rate_limit', 'Too many pairing attempts. Try again in 15 minutes.', '900');
}

/** Looks up a pending code for the confirmation screen, without approving it. */
export async function describePairing(req: Request, value: string) {
  const {credentials} = await session(req);
  await assertNotRevoked(credentials);
  const userCode = normalizeUserCode(value);
  if (!userCode) throw new ServiceError(400, 'pairing_code_invalid', 'Check the code on your TV and try again.');
  const row = await db().prepare("SELECT device FROM device_pairings WHERE user_code=? AND status='pending' AND expires>=?").bind(userCode, Date.now()).first<{device: (typeof DEVICES)[number]}>();
  if (!row) throw new ServiceError(404, 'pairing_code_not_found', 'That code has expired or was already used. Open pairing on your TV again for a new code.');
  return {code: displayCode(userCode), device: DEVICE_NAMES[row.device] || 'TV', username: credentials.username};
}

export async function approvePairing(req: Request, body: unknown) {
  const {code} = z.object({code: z.string().max(20)}).strict().parse(body);
  await approvalLimit(req);
  const {credentials} = await session(req);
  await assertNotRevoked(credentials);
  const userCode = normalizeUserCode(code);
  if (!userCode) throw new ServiceError(400, 'pairing_code_invalid', 'Check the code on your TV and try again.');
  const payload = await seal(tvAccount(credentials), playerSecret(), 'device-pairing');
  const row = await db().prepare("UPDATE device_pairings SET status='approved', payload=? WHERE user_code=? AND status='pending' AND expires>=? RETURNING device").bind(payload, userCode, Date.now()).first<{device: (typeof DEVICES)[number]}>();
  if (!row) throw new ServiceError(404, 'pairing_code_not_found', 'That code has expired or was already used. Open pairing on your TV again for a new code.');
  return {device: DEVICE_NAMES[row.device] || 'TV'};
}
