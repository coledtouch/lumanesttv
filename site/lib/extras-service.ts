// The endpoints of docs/extras.md: GET /api/extras/subtitles, GET /api/extras/subtitles/file/<token>.<vtt|srt> and
// GET /api/extras/trailer. Public (no login, no cookies, any origin): the TV apps are not pages on this site.
//
// OpenSubtitles' terms for integrators don't allow keeping a subtitle file on our servers to serve to other users,
// so only metadata (which files are best for a title, a title's trailer key, the TMDB id a name resolves to and the
// OpenSubtitles state) is kept, in R2 under extras/v1/. Each file request downloads the file from OpenSubtitles
// (one download from the plan's quota), converts it and passes it on; the viewer's device may keep it.
//
// The plan's daily downloads are guarded by a count per UTC day in D1 (extras_download_counts): every client together
// (row '*'), each client (a keyed hash of clientPrefix: an IPv4 address or an IPv6 /64, never the address) and, for
// IPv6, its /48 (clientNetwork), so one address, one /64 or one /48 (a household's /56, a free tunnel) gets at most its
// cap. What this can't stop: many IPv4 addresses, or a hotlinking page whose many visitors each fetch a file, can still
// use up the day's budget (then every client waits until midnight UTC); only a per-viewer grant would. A download
// OpenSubtitles answered with an error, so didn't count, is taken off the counts again. Rows older than yesterday are
// deleted.
//
// Logs carry fixed codes and numbers only: never keys, tokens, the OpenSubtitles login, IP addresses, titles or URLs.
import {
  CLIENT_DAILY_DOWNLOADS, CREDIT, EXTRAS_VERSION, FILE_PATH, NETWORK_DAILY_DOWNLOADS, STATE_OBJECT, clientMacInput, clientNetwork, clientPrefix,
  dailyDownloads, fileMacInput, matchResolved,
  parseSrt, parseSubtitleQuery, parseTrailerQuery, pickSubtitles, utcDay,
  pickTrailer, resolveHashInput, resolveKeys, resolveObject, subtitleSearchPath, subtitlesObject, toSrt, toVtt, tmdbSearch, trackLabel, trailerName, trailerObject,
  youtubeShortText, youtubeShortURL, youtubeWatchURL, YOUTUBE_KEY, FILE_ID_MAX, MAX_TRACKS, type LookupQuery, type Media, type PickedFile, type QueryError,
  type Trailer,
} from './extras.ts';
import {mac, open, seal} from './player-crypto.ts';
import {qrRows} from './qr.ts';
import {tmdbAuth, tmdbRequest, type TmdbAuth} from './catalog.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long each kind of R2 object is fresh. */
export const FRESH = {
  subtitles: 30 * DAY_MS, noSubtitles: 3 * DAY_MS,
  trailer: 30 * DAY_MS, noTrailer: 7 * DAY_MS,
  resolved: 30 * DAY_MS, unresolved: 7 * DAY_MS,
};
/** An expired copy is served after an upstream failure while it is younger than this. */
export const STALE_MAX_MS = 90 * DAY_MS;
/** After a failed refresh of an object that has a stale copy, that object is not refreshed again for this long. */
export const RETRY_MS = 5 * 60 * 1000;
/** Each isolate re-reads the OpenSubtitles state object after this long. */
export const STATE_MEMO_MS = 60 * 1000;
/** A login token is used this long (OpenSubtitles tokens last 24 hours). */
export const LOGIN_TTL_MS = 23 * 60 * 60 * 1000;
/** OpenSubtitles allows few logins: never more than one a minute. */
export const LOGIN_INTERVAL_MS = 60 * 1000;
export const REQUEST_TIMEOUT_MS = 8000;
export const LINK_TIMEOUT_MS = 10000;
export const FILE_MAX_BYTES = 2 * 1024 * 1024;
/** Upstream JSON answers (searches, videos, the download's link) are read up to this size. */
const JSON_MAX_BYTES = 4 * 1024 * 1024;
const STORE_TIMEOUT_MS = 2000;
/**
 * A minute's requests per key. lookup and file are per client (clientPrefix); miss is a client's lookups that need an
 * upstream request (not cached), and an IPv6 /48's (clientNetwork) together; upstream is every OpenSubtitles search or
 * TMDB request together, per service.
 */
export const LIMITS = {lookup: 120, file: 12, miss: 12, upstream: 120};
type LimitKind = keyof typeof LIMITS;
/** lookup and upstream share EXTRAS_LIMITER (120 a minute per key), file and miss SUBTITLE_FILE_LIMITER (12): no new binding. */
const LIMITER: Record<LimitKind, 'EXTRAS_LIMITER' | 'SUBTITLE_FILE_LIMITER'> = {
  lookup: 'EXTRAS_LIMITER', upstream: 'EXTRAS_LIMITER', file: 'SUBTITLE_FILE_LIMITER', miss: 'SUBTITLE_FILE_LIMITER',
};
const LIMIT_WINDOW_MS = 60 * 1000;
/** Entries each isolate's fallback windows and refresh holds keep at most (the oldest go first). */
export const MEMORY_MAX = 5000;
/** A D1 failure answers 503 with this Retry-After: downloads are not counted, so none is made. */
export const COUNT_RETRY_S = 60;
/** Each isolate deletes the download counts older than yesterday at most this often. */
export const PURGE_EVERY_MS = 60 * 60 * 1000;
/** lumanest_subtitles_budget_low is logged once a day per isolate when the day's downloads pass this share. */
export const BUDGET_LOW_SHARE = 0.8;
const BUMP_CLIENT = 'INSERT INTO extras_download_counts (day,client,count) VALUES (?,?,1) ON CONFLICT(day,client) DO UPDATE SET count=count+1 RETURNING count';
// The day's total counts only clients still within their own cap, so one client asking on and on can't use it up.
const BUMP_TOTAL = "INSERT INTO extras_download_counts (day,client,count) SELECT ?,'*',1 WHERE (SELECT count FROM extras_download_counts WHERE day=? AND client=?)<=? "
  + 'ON CONFLICT(day,client) DO UPDATE SET count=count+1 RETURNING count';
// An IPv6 client's /48 counts the requests within the client's own cap; the total, those within both caps.
const BUMP_NETWORK = 'INSERT INTO extras_download_counts (day,client,count) SELECT ?,?,1 WHERE (SELECT count FROM extras_download_counts WHERE day=? AND client=?)<=? '
  + 'ON CONFLICT(day,client) DO UPDATE SET count=count+1 RETURNING count';
const BUMP_TOTAL_IN_NETWORK = "INSERT INTO extras_download_counts (day,client,count) SELECT ?,'*',1 WHERE (SELECT count FROM extras_download_counts WHERE day=? AND client=?)<=? "
  + 'AND (SELECT count FROM extras_download_counts WHERE day=? AND client=?)<=? ON CONFLICT(day,client) DO UPDATE SET count=count+1 RETURNING count';
/** Takes back a count: the download it was made for was not counted by OpenSubtitles. */
const UNCOUNT = 'UPDATE extras_download_counts SET count=count-1 WHERE day=? AND client=? AND count>0';
const PURGE_COUNTS = 'DELETE FROM extras_download_counts WHERE day<?';

const OS_BASE_HOST = 'api.opensubtitles.com';
/** The only base_url hosts a login may move requests to. */
const OS_BASE_HOSTS = new Set(['api.opensubtitles.com', 'vip-api.opensubtitles.com']);
const OS_USER_AGENT = 'LumaNest TV v1.0';
const OS_REDIRECTS = 5;
const PLAYER_KEY = /^[a-f0-9]{64}$/;

export const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400'};
const CACHE = {
  ok: 'public, max-age=86400', empty: 'public, max-age=21600', notConfigured: 'public, max-age=600', stale: 'public, max-age=300', none: 'no-store',
};
const FILE_TYPES = {vtt: 'text/vtt; charset=utf-8', srt: 'application/x-subrip; charset=utf-8'};

export type RateLimitLike = {limit?: (options: {key: string}) => Promise<{success?: boolean} | undefined>};
export type D1StatementLike = {bind(...values: unknown[]): D1StatementLike; run(): Promise<unknown>};
export type D1Like = {prepare(sql: string): D1StatementLike; batch(statements: D1StatementLike[]): Promise<{results?: unknown[]}[]>};
export type R2Like = {
  get(key: string): Promise<{text(): Promise<string>} | null>;
  put(key: string, value: string, options?: {httpMetadata?: {contentType?: string}}): Promise<unknown>;
};
export type ExtrasEnv = {
  OPENSUBTITLES_API_KEY?: string; OPENSUBTITLES_USERNAME?: string; OPENSUBTITLES_PASSWORD?: string;
  /** A plain variable, optional: the downloads a day for every client together (DAILY_DOWNLOADS when unset or invalid). */
  OPENSUBTITLES_DAILY_DOWNLOADS?: string | number;
  TMDB_API_KEY?: string; PLAYER_COOKIE_KEY?: string;
  BUCKET?: R2Like | null; DB?: D1Like | null; EXTRAS_LIMITER?: RateLimitLike | null; SUBTITLE_FILE_LIMITER?: RateLimitLike | null;
};
export type ExtrasTiming = {requestMs?: number; linkMs?: number; retryDelayMs?: number; storeMs?: number};
export type ExtrasDeps = {
  env: ExtrasEnv;
  fetch?: typeof fetch;
  now?: () => number;
  /** Keeps R2 writes going after the answer (ctx.waitUntil); without it they are awaited. */
  waitUntil?: (promise: Promise<unknown>) => void;
  timing?: ExtrasTiming;
};

// ------------------------------------------------------------------ answers

function headers(extra: Record<string, string>) {
  return {...CORS_HEADERS, 'X-Content-Type-Options': 'nosniff', ...extra};
}
function json(body: unknown, cacheControl: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {status, headers: headers({'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...extra})});
}
const MESSAGES = {
  bad_request: 'Check the parameters and try again.',
  unsupported_version: 'This version is not available.',
  not_found: 'This subtitle file is not available.',
  rate_limited: 'Too many requests. Please wait a minute and try again.',
  unreadable: 'This subtitle file could not be read.',
  unavailable: 'This is not available right now. Please try again later.',
};
type ErrorCode = keyof typeof MESSAGES;
const STATUS: Record<ErrorCode, number> = {bad_request: 400, unsupported_version: 400, not_found: 404, rate_limited: 429, unreadable: 502, unavailable: 503};
export function errorAnswer(code: ErrorCode, retryAfter?: number) {
  return json({v: EXTRAS_VERSION, error: {code, message: MESSAGES[code]}}, CACHE.none, STATUS[code], retryAfter ? {'Retry-After': String(retryAfter)} : {});
}
export function optionsAnswer() {return new Response(null, {status: 204, headers: headers({})});}
/** A HEAD answer: the GET answer's status and headers, without the body. */
export async function withoutBody(response: Response) {
  await response.body?.cancel();
  return new Response(null, {status: response.status, headers: response.headers});
}

// ------------------------------------------------------------------ helpers

class Upstream extends Error {}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const iso = (ms: number) => new Date(ms).toISOString();

async function sha256Hex(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
/** Compares two strings without stopping at the first difference. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** The promise's value, or null once ms have passed or when it fails. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise.catch(() => null), new Promise<null>(resolve => {timer = setTimeout(() => resolve(null), ms);})]);}
  finally {clearTimeout(timer);}
}
/** Reads a body up to max bytes; more is a failure. */
async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) {await response.body?.cancel().catch(() => {}); throw new Upstream('too_large');}
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {await reader.cancel().catch(() => {}); throw new Upstream('too_large');}
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {out.set(chunk, offset); offset += chunk.byteLength;}
  return out;
}
async function readJSON(response: Response, max = JSON_MAX_BYTES): Promise<unknown> {
  const bytes = await readLimited(response, max);
  try {return JSON.parse(new TextDecoder().decode(bytes));}
  catch {throw new Upstream('bad_json');}
}
const discard = (response: Response) => response.body?.cancel().catch(() => {});
const osHostAllowed = (host: string) => host === 'opensubtitles.com' || host.endsWith('.opensubtitles.com');

// ------------------------------------------------------------------ stored objects

type Stored<T> = {value: T; stored: number; expires: number};
type Resolved = {id: number | null};
type OsState = {quotaUntil: number; login: {sealed: string; at: number} | null; lastLogin: number; rejected: string};
type OsAuth = {token: string; base: string};
const EMPTY_STATE: OsState = {quotaUntil: 0, login: null, lastLogin: 0, rejected: ''};

function readFiles(raw: Record<string, unknown>): PickedFile[] | null {
  if (!Array.isArray(raw.files) || raw.files.length > MAX_TRACKS) return null;
  const files: PickedFile[] = [];
  for (const [i, entry] of raw.files.entries()) {
    if (!isObject(entry)) return null;
    const id = entry.file_id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > FILE_ID_MAX) return null;
    const hi = entry.hi === true;
    files.push({file_id: id, hi, label: trackLabel(i, hi)});
  }
  return files;
}
function readTrailer(raw: Record<string, unknown>): {trailer: Trailer | null} | null {
  if (raw.trailer === null) return {trailer: null};
  const t = raw.trailer;
  if (!isObject(t) || typeof t.key !== 'string' || !YOUTUBE_KEY.test(t.key) || typeof t.name !== 'string') return null;
  return {trailer: {key: t.key, name: trailerName(t.name)}};
}
function readResolved(raw: Record<string, unknown>): Resolved | null {
  const id = raw.tmdb;
  if (id === null) return {id: null};
  return typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 999999999999 ? {id} : null;
}

export type ExtrasInstance = ReturnType<typeof createExtras>;

/** Adds to a map that holds at most MEMORY_MAX entries: when it is full, the oldest entries go first. */
function remember<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  while (map.size >= MEMORY_MAX) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

/** One per isolate: its memory holds the fallback rate-limit counters, the OpenSubtitles state and refresh holds. */
export function createExtras() {
  const windows: Record<LimitKind, Map<string, {start: number; count: number}>> = {lookup: new Map(), file: new Map(), miss: new Map(), upstream: new Map()};
  const blocked = new Map<string, number>();
  let lastPurge = -Infinity;
  /** Until when (the next midnight UTC) this isolate saw the day's download budget used up. */
  let budgetUsedUntil = 0;
  /** Client and /48 hashes this isolate saw over their daily cap, to the next midnight UTC: refused without D1. */
  const overCap = new Map<string, number>();
  const logged = {low: '', usedUp: ''};
  const inflight = new Map<string, Promise<unknown>>();
  let stateMemo: {state: OsState; read: number} | null = null;
  let lastLoginHere = 0;
  let warnedRejected = false;
  const opened = new Map<string, OsAuth | null>();

  type Ctx = {
    env: ExtrasEnv; send: typeof fetch; now: () => number; bucket: R2Like | null; waitUntil?: (promise: Promise<unknown>) => void;
    requestMs: number; linkMs: number; retryDelayMs: number; storeMs: number;
    osKey: string; playerKey: string;
  };
  function context(deps: ExtrasDeps): Ctx {
    const env = deps.env || {}, timing = deps.timing || {};
    const bucket = env.BUCKET && typeof env.BUCKET.get === 'function' && typeof env.BUCKET.put === 'function' ? env.BUCKET : null;
    const playerKey = typeof env.PLAYER_COOKIE_KEY === 'string' && PLAYER_KEY.test(env.PLAYER_COOKIE_KEY) ? env.PLAYER_COOKIE_KEY : '';
    return {
      env, send: deps.fetch || ((input, init) => fetch(input, init)), now: deps.now || Date.now, bucket, waitUntil: deps.waitUntil,
      requestMs: timing.requestMs ?? REQUEST_TIMEOUT_MS, linkMs: timing.linkMs ?? LINK_TIMEOUT_MS, retryDelayMs: timing.retryDelayMs ?? 1000,
      storeMs: timing.storeMs ?? STORE_TIMEOUT_MS,
      osKey: typeof env.OPENSUBTITLES_API_KEY === 'string' ? env.OPENSUBTITLES_API_KEY.trim() : '', playerKey,
    };
  }

  // ---------------------------------------------------------------- clients and rate limits

  /**
   * Who asks: the client (clientPrefix), its wider network (clientNetwork: an IPv6 /48, else the client itself) and,
   * when needed, their keyed hashes (each computed once a request).
   */
  type Client = {prefix: string; network: string; hash(): Promise<string>; networkHash(): Promise<string>};
  function client(ctx: Ctx, req: Request): Client {
    const prefix = clientPrefix(req.headers.get('CF-Connecting-IP')), network = clientNetwork(prefix);
    // Without PLAYER_COOKIE_KEY (trailers only; subtitles answer not_configured) the network itself names it.
    const keyed = (text: string) => ctx.playerKey ? mac(clientMacInput(text), ctx.playerKey, 'extras-client') : Promise.resolve(text);
    let hash: Promise<string> | null = null, networkHash: Promise<string> | null = null;
    const own = () => hash ||= keyed(prefix);
    return {prefix, network, hash: own, networkHash: () => network === prefix ? own() : networkHash ||= keyed(network)};
  }

  /**
   * True when `id` is over its limit this minute (key `<kind>:<id>`). With the binding, Workers Rate Limiting counts;
   * without it, or when it throws, fixed one-minute windows in this isolate with the same limits, which evict their
   * oldest entries when full (never all of them).
   */
  async function limited(ctx: Ctx, kind: LimitKind, id: string) {
    const binding = ctx.env[LIMITER[kind]], key = kind + ':' + id;
    if (binding && typeof binding.limit === 'function') {
      try {return (await binding.limit({key}))?.success === false;}
      catch { /* this isolate's window decides */ }
    }
    const map = windows[kind], now = ctx.now();
    let entry = map.get(key);
    if (!entry || now - entry.start >= LIMIT_WINDOW_MS) remember(map, key, entry = {start: now, count: 0});
    return ++entry.count > LIMITS[kind];
  }
  /** May this client (and, for IPv6, its /48) make a lookup that needs an upstream request? */
  const mayMiss = (ctx: Ctx, who: Client) => async () => !(await limited(ctx, 'miss', await who.hash()))
    && (who.network === who.prefix || !(await limited(ctx, 'miss', await who.networkHash())));
  /** Before every upstream request a cache miss makes: one of the service's shared tokens, else a failure. */
  async function spend(ctx: Ctx, service: 'opensubtitles' | 'tmdb') {
    if (await limited(ctx, 'upstream', service)) throw new Upstream('budget');
  }

  // ---------------------------------------------------------------- R2

  async function readObject<T>(ctx: Ctx, key: string, validate: (raw: Record<string, unknown>) => T | null): Promise<Stored<T> | null> {
    if (!ctx.bucket) return null;
    const bucket = ctx.bucket;
    const text = await within((async () => {const object = await bucket.get(key); return object ? await object.text() : null;})(), ctx.storeMs);
    if (!text) return null;
    try {
      const raw = JSON.parse(text);
      if (!isObject(raw) || raw.v !== 1 || typeof raw.stored !== 'string' || typeof raw.expires !== 'string') return null;
      const stored = Date.parse(raw.stored), expires = Date.parse(raw.expires);
      if (!Number.isFinite(stored) || !Number.isFinite(expires)) return null;
      const value = validate(raw);
      return value === null ? null : {value, stored, expires};
    } catch {return null;}
  }
  function writeObject(ctx: Ctx, key: string, body: Record<string, unknown>) {
    if (!ctx.bucket) return Promise.resolve();
    const bucket = ctx.bucket;
    const job = within((async () => bucket.put(key, JSON.stringify({v: 1, ...body}), {httpMetadata: {contentType: 'application/json'}}))(), ctx.storeMs * 2);
    if (ctx.waitUntil) {
      try {ctx.waitUntil(job); return Promise.resolve();} catch { /* not in a Worker request */ }
    }
    return job.then(() => {});
  }

  /**
   * A fresh object as it is; else a refresh while the request waits (one per object in this isolate); else, after
   * a failed refresh, the expired copy while it is under 90 days old, with no new refresh of it for 5 minutes.
   * Null: the refresh failed and there is no copy. Failures are never stored. When a refresh is needed and
   * `mayRefresh` (the client's miss limit) refuses it: the expired copy under 90 days old, as stale, with no refresh;
   * 'limited' without one. Joining a refresh already running costs nothing.
   */
  async function cached<T>(
    ctx: Ctx, key: string, validate: (raw: Record<string, unknown>) => T | null, toBody: (value: T) => Record<string, unknown>,
    refresh: () => Promise<{value: T; freshMs: number}>, failCode: string, mayRefresh: () => Promise<boolean>,
  ): Promise<{value: T; stale: boolean} | null | 'limited'> {
    const existing = await readObject(ctx, key, validate);
    const now = ctx.now();
    if (existing && existing.expires > now) return {value: existing.value, stale: false};
    const usable = existing && now - existing.stored < STALE_MAX_MS ? existing : null;
    if (usable && (blocked.get(key) || 0) > now) return {value: usable.value, stale: true};
    let job = inflight.get(key) as Promise<T | null> | undefined;
    if (!job && !(await mayRefresh())) return usable ? {value: usable.value, stale: true} : 'limited';
    job ||= inflight.get(key) as Promise<T | null> | undefined;
    if (!job) {
      job = (async () => {
        let result: {value: T; freshMs: number};
        try {result = await refresh();}
        catch (error) {console.error(error instanceof Upstream && error.message === 'budget' ? 'lumanest_extras_upstream_limited' : failCode); return null;}
        const stored = ctx.now();
        await writeObject(ctx, key, {stored: iso(stored), expires: iso(stored + result.freshMs), ...toBody(result.value)});
        return result.value;
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    const value = await job;
    if (value !== null) {blocked.delete(key); return {value, stale: false};}
    if (!usable) return null;
    remember(blocked, key, ctx.now() + RETRY_MS);
    return {value: usable.value, stale: true};
  }

  // ---------------------------------------------------------------- OpenSubtitles state and login

  function parseState(text: string | null): OsState {
    if (!text) return {...EMPTY_STATE};
    try {
      const raw = JSON.parse(text);
      if (!isObject(raw) || raw.v !== 1) return {...EMPTY_STATE};
      const time = (value: unknown) => {const ms = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(ms) ? ms : 0;};
      const login = isObject(raw.login) && typeof raw.login.sealed === 'string' && raw.login.sealed.length <= 6000 && time(raw.login.at)
        ? {sealed: raw.login.sealed, at: time(raw.login.at)} : null;
      // rejected: the 'extras-credential' MAC of refused secrets (an older SHA-256 is ignored: one more login).
      return {quotaUntil: time(raw.quotaUntil), login, lastLogin: time(raw.lastLoginAttempt), rejected: typeof raw.rejected === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw.rejected) ? raw.rejected : ''};
    } catch {return {...EMPTY_STATE};}
  }
  function merge(a: OsState, b: OsState): OsState {
    const login = !a.login ? b.login : !b.login ? a.login : b.login.at > a.login.at ? b.login : a.login;
    return {quotaUntil: Math.max(a.quotaUntil, b.quotaUntil), login, lastLogin: Math.max(a.lastLogin, b.lastLogin), rejected: b.rejected || a.rejected};
  }
  async function readState(ctx: Ctx): Promise<OsState> {
    const now = ctx.now();
    // Without R2 the state lives in this isolate only.
    if (stateMemo && (!ctx.bucket || now - stateMemo.read < STATE_MEMO_MS)) return stateMemo.state;
    let state = {...EMPTY_STATE};
    if (ctx.bucket) {
      const bucket = ctx.bucket;
      const text = await within((async () => {const object = await bucket.get(STATE_OBJECT); return object ? await object.text() : null;})(), ctx.storeMs);
      state = parseState(text);
    }
    if (stateMemo) state = merge(stateMemo.state, state);
    stateMemo = {state, read: now};
    return state;
  }
  async function updateState(ctx: Ctx, change: (state: OsState) => OsState) {
    const state = change(await readState(ctx));
    stateMemo = {state, read: stateMemo?.read ?? ctx.now()};
    const body = {
      stored: iso(ctx.now()), quotaUntil: state.quotaUntil ? iso(state.quotaUntil) : null,
      login: state.login ? {sealed: state.login.sealed, at: iso(state.login.at)} : null,
      lastLoginAttempt: state.lastLogin ? iso(state.lastLogin) : null, rejected: state.rejected || null,
    };
    await writeObject(ctx, STATE_OBJECT, body);
    return state;
  }

  const osBase = (host: string) => 'https://' + host + '/api/v1';
  function credentials(ctx: Ctx) {
    const username = typeof ctx.env.OPENSUBTITLES_USERNAME === 'string' ? ctx.env.OPENSUBTITLES_USERNAME.trim() : '';
    const password = typeof ctx.env.OPENSUBTITLES_PASSWORD === 'string' ? ctx.env.OPENSUBTITLES_PASSWORD : '';
    return username && password ? {username, password} : null;
  }

  /**
   * One OpenSubtitles request, following redirects only to https hosts under opensubtitles.com. Api-Key, and
   * Authorization with a login token, go only to the API hosts (OS_BASE_HOSTS), and never with `credentials: false`
   * (the download link): not to the link's host, nor after a redirect to another host.
   */
  async function osFetch(ctx: Ctx, url: string, init: {method: 'GET' | 'POST'; body?: string; token?: string; timeoutMs?: number; signal?: AbortSignal; credentials?: boolean}) {
    let target = url, method = init.method, body = init.body;
    const signal = init.signal || AbortSignal.timeout(init.timeoutMs ?? ctx.requestMs);
    for (let hop = 0; hop <= OS_REDIRECTS; hop++) {
      const parsed = new URL(target);
      if (parsed.protocol !== 'https:' || parsed.port || !osHostAllowed(parsed.hostname)) throw new Upstream('host');
      const sent: Record<string, string> = {'User-Agent': OS_USER_AGENT, Accept: '*/*'};
      if (init.credentials !== false && OS_BASE_HOSTS.has(parsed.hostname)) {
        sent['Api-Key'] = ctx.osKey;
        if (init.token) sent.Authorization = 'Bearer ' + init.token;
      }
      if (body !== undefined) sent['Content-Type'] = 'application/json';
      const response = await ctx.send(parsed.href, {method, headers: sent, body, redirect: 'manual', signal});
      if (![301, 302, 303, 307, 308].includes(response.status)) return {response, signal};
      const location = response.headers.get('Location');
      await discard(response);
      if (!location) throw new Upstream('redirect');
      target = new URL(location, parsed).href;
      // As fetch does: 303 (and 301 or 302 after a POST) continue as a GET without the body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {method = 'GET'; body = undefined;}
    }
    throw new Upstream('redirects');
  }

  async function openLogin(ctx: Ctx, sealed: string, cred: string): Promise<OsAuth | null> {
    const id = cred + ':' + sealed;
    if (!opened.has(id)) {
      if (opened.size >= 16) opened.clear();
      let auth: OsAuth | null = null;
      try {
        const value = await open<{token?: unknown; base?: unknown; cred?: unknown}>(sealed, ctx.playerKey, 'extras-opensubtitles');
        if (typeof value.token === 'string' && typeof value.base === 'string' && OS_BASE_HOSTS.has(value.base) && value.cred === cred) auth = {token: value.token, base: value.base};
      } catch {auth = null;}
      opened.set(id, auth);
    }
    return opened.get(id) || null;
  }

  /**
   * The login to send, when OPENSUBTITLES_USERNAME and OPENSUBTITLES_PASSWORD are set: the held token while it is
   * under 23 hours old, else (when `login`) a new login, at most one a minute. Credentials OpenSubtitles refused are
   * never tried again. Null: no Authorization (which works on a paid plan).
   */
  async function authFor(ctx: Ctx, options: {login: boolean; renew?: boolean}): Promise<OsAuth | null> {
    const login = credentials(ctx);
    if (!login) return null;
    // A keyed hash: refused secrets are recognized without keeping anything a guess could be checked against.
    const cred = await mac('extras-cred-v1\n' + login.username + '\n' + login.password, ctx.playerKey, 'extras-credential');
    const state = await readState(ctx), now = ctx.now();
    if (state.rejected === cred) return null;
    if (!options.renew && state.login && now - state.login.at < LOGIN_TTL_MS && state.login.at <= now + 60000) {
      const held = await openLogin(ctx, state.login.sealed, cred);
      if (held) return held;
    }
    if (!options.login || now - Math.max(lastLoginHere, state.lastLogin) < LOGIN_INTERVAL_MS) return null;
    lastLoginHere = now;
    let answer: {status: number; body: unknown} | null = null;
    try {
      const {response} = await osFetch(ctx, osBase(OS_BASE_HOST) + '/login', {method: 'POST', body: JSON.stringify({username: login.username, password: login.password})});
      answer = {status: response.status, body: response.ok ? await readJSON(response, 64 * 1024) : (await discard(response), null)};
    } catch {answer = null;}
    if (answer?.status === 401) {
      if (!warnedRejected) {warnedRejected = true; console.error('lumanest_subtitles_login_rejected');}
      await updateState(ctx, s => ({...s, lastLogin: now, rejected: cred, login: null}));
      return null;
    }
    const body = answer && answer.status === 200 && isObject(answer.body) ? answer.body : null;
    const token = typeof body?.token === 'string' && /^[\x21-\x7e]{1,4096}$/.test(body.token) ? body.token : '';
    if (!token) {
      await updateState(ctx, s => ({...s, lastLogin: now}));
      return null;
    }
    let base = OS_BASE_HOST;
    if (typeof body?.base_url === 'string') {
      const value = body.base_url.trim().toLowerCase();
      let host = '';
      try {host = new URL(/^https?:\/\//.test(value) ? value : 'https://' + value).hostname;} catch {host = '';}
      if (OS_BASE_HOSTS.has(host)) base = host;
    }
    const sealed = await seal({token, base, cred}, ctx.playerKey, 'extras-opensubtitles');
    await updateState(ctx, s => ({...s, lastLogin: now, login: {sealed, at: now}}));
    return {token, base};
  }

  // ---------------------------------------------------------------- OpenSubtitles search and download

  async function searchSubtitles(ctx: Ctx, tmdb: number, episode: LookupQuery['episode']): Promise<PickedFile[]> {
    let auth = await authFor(ctx, {login: false});
    for (let attempt = 0; attempt < 2; attempt++) {
      await spend(ctx, 'opensubtitles');
      const {response} = await osFetch(ctx, osBase(auth?.base || OS_BASE_HOST) + subtitleSearchPath(tmdb, episode), {method: 'GET', token: auth?.token});
      if (response.status === 401 && auth) {
        // A held token that is no longer accepted: search without it (searching needs no login).
        await discard(response);
        auth = null;
        continue;
      }
      if (!response.ok) {await discard(response); throw new Upstream('search_' + response.status);}
      const body = await readJSON(response);
      if (!isObject(body) || !Array.isArray(body.data)) throw new Upstream('search_shape');
      const request = episode ? {type: 'episode' as const, tmdb, season: episode.season, episode: episode.episode} : {type: 'movie' as const, tmdb};
      return pickSubtitles(request, body.data);
    }
    throw new Upstream('search_unauthorized');
  }

  /**
   * `spent`: OpenSubtitles may have counted a download, because /download answered with a link or a request to it got
   * no answer at all. False only when every /download answer was an error status (no link), which they don't count.
   */
  type DownloadResult = {ok: true; text: string} | {ok: false; code: 'unavailable'; retryAfter: number; spent: boolean};

  function quotaReset(value: unknown, now: number) {
    const reset = typeof value === 'string' ? Date.parse(value) : NaN;
    // OpenSubtitles' daily quotas reset at midnight UTC; that is the fallback for a missing or past time.
    const midnight = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    return Math.min(Number.isFinite(reset) && reset > now ? reset : midnight, now + DAY_MS);
  }
  const retryAfter = (until: number, now: number) => Math.min(86400, Math.max(1, Math.ceil((until - now) / 1000)));

  /** The temporary link's file: https on opensubtitles.com or under it, at most 2 MB, within 10 seconds, no key sent. */
  async function fetchLink(ctx: Ctx, link: unknown): Promise<{status: number; bytes?: Uint8Array}> {
    if (typeof link !== 'string') throw new Upstream('link');
    let url: URL;
    try {url = new URL(link);} catch {throw new Upstream('link');}
    if (url.protocol !== 'https:' || url.port || !osHostAllowed(url.hostname)) throw new Upstream('link');
    const signal = AbortSignal.timeout(ctx.linkMs);
    const {response} = await osFetch(ctx, url.href, {method: 'GET', signal, credentials: false});
    if (!response.ok) {await discard(response); return {status: response.status};}
    return {status: 200, bytes: await readLimited(response, FILE_MAX_BYTES)};
  }

  async function download(ctx: Ctx, fileId: number): Promise<DownloadResult> {
    let spent = false;
    const fail = (): DownloadResult => {console.error('lumanest_subtitles_download_failed'); return {ok: false, code: 'unavailable', retryAfter: 300, spent};};
    let auth = await authFor(ctx, {login: true});
    let renewed = false, retried = false, relinked = false;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        let answered: Awaited<ReturnType<typeof osFetch>>;
        try {answered = await osFetch(ctx, osBase(auth?.base || OS_BASE_HOST) + '/download', {method: 'POST', body: JSON.stringify({file_id: fileId}), token: auth?.token});}
        catch (error) {spent = true; throw error;}
        const {response} = answered;
        if (response.status === 200) {
          spent = true;
          const body = await readJSON(response, 64 * 1024);
          if (!isObject(body)) return fail();
          const remaining = typeof body.remaining === 'number' && Number.isFinite(body.remaining) ? body.remaining : null;
          console.log('lumanest_subtitles_download', JSON.stringify({remaining}));
          const file = await fetchLink(ctx, body.link);
          // The link is temporary (3 hours) and never stored; one that is gone is asked for again once.
          if (file.status === 410 && !relinked) {relinked = true; continue;}
          if (!file.bytes) return fail();
          return {ok: true, text: new TextDecoder('utf-8').decode(file.bytes)};
        }
        if (response.status === 406) {
          const body = await readJSON(response, 64 * 1024).catch(() => null);
          const remaining = isObject(body) && typeof body.remaining === 'number' ? body.remaining : 0;
          if (isObject(body) && (remaining < 0 || body.reset_time_utc !== undefined)) {
            const now = ctx.now(), until = quotaReset(body.reset_time_utc, now);
            console.error('lumanest_subtitles_quota_exhausted');
            await updateState(ctx, s => ({...s, quotaUntil: Math.max(s.quotaUntil, until)}));
            return {ok: false, code: 'unavailable', retryAfter: retryAfter(until, now), spent};
          }
          return fail();
        }
        await discard(response);
        if (response.status === 401 && auth && !renewed) {
          // The held token was refused: log in again once (no more than once a minute) and retry once.
          renewed = true;
          await updateState(ctx, s => ({...s, login: null}));
          auth = await authFor(ctx, {login: true, renew: true});
          continue;
        }
        if (response.status === 429) return {ok: false, code: 'unavailable', retryAfter: 5, spent};
        if (response.status >= 500 && !retried) {
          retried = true;
          await new Promise(resolve => setTimeout(resolve, ctx.retryDelayMs));
          continue;
        }
        return fail();
      }
      return fail();
    } catch {
      return fail();
    }
  }

  // ---------------------------------------------------------------- TMDB

  async function tmdbGet(ctx: Ctx, auth: TmdbAuth, path: string, query: Record<string, string>): Promise<unknown | null> {
    const [url, init] = tmdbRequest(auth, path, query);
    const response = await ctx.send(url, {...init, signal: AbortSignal.timeout(ctx.requestMs)});
    if (response.status === 404) {await discard(response); return null;}
    if (!response.ok) {await discard(response); throw new Upstream('tmdb_' + response.status);}
    return await readJSON(response);
  }

  /**
   * The TMDB id of a name and year (the name fallback), cached in R2; 'failed' when TMDB failed with no copy,
   * 'limited' when the client may not cause another upstream request this minute.
   */
  async function resolveName(ctx: Ctx, who: Client, auth: TmdbAuth, media: Media, name: string, year: string): Promise<{id: number | null; stale: boolean} | 'failed' | 'limited'> {
    const {key, whole} = resolveKeys(name);
    if (!key) return {id: null, stale: false};
    const object = resolveObject(media, await sha256Hex(resolveHashInput(key, whole, year)));
    const result = await cached<Resolved>(ctx, object, readResolved, value => ({tmdb: value.id}), async () => {
      const [path, query] = tmdbSearch(media, key, year);
      await spend(ctx, 'tmdb');
      const body = await tmdbGet(ctx, auth, path, query);
      if (body !== null && (!isObject(body) || !Array.isArray(body.results))) throw new Upstream('resolve_shape');
      const id = body === null ? null : matchResolved(media, body.results, key, whole, year);
      return {value: {id}, freshMs: id === null ? FRESH.unresolved : FRESH.resolved};
    }, 'lumanest_extras_resolve_failed', mayMiss(ctx, who));
    return result === 'limited' ? 'limited' : result ? {id: result.value.id, stale: result.stale} : 'failed';
  }

  async function fileToken(ctx: Ctx, fileId: number) {
    return fileId + '-' + (await mac(fileMacInput(fileId), ctx.playerKey, 'extras-subtitle')).slice(0, 22);
  }

  // ---------------------------------------------------------------- the daily download count (D1)

  /** A count a bump returned: a positive whole number, else the batch is treated as failed. */
  function countOf(result: {results?: unknown[]} | undefined, required: boolean): number | null {
    const row = result?.results?.[0];
    if (row === undefined && !required) return null;
    const count = isObject(row) ? row.count : undefined;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error('count');
    return count;
  }

  /** Deletes the counts older than yesterday, at most once an hour in this isolate, after the answer when it can. */
  function purgeOldCounts(ctx: Ctx, db: D1Like, now: number) {
    if (now - lastPurge < PURGE_EVERY_MS) return Promise.resolve();
    lastPurge = now;
    const job = (async () => {await db.prepare(PURGE_COUNTS).bind(utcDay(now - DAY_MS)).run();})().catch(() => {console.error('lumanest_subtitles_count_cleanup_failed');});
    if (ctx.waitUntil) {
      try {ctx.waitUntil(job); return Promise.resolve();} catch { /* not in a Worker request */ }
    }
    return job;
  }

  /** The rows one download was counted in (the client's, its /48's for IPv6, and '*'), to take it back. */
  type Counted = {db: D1Like; day: string; clients: string[]};

  /**
   * Counts one download for today before it is made, in one D1 batch: the client's own count; for IPv6, its /48's
   * while the client is within its cap; and the day's total while the client (and its /48) are within theirs. The
   * rows counted: go on. Else the answer: 429 over the client's or the /48's cap, 503 over the day's budget (both
   * until the next midnight UTC), 503 with a short Retry-After when D1 fails (no download uncounted). A client or
   * /48 found over its cap is then refused from this isolate's memory (overCap) until midnight, without D1.
   */
  async function countDownload(ctx: Ctx, who: Client): Promise<Response | Counted> {
    const now = ctx.now(), day = utcDay(now), midnight = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS, untilMidnight = retryAfter(midnight, now);
    const budget = dailyDownloads(ctx.env.OPENSUBTITLES_DAILY_DOWNLOADS);
    // This isolate already saw the day's budget used up: refuse without D1, as the lookup does.
    if (budgetUsedUntil > now) return errorAnswer('unavailable', untilMidnight);
    const db = ctx.env.DB;
    let within: boolean, total: number | null, clients: string[];
    try {
      if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new Error('no D1');
      const id = await who.hash(), network = who.network === who.prefix ? null : await who.networkHash();
      // Known to be over its cap (or its /48's) today: no D1 write, so new /64s of a full /48 cost nothing.
      if ((overCap.get(id) || 0) > now || (network !== null && (overCap.get(network) || 0) > now)) return errorAnswer('rate_limited', untilMidnight);
      const statements = network
        ? [db.prepare(BUMP_CLIENT).bind(day, id), db.prepare(BUMP_NETWORK).bind(day, network, day, id, CLIENT_DAILY_DOWNLOADS),
          db.prepare(BUMP_TOTAL_IN_NETWORK).bind(day, day, id, CLIENT_DAILY_DOWNLOADS, day, network, NETWORK_DAILY_DOWNLOADS)]
        : [db.prepare(BUMP_CLIENT).bind(day, id), db.prepare(BUMP_TOTAL).bind(day, day, id, CLIENT_DAILY_DOWNLOADS)];
      const results = await db.batch(statements);
      if (!Array.isArray(results) || results.length !== statements.length) throw new Error('batch');
      within = countOf(results[0], true)! <= CLIENT_DAILY_DOWNLOADS;
      if (!within) remember(overCap, id, midnight);
      if (network) {
        const counted = countOf(results[1], within);
        if (counted !== null && counted > NETWORK_DAILY_DOWNLOADS) remember(overCap, network, midnight);
        within = counted !== null && counted <= NETWORK_DAILY_DOWNLOADS;
      }
      total = countOf(results[results.length - 1], within);
      clients = network ? [id, network, '*'] : [id, '*'];
    } catch {
      console.error('lumanest_subtitles_count_failed');
      return errorAnswer('unavailable', COUNT_RETRY_S);
    }
    await purgeOldCounts(ctx, db, now);
    if (!within || total === null) return errorAnswer('rate_limited', untilMidnight);
    if (total > budget) {
      budgetUsedUntil = Math.max(budgetUsedUntil, midnight);
      if (logged.usedUp !== day) {logged.usedUp = day; console.error('lumanest_subtitles_budget_used_up');}
      return errorAnswer('unavailable', untilMidnight);
    }
    if (total > budget * BUDGET_LOW_SHARE && logged.low !== day) {logged.low = day; console.error('lumanest_subtitles_budget_low');}
    return {db, day, clients};
  }

  /** Takes a download OpenSubtitles didn't count off every row it was counted in, after the answer when it can. */
  function uncount(ctx: Ctx, counted: Counted) {
    const {db, day, clients} = counted;
    const job = (async () => {await db.batch(clients.map(client => db.prepare(UNCOUNT).bind(day, client)));})()
      .catch(() => {console.error('lumanest_subtitles_uncount_failed');});
    if (ctx.waitUntil) {
      try {ctx.waitUntil(job); return Promise.resolve();} catch { /* not in a Worker request */ }
    }
    return job;
  }

  // ---------------------------------------------------------------- the endpoints

  const queryError = (query: LookupQuery | QueryError): query is QueryError => 'error' in query;

  return {
    /** GET /api/extras/subtitles */
    async subtitles(req: Request, deps: ExtrasDeps): Promise<Response> {
      const ctx = context(deps), url = new URL(req.url), who = client(ctx, req);
      if (await limited(ctx, 'lookup', who.prefix)) return errorAnswer('rate_limited', 60);
      const query = parseSubtitleQuery(url.searchParams);
      if (queryError(query)) return errorAnswer(query.error);
      const answer = (status: string, tmdb: number | null, cacheControl: string, tracks: unknown[] = []) =>
        json({v: EXTRAS_VERSION, status, tmdb, tracks, credit: CREDIT}, cacheControl);
      if (!ctx.osKey || !ctx.playerKey) return answer('not_configured', query.tmdb, CACHE.notConfigured);
      // While the download quota (or, as far as this isolate has seen, the day's budget) is used up, no file could be
      // served: offer none.
      if (budgetUsedUntil > ctx.now() || (await readState(ctx)).quotaUntil > ctx.now()) return answer('unavailable', query.tmdb, CACHE.none);
      let tmdb = query.tmdb, stale = false;
      if (tmdb === null) {
        const auth = tmdbAuth(ctx.env.TMDB_API_KEY);
        if (!auth) return answer('unmatched', null, CACHE.empty);
        const resolved = await resolveName(ctx, who, auth, query.media, query.name, query.year);
        if (resolved === 'limited') return errorAnswer('rate_limited', 60);
        if (resolved === 'failed') return errorAnswer('unavailable', 300);
        stale = resolved.stale;
        tmdb = resolved.id;
        if (tmdb === null) return answer('unmatched', null, stale ? CACHE.stale : CACHE.empty);
      }
      const id = tmdb;
      const result = await cached<PickedFile[]>(ctx, subtitlesObject(id, query.episode), readFiles, files => ({files}), async () => {
        const files = await searchSubtitles(ctx, id, query.episode);
        return {value: files, freshMs: files.length ? FRESH.subtitles : FRESH.noSubtitles};
      }, 'lumanest_subtitles_search_failed', mayMiss(ctx, who));
      if (result === 'limited') return errorAnswer('rate_limited', 60);
      if (!result) return errorAnswer('unavailable', 300);
      stale = stale || result.stale;
      const origin = url.origin;
      const tracks = await Promise.all(result.value.map(async file => {
        const token = await fileToken(ctx, file.file_id), base = origin + '/api/extras/subtitles/file/' + token;
        return {id: token, lang: 'en', label: file.label, hi: file.hi, vtt: base + '.vtt', srt: base + '.srt'};
      }));
      return answer(tracks.length ? 'ok' : 'none', id, stale ? CACHE.stale : tracks.length ? CACHE.ok : CACHE.empty, tracks);
    },

    /**
     * GET or HEAD /api/extras/subtitles/file/<file_id>-<mac>.<vtt|srt>: each GET is counted for the day (D1) and
     * downloads the file; the file is never stored.
     */
    async subtitleFile(req: Request, deps: ExtrasDeps, options: {head?: boolean} = {}): Promise<Response> {
      const ctx = context(deps), url = new URL(req.url), who = client(ctx, req);
      const match = FILE_PATH.exec(url.pathname);
      if (!match) return errorAnswer('not_found');
      // HEAD downloads nothing, so it counts as a lookup.
      if (await limited(ctx, options.head ? 'lookup' : 'file', who.prefix)) return errorAnswer('rate_limited', 60);
      if (!ctx.osKey || !ctx.playerKey) return errorAnswer('unavailable', 300);
      const fileId = Number(match[1]), format = match[3] as 'vtt' | 'srt';
      if (fileId > FILE_ID_MAX || !sameText(match[2], (await fileToken(ctx, fileId)).slice(String(fileId).length + 1))) return errorAnswer('not_found');
      const fileHeaders = headers({
        'Content-Type': FILE_TYPES[format], 'Cache-Control': 'private, max-age=604800', 'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      if (options.head) return new Response(null, {status: 200, headers: fileHeaders});
      const now = ctx.now(), state = await readState(ctx);
      if (state.quotaUntil > now) return errorAnswer('unavailable', retryAfter(state.quotaUntil, now));
      const counted = await countDownload(ctx, who);
      if (counted instanceof Response) return counted;
      const file = await download(ctx, fileId);
      if (!file.ok) {
        if (!file.spent) await uncount(ctx, counted);
        return errorAnswer(file.code, file.retryAfter);
      }
      const cues = parseSrt(file.text);
      if (!cues.length) return errorAnswer('unreadable');
      return new Response(format === 'vtt' ? toVtt(cues) : toSrt(cues), {status: 200, headers: fileHeaders});
    },

    /** GET /api/extras/trailer */
    async trailer(req: Request, deps: ExtrasDeps): Promise<Response> {
      const ctx = context(deps), url = new URL(req.url), who = client(ctx, req);
      if (await limited(ctx, 'lookup', who.prefix)) return errorAnswer('rate_limited', 60);
      const query = parseTrailerQuery(url.searchParams);
      if (queryError(query)) return errorAnswer(query.error);
      const answer = (status: string, tmdb: number | null, cacheControl: string, trailer: unknown = null) => json({v: EXTRAS_VERSION, status, tmdb, trailer}, cacheControl);
      const auth = tmdbAuth(ctx.env.TMDB_API_KEY);
      if (!auth) return answer('not_configured', query.tmdb, CACHE.notConfigured);
      let tmdb = query.tmdb, stale = false;
      if (tmdb === null) {
        const resolved = await resolveName(ctx, who, auth, query.media, query.name, query.year);
        if (resolved === 'limited') return errorAnswer('rate_limited', 60);
        if (resolved === 'failed') return errorAnswer('unavailable', 300);
        stale = resolved.stale;
        tmdb = resolved.id;
        if (tmdb === null) return answer('unmatched', null, stale ? CACHE.stale : CACHE.empty);
      }
      const id = tmdb;
      const result = await cached<{trailer: Trailer | null}>(ctx, trailerObject(query.media, id), readTrailer, value => value, async () => {
        await spend(ctx, 'tmdb');
        const body = await tmdbGet(ctx, auth, `/${query.media}/${id}/videos`, {language: 'en-US'});
        // TMDB answers 404 for an id it doesn't know: no trailer.
        if (body !== null && (!isObject(body) || !Array.isArray(body.results))) throw new Upstream('videos_shape');
        const trailer = body === null ? null : pickTrailer(body.results);
        return {value: {trailer}, freshMs: trailer ? FRESH.trailer : FRESH.noTrailer};
      }, 'lumanest_trailer_tmdb_failed', mayMiss(ctx, who));
      if (result === 'limited') return errorAnswer('rate_limited', 60);
      if (!result) return errorAnswer('unavailable', 300);
      stale = stale || result.stale;
      const trailer = result.value.trailer;
      if (!trailer) return answer('none', id, stale ? CACHE.stale : CACHE.empty);
      return answer('ok', id, stale ? CACHE.stale : CACHE.ok, {
        key: trailer.key, name: trailer.name, url: youtubeWatchURL(trailer.key), short: youtubeShortText(trailer.key), qr: qrRows(youtubeShortURL(trailer.key)),
      });
    },
  };
}

/** The isolate's instance, shared by the three routes. */
export const extras = createExtras();
