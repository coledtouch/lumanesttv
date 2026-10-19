// Movies & Series for the web player (docs/browse.md, "Web player" in docs/deployment.md). The browser never talks to
// the provider: every request here is built on the server from the signed-in line's sealed login and the configured
// Xtream server (TV_APP_XTREAM_SERVER), and goes through the same provider host rules, relay and redirect checks as
// streams (safeFetch). Nothing here takes an address from the browser, so it is not a proxy for anything else.
//
//   GET  /api/player/vod?v=1[&refresh=1]  the line's movies and series, compact, cached per line
//   GET  /api/player/vod/series?id=        one series' seasons and episodes
//   GET  /api/player/vod/movie?id=         one movie's details
//   POST /api/player/vod/play              a stream token for a movie or episode, like a channel's
//   GET  /api/player/image?t=&f=           a poster on a provider host or the line's catalogue image host, edge-cached
import * as workers from 'cloudflare:workers';
import {settings, ServiceError} from './mybunny';
import {assertNotRevoked, isDirectProviderAddress, isProviderAddress, isProviderHost, limitedText, ownHostNames, playerSecret, playlist, providerURL, safeFetch, session} from './player';
import {digest, mac, open, seal} from './player-crypto';
import type {PlayerMedia, PlayerSession} from './player-data';
import {compactCategory, compactXtream, type CompactCategory} from './browse';
import {
  VOD_LIMITS, VodError, XTREAM_ID, catalogueHostAddress, catalogueImageAddress, classifyPoster, compactMovieInfo, compactSeriesInfo, createCataloguePosters, createPosterBook,
  createPosterCounter, entryKind, imageAddress, posterTag, readJsonArray, sniffImage, validImageToken, vodLoginRejected, vodPlayURL, vodTimeout, vodTooLarge, vodUnavailable,
  xtreamServer, xtreamURL, VOD_EXTENSIONS, type XtreamAction,
} from './player-vod-data';
import type {CacheLike} from './catalog';

/** Timings, in one object so the runtime tests can shorten them. */
export const VOD_TIMING = {
  /** A cached catalogue is served as it is this long, then refreshed in the background while it is still served. */
  freshMs: 30 * 60 * 1000,
  /** How long a catalogue is kept at all (Cache-Control max-age of the cached copy). */
  staleMs: 12 * 60 * 60 * 1000,
  /** "Refresh movies & series" at most this often per line. */
  refreshMs: 5 * 60 * 1000,
  /** Every request of a build a viewer waits for ends by then. */
  buildMs: 40000,
  /**
   * A background build (while a stale copy is served) ends by then: waitUntil work still running 30 seconds after
   * the response is cancelled, and a cancelled build's own timers never fire.
   */
  backgroundMs: 25000,
  /** After a failed build, that line's catalogue is not built again for this long (the copy there is, is served). */
  failedMs: 5 * 60 * 1000,
  /** Each provider request must start answering within this. */
  headersMs: 8000,
  /** A request with no copy waits this long for another build (this isolate's or another's) before 503 vod_busy. */
  waitMs: 15000,
  /** Series and movie details are cached this long. */
  infoMs: 6 * 60 * 60 * 1000,
  imageMs: 10000,
  /** An isolate re-reads a line's recorded catalogue image host after this long (imageHostNoneMs when none was recorded). */
  imageHostMs: 5 * 60 * 1000,
  imageHostNoneMs: 30 * 1000,
  /**
   * A poster on a catalogue image host other than the one this isolate last read for the line has the record read
   * again, at most this often per line (so a new host works within seconds everywhere, and an old one stops).
   */
  imageHostRecheckMs: 10 * 1000,
  /** After this many failed answers in a row from a line's catalogue image host, it is not asked for 10 minutes. */
  imageHostFailures: 20,
  now: () => Date.now(),
};
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_CACHE_SECONDS = 7 * 24 * 60 * 60;
/** A poster the provider says is gone (404, 410) or that is not an image is not asked for again for an hour. */
const IMAGE_MISSING_SECONDS = 60 * 60;
/** A poster the provider failed to serve (an error, no answer) is not asked for again for 10 minutes. */
const IMAGE_FAILED_SECONDS = 10 * 60;
/** A line's catalogue image host is recorded for as long as a poster token made with it can live (8 days). */
const IMAGE_HOST_SECONDS = 8 * 24 * 60 * 60;
/** Sent to a catalogue image host (many sit behind bot rules that challenge requests with no User-Agent). */
const IMAGE_HOST_AGENT = 'Mozilla/5.0 (compatible; LumaNestPosters/1.0; +https://lumanest.tv)';

/**
 * Hosts a catalogue image host can never be, for a request to this origin: a provider or relay host by any scheme
 * (lib/player.ts isProviderHost), or one of this site's own hosts or anything under them (ownHostNames).
 */
function refusedImageHost(origin: string) {
  const own = ownHostNames(origin);
  return (url: URL) => {
    const name = url.hostname.toLowerCase();
    return own.some(root => name === root || name.endsWith('.' + root)) || isProviderHost(url);
  };
}

function toService(error: unknown): unknown {
  if (error instanceof VodError) return new ServiceError(error.status, error.code, error.message);
  return error;
}

/**
 * The location's Workers Cache API, or null without one. Cache operations do nothing on *.workers.dev (Cloudflare
 * caches only on custom domains), so there this isolate's own memory keeps the catalogue instead.
 */
function sharedCache(origin: string): CacheLike | null {
  try {if (new URL(origin).hostname.endsWith('.workers.dev')) return null;} catch {return null;}
  try {return (globalThis as unknown as {caches?: {default?: CacheLike}}).caches?.default || null;}
  catch {return null;}
}

function waitUntil(promise: Promise<unknown>) {
  try {workers.waitUntil?.(promise);} catch { /* not running in Workers */ }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Fixed-window counters per player session in this isolate. */
function limiter(max: number, code: string, message: string) {
  const windows = new Map<string, {start: number; count: number}>();
  return (id: string) => {
    const now = Date.now();
    let entry = windows.get(id);
    if (!entry || now - entry.start >= 60000) {
      if (windows.size >= 5000) windows.clear();
      windows.set(id, entry = {start: now, count: 0});
    }
    if (++entry.count > max) throw new ServiceError(429, code, message, String(Math.max(1, Math.ceil((entry.start + 60000 - now) / 1000))));
  };
}
const infoLimit = limiter(60, 'too_many_requests', 'Too many requests. Please wait a moment and try again.');
const playLimit = limiter(60, 'too_many_requests', 'Too many requests. Please wait a moment and try again.');
const imageLimit = limiter(900, 'too_many_requests', 'Too many requests.');
/**
 * PLAYER_LIMITER (optional Workers Rate Limiting binding, see scripts/prepare-cloudflare.mjs) counts poster requests
 * per line across isolates in a location; the per-isolate limits above apply either way.
 */
async function lineLimited(key: string) {
  const binding = (settings() as unknown as {PLAYER_LIMITER?: {limit?: (options: {key: string}) => Promise<{success?: boolean}>}}).PLAYER_LIMITER;
  if (!binding || typeof binding.limit !== 'function') return false;
  try {return (await binding.limit({key}))?.success === false;}
  catch {return false;}
}

type ServerReason = 'not_configured' | 'server_not_approved' | 'server_on_relay';
let warnedServer = false;
/**
 * The configured Xtream server, if it is set and on an approved provider host this Worker reaches directly. Never
 * fetched otherwise. A server on a relay host is refused: the stream relay passes only media, never player_api.php.
 */
export function configuredXtream(): {server: string} | {reason: ServerReason} {
  const parsed = xtreamServer(settings().TV_APP_XTREAM_SERVER);
  let reason: ServerReason | null = 'error' in parsed ? parsed.error : null;
  if (!reason) {
    const api = new URL('/player_api.php', (parsed as {server: string}).server);
    if (!isDirectProviderAddress(api)) reason = isProviderAddress(api) ? 'server_on_relay' : 'server_not_approved';
  }
  if (!reason) return parsed as {server: string};
  if (reason !== 'not_configured' && !warnedServer) {warnedServer = true; console.error(reason === 'server_on_relay' ? 'lumanest_vod_server_on_relay' : 'lumanest_vod_server_unapproved');}
  return {reason};
}

/** One Xtream request; its body is still to be read. Fixed errors only: no address is ever thrown or logged. */
async function xtreamFetch(server: string, credentials: PlayerSession, action: XtreamAction, signal: AbortSignal, id?: string) {
  const headers = new AbortController();
  const timer = setTimeout(() => headers.abort(), VOD_TIMING.headersMs);
  let response: Response;
  try {response = await safeFetch(xtreamURL(server, credentials, action, id), {headers: {Accept: 'application/json'}, signal: AbortSignal.any([signal, headers.signal])});}
  catch (error) {throw signal.aborted || headers.signal.aborted ? vodTimeout() : error instanceof VodError ? error : vodUnavailable();}
  finally {clearTimeout(timer);}
  if (response.status === 401 || response.status === 403) {await response.body?.cancel(); throw vodLoginRejected();}
  if (!response.ok) {await response.body?.cancel(); throw vodUnavailable();}
  return response;
}

// ---------------------------------------------------------------- the catalogue

/** One type's lists: its categories, and each title already as JSON text (far smaller than 50,000 objects). */
type Section = {categories: CompactCategory[]; items: string[]; bytes: number; truncated: boolean};

const sectionJson = (section: Section) => '{"categories":' + JSON.stringify(section.categories) + ',"items":[' + section.items.join(',') + '],"truncated":' + section.truncated + '}';

type Bytes = Uint8Array<ArrayBuffer>;
/** The key of a line's catalogue (and of its recorded catalogue image host) in the cache: a keyed hash of the line. */
const catalogueKey = (server: string, credentials: PlayerSession, secret: string) => mac(server + '\n' + credentials.username + '\n' + credentials.password, secret, 'player-cache');
/**
 * Fetches and compacts one line's four lists in turn (categories and titles, movies then series) and returns the
 * catalogue as UTF-8 bytes, encoded once for both the cache and the viewer, with the line's catalogue image host (or
 * null). origin: the site origin the request came to (its hosts are never an image host). Every request ends by
 * deadlineMs.
 */
async function buildCatalogue(server: string, credentials: PlayerSession, secret: string, deadlineMs: number, origin: string): Promise<{body: Bytes; imageHost: string | null}> {
  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  try {
    const line = await mac(credentials.username, secret, 'player-line');
    const posters = createCataloguePosters(isDirectProviderAddress, refusedImageHost(origin), [credentials.username, credentials.password], {tag: address => posterTag(secret, line, address)});
    let used = 0;
    const read = async (kind: 'movie' | 'series', budget: number): Promise<Section> => {
      const categories: CompactCategory[] = [];
      const listed = await xtreamFetch(server, credentials, kind === 'movie' ? 'get_vod_categories' : 'get_series_categories', deadline.signal);
      await readJsonArray(listed.body, raw => {
        const category = compactCategory(raw);
        if (category && categories.length < VOD_LIMITS.categories) categories.push(category);
      }, {maxBytes: VOD_LIMITS.categoryBytes, maxItems: VOD_LIMITS.categories, signal: deadline.signal});
      const section: Section = {categories, items: [], bytes: 0, truncated: false};
      const titles = await xtreamFetch(server, credentials, kind === 'movie' ? 'get_vod_streams' : 'get_series', deadline.signal);
      const result = await readJsonArray(titles.body, raw => {
        const item = compactXtream(kind, raw);
        if (!item) return;
        // A poster that may be on the catalogue image host waits for the end of the lists. It takes no room meanwhile:
        // titles come first, and finish adds posters only in the room the titles leave.
        let waiting: Exclude<ReturnType<typeof posters.place>, string | undefined> | null = null;
        if (item.poster) {
          const poster = posters.place(item.poster);
          if (typeof poster === 'string') item.poster = poster;
          else {
            waiting = poster || null;
            delete item.poster;
          }
        }
        const text = JSON.stringify(item);
        // Past the byte budget the list is cut, like a list past VOD_LIMITS.items.
        if (section.bytes + text.length + 1 > budget) return false;
        if (waiting) posters.wait(section.items, section.items.length, waiting, kind === 'movie' ? 0 : 1);
        section.items.push(text);
        section.bytes += text.length + 1;
      }, {maxBytes: VOD_LIMITS.listBytes, maxItems: VOD_LIMITS.items, signal: deadline.signal});
      section.truncated = result.truncated;
      used += section.bytes;
      return section;
    };
    const movies = await read('movie', Math.min(VOD_LIMITS.moviesBytes, VOD_LIMITS.catalogueBytes));
    const series = await read('series', VOD_LIMITS.catalogueBytes - used);
    // The catalogue image host's posters fit in what is left of catalogueBytes once every title is in. moviesBytes only
    // keeps room for the series titles, which are in by now, so movie posters may use it too.
    const host = posters.finish({room: VOD_LIMITS.catalogueBytes - movies.bytes - series.bytes});
    const posterBases = await posters.book.seal(line, secret, VOD_TIMING.now());
    const generated = new Date(VOD_TIMING.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = new TextEncoder().encode('{"v":1,"source":"xtream","generated":' + JSON.stringify(generated) + ',"posterBases":' + JSON.stringify(posterBases) +
      ',"movies":' + sectionJson(movies) + ',"series":' + sectionJson(series) + '}') as Bytes;
    // Counts only: never the host.
    console.log('lumanest_vod_build', JSON.stringify({ms: Date.now() - started, movies: movies.items.length, series: series.items.length, bytes: body.byteLength, truncated: movies.truncated || series.truncated, imageHost: Boolean(host.host), imageHostPosters: host.placed, imageHostSkipped: host.skipped}));
    return {body, imageHost: host.host};
  } catch (error) {
    console.error('lumanest_vod_failed', JSON.stringify({code: error instanceof VodError ? error.code : 'vod_unavailable'}));
    throw error instanceof VodError ? error : vodUnavailable();
  } finally {clearTimeout(timer);}
}

type Snapshot = {body: ReadableStream<Uint8Array> | Bytes; freshUntil: number};
type HoldName = 'building' | 'refresh' | 'failed';
type Store = {
  /** The site origin the request came to. */
  origin: string;
  read(): Promise<Snapshot | null>;
  /** imageHost: the catalogue image host this catalogue's posters use, kept with it (X-Vod-Image-Host). */
  write(body: Bytes, freshUntil: number, imageHost?: string | null): Promise<void>;
  hold(name: HoldName, seconds: number, value?: string): Promise<void>;
  /** The hold's value ('1' unless one was given), or null when it is not held. */
  held(name: HoldName): Promise<string | null>;
  release(name: HoldName): Promise<void>;
  /**
   * The line's catalogue image host (an origin) as its catalogue in this location has it, or null. wanted: the host a
   * poster asks for; when this isolate's copy names another one, the location is asked again (at most every
   * imageHostRecheckMs).
   */
  imageHost(wanted?: string): Promise<string | null>;
  recordImageHost(origin: string | null): Promise<void>;
};

/** This isolate's copy of each line's catalogue image host ('' for none): when it was read, and until when it holds. */
const imageHosts = new Map<string, {origin: string; read: number; until: number}>();
function rememberImageHost(key: string, origin: string, ms: number) {
  imageHosts.delete(key);
  if (imageHosts.size >= 5000) imageHosts.delete(imageHosts.keys().next().value!);
  imageHosts.set(key, {origin, read: Date.now(), until: Date.now() + ms});
}
/** This isolate's copy, unless it has run out, or names a host other than wanted and may be checked again. */
function knownImageHost(key: string, wanted?: string) {
  const known = imageHosts.get(key);
  if (!known || known.until <= Date.now()) return null;
  if (wanted !== undefined && known.origin !== wanted && Date.now() - known.read >= VOD_TIMING.imageHostRecheckMs) return null;
  return known;
}
const IMAGE_HOST_HEADER = 'X-Vod-Image-Host';

// Without the Workers Cache API (local preview, workers.dev, some tests) a line's catalogue is kept in this isolate,
// two at most.
const memo = new Map<string, {body: Bytes; freshUntil: number; expires: number}>();
const memoHolds = new Map<string, {until: number; value: string}>();
function store(origin: string, key: string): Store {
  const cache = sharedCache(origin);
  if (!cache) return {
    origin,
    async read() {
      const entry = memo.get(key);
      return entry && entry.expires > VOD_TIMING.now() ? {body: entry.body, freshUntil: entry.freshUntil} : null;
    },
    async write(body, freshUntil) {
      memo.delete(key);
      if (memo.size >= 2) memo.delete(memo.keys().next().value!);
      memo.set(key, {body, freshUntil, expires: VOD_TIMING.now() + VOD_TIMING.staleMs});
    },
    async hold(name, seconds, value = '1') {
      if (memoHolds.size >= 5000) memoHolds.clear();
      memoHolds.set(key + name, {until: Date.now() + seconds * 1000, value});
    },
    async held(name) {
      const hold = memoHolds.get(key + name);
      return hold && hold.until > Date.now() ? hold.value : null;
    },
    async release(name) {memoHolds.delete(key + name);},
    async imageHost() {
      const known = imageHosts.get(key);
      return known && known.until > Date.now() ? known.origin || null : null;
    },
    async recordImageHost(host) {rememberImageHost(key, host || '', IMAGE_HOST_SECONDS * 1000);},
  };
  const dataKey = origin + '/__lumanest-cache/vod-v1/' + key;
  return {
    origin,
    async read() {
      const response = await cache.match(dataKey);
      if (!response) return null;
      const freshUntil = Number(response.headers.get('X-Vod-Fresh-Until'));
      return {body: response.body || new Uint8Array(0) as Bytes, freshUntil: Number.isFinite(freshUntil) ? freshUntil : 0};
    },
    async write(body, freshUntil, imageHost = null) {
      await cache.put(dataKey, new Response(body, {headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + Math.ceil(VOD_TIMING.staleMs / 1000), 'X-Vod-Fresh-Until': String(freshUntil),
        ...(imageHost ? {[IMAGE_HOST_HEADER]: imageHost} : {}),
      }}));
    },
    async hold(name, seconds, value = '1') {
      await cache.put(dataKey + '-' + name, new Response(value, {headers: {'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=' + Math.max(1, Math.ceil(seconds))}}));
    },
    async held(name) {
      const response = await cache.match(dataKey + '-' + name);
      if (!response) return null;
      return (await response.text().catch(() => '1')).slice(0, 40) || '1';
    },
    async release(name) {await cache.delete(dataKey + '-' + name);},
    // The catalogue copy itself says which host its posters use (written with it, so the two can't disagree). The
    // small record is kept 8 days, as long as the poster links: it answers once the copy has expired (12 hours).
    async imageHost(wanted) {
      const known = knownImageHost(key, wanted);
      if (known) return known.origin || null;
      let host = '';
      const copy = await cache.match(dataKey);
      if (copy) {
        host = (copy.headers.get(IMAGE_HOST_HEADER) || '').slice(0, 300);
        await copy.body?.cancel().catch(() => {});
      } else {
        const record = await cache.match(dataKey + '-imagehost');
        host = record ? (await record.text()).slice(0, 300) : '';
      }
      rememberImageHost(key, host, host ? VOD_TIMING.imageHostMs : VOD_TIMING.imageHostNoneMs);
      return host || null;
    },
    async recordImageHost(host) {
      rememberImageHost(key, host || '', VOD_TIMING.imageHostMs);
      if (host) await cache.put(dataKey + '-imagehost', new Response(host, {headers: {'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=' + IMAGE_HOST_SECONDS}}));
      else await cache.delete(dataKey + '-imagehost');
    },
  };
}

/**
 * The one catalogue build this isolate runs at a time (a 50,000-title list takes tens of MB while it is built). A
 * build past its deadline no longer counts: the request that ran it was cancelled (waitUntil work is cancelled 30
 * seconds after the response), and a cancelled request's timers and promises never settle.
 */
type Build = {key: string; started: number; deadlineMs: number; done: Promise<Bytes>};
let slot: Build | null = null;
function runningBuild(): Build | null {
  if (slot && Date.now() - slot.started > slot.deadlineMs + 5000) slot = null;
  return slot;
}
/** Lines whose last build failed in this isolate: when, until when it holds, and with which error. */
type Failure = {at: number; until: number; code: string};
const failures = new Map<string, Failure>();
const refreshedAt = new Map<string, number>();

const busy = () => new ServiceError(503, 'vod_busy', 'Movies and series are being prepared. Please try again in a few seconds.', '10');
const FAILURE_CODES: Record<string, () => VodError> = {vod_too_large: vodTooLarge, vod_timeout: vodTimeout, invalid_line_login: vodLoginRejected, vod_unavailable: vodUnavailable};
/** The error a failed build gave, again, with when to try next. */
function failedError(code: string, untilMs: number) {
  const error = (FAILURE_CODES[code] || vodUnavailable)();
  return new ServiceError(error.status, error.code, error.message, String(Math.max(1, Math.ceil((untilMs - Date.now()) / 1000))));
}
/** A failed build of this line that still holds (this isolate's record, then the location's), or null. */
async function failedBuild(key: string, cacheStore: Store): Promise<Failure | null> {
  const known = failures.get(key);
  if (known && known.until > Date.now()) return known;
  const held = await cacheStore.held('failed').catch(() => null);
  if (!held) return null;
  const [code, at] = held.split(' ');
  const when = Math.min(Number(at) || Date.now(), Date.now());
  return {code: FAILURE_CODES[code] ? code : 'vod_unavailable', at: when, until: Math.max(when + VOD_TIMING.failedMs, Date.now() + 1000)};
}
const discard = (snapshot: Snapshot | null) => {if (snapshot?.body instanceof ReadableStream) void snapshot.body.cancel().catch(() => {});};

/** Starts one line's build in this isolate's slot (the caller has checked that it is free). */
function startBuild(key: string, server: string, credentials: PlayerSession, cacheStore: Store, deadlineMs: number): Build {
  const job = (async () => {
    await cacheStore.hold('building', Math.ceil(deadlineMs / 1000) + 5).catch(() => {});
    try {
      const {body, imageHost} = await buildCatalogue(server, credentials, playerSecret(), deadlineMs, cacheStore.origin);
      failures.delete(key);
      // Recorded before the catalogue is served or stored, so its posters work as soon as the viewer has it.
      await cacheStore.recordImageHost(imageHost).catch(() => {});
      await cacheStore.write(body, VOD_TIMING.now() + VOD_TIMING.freshMs, imageHost).catch(() => {});
      await cacheStore.release('failed').catch(() => {});
      return body;
    } catch (error) {
      // The provider is left alone for this line for a while; requests meanwhile get the copy there is, or this error.
      const code = error instanceof VodError ? error.code : 'vod_unavailable';
      const at = Date.now();
      if (failures.size >= 5000) failures.clear();
      failures.set(key, {at, until: at + VOD_TIMING.failedMs, code});
      await cacheStore.hold('failed', VOD_TIMING.failedMs / 1000, code + ' ' + at).catch(() => {});
      throw error;
    } finally {
      await cacheStore.release('building').catch(() => {});
    }
  })();
  const build: Build = {key, started: Date.now(), deadlineMs, done: job};
  slot = build;
  void job.finally(() => {if (slot === build) slot = null;}).catch(() => {});
  // The build finishes and is stored even if this viewer leaves.
  waitUntil(job.catch(() => {}));
  return build;
}

/** The value of a promise, or null once ms have passed (the promise carries on). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<null>(resolve => {timer = setTimeout(() => resolve(null), ms);})]);}
  finally {clearTimeout(timer);}
}

/** What a request waits for: a copy fresh until after `freshAfter`, or a build that failed at or after `failedAfter`. */
type Since = {freshAfter: number; failedAfter: number};

/**
 * Waits until the line has a new copy (built in this isolate or another), its build fails, nobody is building it any
 * more (null), or `until` passes (null). Never waits on another request's promise for more than a second at a time,
 * so a build lost with its request can't hold this one up.
 */
async function waitForCopy(key: string, cacheStore: Store, since: Since, until: number): Promise<Snapshot | null> {
  while (Date.now() < until) {
    const step = Math.min(1000, until - Date.now());
    const running = runningBuild();
    if (running?.key === key) {
      const body = await within(running.done.catch(() => null), step);
      if (body) return {body, freshUntil: VOD_TIMING.now() + VOD_TIMING.freshMs};
    } else await sleep(step);
    const copy = await cacheStore.read().catch(() => null);
    if (copy && copy.freshUntil > since.freshAfter) return copy;
    discard(copy);
    const failed = await failedBuild(key, cacheStore);
    if (failed && failed.at >= since.failedAfter) throw failedError(failed.code, failed.until);
    if (!runningBuild() && !await cacheStore.held('building').catch(() => null)) return null;
  }
  return null;
}

/** Builds the line's catalogue now and returns it, waiting up to waitMs for this isolate's slot or another build. */
async function buildNow(key: string, server: string, credentials: PlayerSession, cacheStore: Store, since: Since): Promise<Snapshot> {
  const until = Date.now() + VOD_TIMING.waitMs;
  for (;;) {
    const elsewhere = !runningBuild() && Boolean(await cacheStore.held('building').catch(() => null));
    // Read again after the await: another request may have started a build meanwhile.
    const running = runningBuild();
    if (running?.key === key || (!running && elsewhere)) {
      // This line is being built (here or in another isolate): its copy is the one to serve.
      const copy = await waitForCopy(key, cacheStore, since, until);
      if (copy) return copy;
      if (Date.now() >= until) throw busy();
      continue;
    }
    if (!running) {
      const body = await startBuild(key, server, credentials, cacheStore, VOD_TIMING.buildMs).done;
      return {body, freshUntil: VOD_TIMING.now() + VOD_TIMING.freshMs};
    }
    // Another line's build holds this isolate: wait for it, a second at a time.
    if (Date.now() >= until) throw busy();
    await within(running.done.catch(() => null), Math.min(1000, until - Date.now()));
  }
}

const NONE = (reason: string) => JSON.stringify({v: 1, source: 'none', reason, posterBases: [], movies: {categories: [], items: [], truncated: false}, series: {categories: [], items: [], truncated: false}});
const catalogueHeaders = (stale = false): Record<string, string> => ({'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...(stale ? {'X-Vod-Stale': '1'} : {})});

export async function vodCatalogue(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url), version = url.searchParams.get('v');
    if (version !== null && version !== '1') throw new ServiceError(400, 'unsupported_version', 'This catalogue version is not available.');
    const {credentials} = await session(req);
    await assertNotRevoked(credentials);
    const config = configuredXtream();
    if ('reason' in config) return new Response(NONE(config.reason), {headers: catalogueHeaders()});
    const secret = playerSecret();
    const key = await catalogueKey(config.server, credentials, secret);
    const cacheStore = store(url.origin, key);
    if (url.searchParams.get('refresh') === '1') {
      const last = refreshedAt.get(key) || 0;
      const wait = last + VOD_TIMING.refreshMs - VOD_TIMING.now();
      if (wait > 0 || await cacheStore.held('refresh').catch(() => null)) {
        throw new ServiceError(429, 'vod_refresh_limited', 'Movies and series were refreshed a moment ago. Try again in a few minutes.', String(Math.max(1, Math.ceil((wait > 0 ? wait : VOD_TIMING.refreshMs) / 1000))));
      }
      if (refreshedAt.size >= 5000) refreshedAt.clear();
      refreshedAt.set(key, VOD_TIMING.now());
      await cacheStore.hold('refresh', Math.ceil(VOD_TIMING.refreshMs / 1000)).catch(() => {});
      // Asked for by the viewer (at most once per 5 minutes, even after a failed build): wait for a new copy; if the
      // provider fails, the copy there was is served.
      // A new copy is fresh until at least freshMs from now; an older failure doesn't end the wait.
      const since = {freshAfter: VOD_TIMING.now() + VOD_TIMING.freshMs, failedAfter: Date.now()};
      try {return new Response((await buildNow(key, config.server, credentials, cacheStore, since)).body, {headers: catalogueHeaders()});}
      catch (error) {
        const kept = await cacheStore.read().catch(() => null);
        if (kept) return new Response(kept.body, {headers: catalogueHeaders(true)});
        throw error;
      }
    }
    const cached = await cacheStore.read().catch(() => null);
    if (cached && cached.freshUntil > VOD_TIMING.now()) return new Response(cached.body, {headers: catalogueHeaders()});
    if (cached) {
      // Stale: served at once while one refresh runs in the background, unless a build is running here or in another
      // isolate, or the last one failed a moment ago.
      if (!runningBuild() && !await cacheStore.held('building').catch(() => '1') && !await failedBuild(key, cacheStore) && !runningBuild()) {
        startBuild(key, config.server, credentials, cacheStore, Math.min(VOD_TIMING.buildMs, VOD_TIMING.backgroundMs));
      }
      return new Response(cached.body, {headers: catalogueHeaders(true)});
    }
    const failed = await failedBuild(key, cacheStore);
    if (failed) throw failedError(failed.code, failed.until);
    return new Response((await buildNow(key, config.server, credentials, cacheStore, {freshAfter: 0, failedAfter: 0})).body, {headers: catalogueHeaders()});
  } catch (error) {throw toService(error);}
}

// ---------------------------------------------------------------- series and movie details

async function details(req: Request, kind: 'series' | 'movie') {
  try {
    const url = new URL(req.url);
    const {credentials} = await session(req);
    await assertNotRevoked(credentials);
    infoLimit(credentials.sid);
    const id = url.searchParams.get('id') || '';
    if (!XTREAM_ID.test(id)) throw new ServiceError(400, 'invalid_title', 'Choose a movie or series from your line.');
    const config = configuredXtream();
    if ('reason' in config) throw new ServiceError(404, 'title_not_found', 'This title is not available.');
    const secret = playerSecret();
    const key = await mac([config.server, credentials.username, credentials.password, kind, id].join('\n'), secret, 'player-cache');
    const cache = sharedCache(url.origin);
    const cacheKey = url.origin + '/__lumanest-cache/vod-' + kind + '-v1/' + key;
    const hit = await cache?.match(cacheKey).catch(() => undefined);
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
    if (hit) return new Response(hit.body, {headers});
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20000)]);
    const response = await xtreamFetch(config.server, credentials, kind === 'series' ? 'get_series_info' : 'get_vod_info', signal, id);
    let raw: unknown;
    try {raw = JSON.parse(await limitedText(response, kind === 'series' ? VOD_LIMITS.seriesInfoBytes : VOD_LIMITS.movieInfoBytes));}
    catch (error) {throw error instanceof ServiceError && error.code === 'playlist_too_large' ? new ServiceError(502, 'vod_too_large', 'This title’s details are too large to show.') : vodUnavailable();}
    let body: string;
    if (kind === 'series') {
      const info = compactSeriesInfo(raw, id);
      if (!info.seasons.length) throw new ServiceError(404, 'title_not_found', 'This series has no episodes on your line.');
      const line = await mac(credentials.username, secret, 'player-line');
      const posters = createPosterBook(isDirectProviderAddress, [credentials.username, credentials.password], VOD_LIMITS.posterBases, address => posterTag(secret, line, address));
      // A cover on the line's catalogue image host is proxied like the catalogue's posters.
      const imageHost = info.poster ? await store(url.origin, await catalogueKey(config.server, credentials, secret)).imageHost().catch(() => null) : null;
      const poster = info.poster ? posters.add(info.poster, imageHost) : undefined;
      const posterBases = posters.size ? await posters.seal(line, secret, VOD_TIMING.now()) : [];
      body = JSON.stringify({...info, poster: poster || '', posterBases});
    } else body = JSON.stringify(compactMovieInfo(raw, id));
    if (cache) waitUntil(cache.put(cacheKey, new Response(body, {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + Math.ceil(VOD_TIMING.infoMs / 1000)}})).catch(() => {}));
    return new Response(body, {headers});
  } catch (error) {throw toService(error);}
}
export const vodSeries = (req: Request) => details(req, 'series');
export const vodMovie = (req: Request) => details(req, 'movie');

// ---------------------------------------------------------------- playing a movie or episode

/**
 * A stream token for a movie or episode, sealed exactly like a channel's (bound to this browser's session, root, until
 * the sign-in expires), so /api/player/stream, seeking, the relay and casting treat it as they treat channels. The
 * address is built here from the configured server and this session's login; the browser only names the title.
 */
export async function vodPlay(req: Request, body: unknown) {
  try {
    const {credentials, binding} = await session(req);
    await assertNotRevoked(credentials);
    playLimit(credentials.sid);
    const fields = body && typeof body === 'object' ? body as {type?: unknown; id?: unknown; ext?: unknown} : {};
    const type = fields.type === 'movie' || fields.type === 'episode' ? fields.type : null;
    const id = typeof fields.id === 'string' ? fields.id : '';
    const ext = typeof fields.ext === 'string' ? fields.ext.toLowerCase() : '';
    if (!type || !XTREAM_ID.test(id) || !VOD_EXTENSIONS.has(ext)) throw new ServiceError(400, 'invalid_title', 'Choose a movie or episode from your line.');
    const config = configuredXtream();
    if ('reason' in config) throw new ServiceError(404, 'title_not_found', 'This title is not available.');
    let source: URL;
    try {source = providerURL(vodPlayURL(config.server, credentials, type, id, ext));}
    catch {throw new ServiceError(404, 'title_not_found', 'This title is not available.');}
    const token = await seal({url: source.href, bind: binding, exp: credentials.exp, root: 1} satisfies PlayerMedia, playerSecret(), 'player-media');
    return {token, container: ext, expiresAt: credentials.exp};
  } catch (error) {throw toService(error);}
}

// ---------------------------------------------------------------- posters

let imageLogged = 0;
function imageFailed(code: string) {
  // At most one line a minute per isolate, with a fixed code: never the address.
  if (Date.now() - imageLogged < 60000) return;
  imageLogged = Date.now();
  console.warn('lumanest_image_failed', JSON.stringify({code}));
}
const imageHeaders = (type: string): Record<string, string> => ({
  'Content-Type': type, 'Cache-Control': 'private, max-age=' + IMAGE_CACHE_SECONDS, 'Content-Security-Policy': "sandbox; default-src 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
});
const imageForbidden = () => new ServiceError(403, 'image_forbidden', 'This poster is not available.');
const imageMissing = () => new ServiceError(404, 'image_not_found', 'This poster is not available.');

async function readBytes(response: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {await reader.cancel().catch(() => {}); return null;}
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return bytes;
}

/** Posters this isolate recently failed to get, by cache key, until when (also kept in the edge cache when there is one). */
const imageMisses = new Map<string, number>();
function rememberMiss(key: string, until: number) {
  imageMisses.delete(key);
  // The oldest go first, so a burst of new misses can't wipe out the ones being remembered.
  if (imageMisses.size >= 5000) imageMisses.delete(imageMisses.keys().next().value!);
  imageMisses.set(key, until);
}

/**
 * Lines whose catalogue image host keeps failing (an error, a failed status, not an image), by line and host: failed
 * answers in a row, and until when that host is not asked at all for that line. VOD_TIMING.imageHostFailures in a row
 * rest it for IMAGE_FAILED_SECONDS (per isolate), so a host that blocks the Worker costs a few requests, not one per
 * poster on every page.
 */
const hostTrouble = new Map<string, {failures: number; until: number}>();
function hostAnswered(key: string, ok: boolean) {
  const known = hostTrouble.get(key);
  hostTrouble.delete(key);
  if (ok) return;
  if (hostTrouble.size >= 5000) hostTrouble.delete(hostTrouble.keys().next().value!);
  const failures = (known?.failures || 0) + 1;
  hostTrouble.set(key, failures >= VOD_TIMING.imageHostFailures ? {failures: 0, until: Date.now() + IMAGE_FAILED_SECONDS * 1000} : {failures, until: known?.until || 0});
}
const hostResting = (key: string) => (hostTrouble.get(key)?.until || 0) > Date.now();

/**
 * Fetches a poster on the line's catalogue image host. Redirects are followed by hand, at most 4, and only to the same
 * host with the same checks (catalogueHostAddress); no cookie, referrer or login is ever sent.
 */
async function imageHostFetch(source: URL, host: string, refused: (url: URL) => boolean, secrets: string[], init: RequestInit, hops = 0): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', IMAGE_HOST_AGENT);
  const response = await fetch(source.href, {...init, headers, redirect: 'manual'});
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  await response.body?.cancel();
  const target = response.headers.get('Location');
  let next: URL | null = null;
  try {next = target ? catalogueHostAddress(new URL(target, source).href, host, refused, secrets) : null;} catch {next = null;}
  if (!next || hops >= 4) throw new ServiceError(502, 'image_redirect', 'This poster is not available.');
  return imageHostFetch(next, host, refused, secrets, init, hops + 1);
}

/**
 * A poster from a provider host or the line's catalogue image host, for a signed-in viewer of the line it was listed
 * for. The token names the poster's directory (with a plain image file name) or whole address, sealed for that line.
 * A provider host is checked again against the provider allowlists and must be one this Worker reaches directly (the
 * stream relay passes only media). A catalogue image host poster (h) must be an address the catalogue listed for this
 * line (its tag: catalogueImageAddress), on the host recorded for this line's catalogue right now, still pass the
 * catalogue host rules (https, default port, a public name, not a provider, relay or own host) and carry neither the
 * username nor the password. Only JPEG, PNG, GIF, WebP and AVIF up to 2 MB come back. Each poster is kept in the edge
 * cache for a week; a missing one for an hour and one the host failed to serve for 10 minutes, so a poster is asked for
 * at most that often, and a catalogue image host that keeps failing for a line rests (hostTrouble). A signed-out
 * session gets nothing (the sign-out check is cached for 20 seconds per isolate).
 */
export async function posterImage(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const {credentials} = await session(req);
    const raw = url.searchParams.get('t') || '', file = url.searchParams.get('f') || '';
    if (!raw || raw.length > 2048 || file.length > 320) throw imageForbidden();
    imageLimit(credentials.sid);
    await assertNotRevoked(credentials);
    const secret = playerSecret();
    let item: unknown;
    try {item = await open<unknown>(raw, secret, 'player-image');} catch {throw imageForbidden();}
    const line = await mac(credentials.username, secret, 'player-line');
    if (!validImageToken(item, line, VOD_TIMING.now())) throw imageForbidden();
    let source: URL;
    let get: (init: RequestInit) => Promise<Response>;
    // For a catalogue image host poster: this line and host, for hostTrouble.
    let trouble = '';
    if (item.h === 1) {
      const address = catalogueImageAddress(item, file, value => posterTag(secret, line, value));
      const config = configuredXtream();
      if (!address || 'reason' in config) throw imageForbidden();
      const refused = refusedImageHost(url.origin), secrets = [credentials.username, credentials.password];
      let wanted: string;
      try {wanted = new URL(address).origin;} catch {throw imageForbidden();}
      const host = await store(url.origin, await catalogueKey(config.server, credentials, secret)).imageHost(wanted).catch(() => null);
      const checked = host ? catalogueHostAddress(address, host, refused, secrets) : null;
      if (!host || !checked) throw imageForbidden();
      source = checked;
      trouble = line + '\n' + host;
      get = init => imageHostFetch(checked, host, refused, secrets, init);
    } else {
      const address = imageAddress(item, file);
      if (!address) throw imageForbidden();
      try {source = providerURL(address);} catch {throw imageForbidden();}
      if (!isDirectProviderAddress(source)) throw imageForbidden();
      const checked = source;
      get = init => safeFetch(checked.href, init);
    }
    const cache = sharedCache(url.origin);
    const cacheKey = url.origin + '/__lumanest-cache/img-v1/' + await digest(source.href);
    if ((imageMisses.get(cacheKey) || 0) > Date.now()) throw imageMissing();
    const hit = await cache?.match(cacheKey).catch(() => undefined);
    if (hit) {
      if (hit.headers.get('X-Image-Missing')) {await hit.body?.cancel(); throw imageMissing();}
      return new Response(hit.body, {headers: imageHeaders(hit.headers.get('Content-Type') || 'application/octet-stream')});
    }
    // A catalogue image host that keeps failing for this line is left alone for a while: nothing is sent to it.
    if (trouble && hostResting(trouble)) throw imageMissing();
    if (await lineLimited('image:' + line)) throw new ServiceError(429, 'too_many_requests', 'Too many requests.', '60');
    const remember = (body: Uint8Array<ArrayBuffer> | null, type: string, seconds = IMAGE_CACHE_SECONDS) => {
      if (trouble) hostAnswered(trouble, Boolean(body));
      if (!body) rememberMiss(cacheKey, Date.now() + seconds * 1000);
      if (!cache) return;
      const headers: Record<string, string> = body ? {'Content-Type': type, 'Cache-Control': 'public, max-age=' + seconds} : {'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=' + seconds, 'X-Image-Missing': '1'};
      waitUntil(cache.put(cacheKey, new Response(body ? body.slice() : '', {headers})).catch(() => {}));
    };
    let upstream: Response;
    try {upstream = await get({headers: {Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'}, signal: AbortSignal.any([req.signal, AbortSignal.timeout(VOD_TIMING.imageMs)])});}
    catch {
      if (!req.signal.aborted) remember(null, '', IMAGE_FAILED_SECONDS);
      imageFailed('image_fetch_failed'); throw imageMissing();
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      // A poster the provider says is gone is remembered for an hour, any other failure for 10 minutes.
      remember(null, '', upstream.status === 404 || upstream.status === 410 ? IMAGE_MISSING_SECONDS : IMAGE_FAILED_SECONDS);
      imageFailed('image_upstream_' + upstream.status);
      throw imageMissing();
    }
    let bytes: Uint8Array<ArrayBuffer> | null;
    try {bytes = await readBytes(upstream, IMAGE_MAX_BYTES);}
    catch {
      if (!req.signal.aborted) remember(null, '', IMAGE_FAILED_SECONDS);
      imageFailed('image_read_failed'); throw imageMissing();
    }
    const type = bytes ? sniffImage(bytes) : null;
    if (!bytes || !type) {remember(null, '', IMAGE_MISSING_SECONDS); imageFailed(bytes ? 'image_not_raster' : 'image_too_large'); throw imageMissing();}
    remember(bytes, type);
    return new Response(bytes, {headers: imageHeaders(type)});
  } catch (error) {throw toService(error);}
}

// ---------------------------------------------------------------- owner diagnostics

/**
 * Asks the catalogue image host for one of its posters the way the image route does (not cached, nothing kept), so the
 * owner can see whether the host answers the Worker with an image: the status, the image type found ('' when the
 * answer is not a raster image up to 2 MB) and the time. Never the address.
 */
async function probeImageHost(sample: string, host: string, refused: (url: URL) => boolean, secrets: string[], signal: AbortSignal) {
  const started = Date.now();
  const source = sample ? catalogueHostAddress(sample, host, refused, secrets) : null;
  if (!source) return {status: 0, image: '', ms: 0};
  try {
    const response = await imageHostFetch(source, host, refused, secrets, {headers: {Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'}, signal: AbortSignal.any([signal, AbortSignal.timeout(VOD_TIMING.imageMs)])});
    const bytes = response.ok ? await readBytes(response, IMAGE_MAX_BYTES).catch(() => null) : (await response.body?.cancel().catch(() => {}), null);
    return {status: response.status, image: bytes ? sniffImage(bytes) || '' : '', ms: Date.now() - started};
  } catch {
    return {status: 0, image: '', ms: Date.now() - started};
  }
}

/**
 * GET /api/player/diagnostics?profile=vod (owner and a signed-in player): whether the Xtream server is set and
 * approved, how big each list is, how long it took, where posters live and which containers titles use. Counts,
 * sizes, times and origins only: never titles, logins or full addresses.
 */
export async function vodDiagnostics(req: Request) {
  try {
    const {credentials} = await session(req);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(45000)]);
    const raw = (settings().TV_APP_XTREAM_SERVER || '').trim();
    const parsed = xtreamServer(raw);
    const config = configuredXtream();
    const report: Record<string, unknown> = {profile: 'vod', xtream: {configured: Boolean(raw), approved: !('reason' in config), ...('reason' in config ? {reason: config.reason} : {}), ...('server' in parsed ? {origin: parsed.server} : {})}};
    const m3u = {live: 0, movie: 0, series: 0};
    try {for (const entry of await playlist(credentials, signal)) m3u[entryKind(entry.url)]++;}
    catch (error) {report.m3uError = error instanceof ServiceError ? error.code : 'playlist_unavailable';}
    report.m3u = m3u;
    if ('reason' in config) return report;
    // provider: through /api/player/image; tmdb: loaded directly; catalogue_host: through /api/player/image, on the host
    // the catalogue build would choose as the line's catalogue image host (CATALOGUE_HOST); relay_host and other_host:
    // title cards (a relay host can't serve images, and other hosts would see the viewer's address).
    const posters = {none: 0, provider: 0, tmdb: 0, catalogue_host: 0, relay_host: 0, other_host: 0};
    const secrets = [credentials.username, credentials.password];
    const refused = refusedImageHost(new URL(req.url).origin);
    const hosts = createPosterCounter(refused, secrets, {diagnostics: true});
    const origins = new Map<string, number>(), containers = new Map<string, number>();
    const actions = [];
    for (const action of ['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'] as const) {
      const started = Date.now();
      const entry: Record<string, unknown> = {action};
      try {
        const response = await xtreamFetch(config.server, credentials, action, signal);
        entry.status = response.status;
        const result = await readJsonArray(response.body, item => {
          if (action === 'get_vod_categories' || action === 'get_series_categories' || !item || typeof item !== 'object') return;
          const row = item as Record<string, unknown>;
          const poster = String((action === 'get_vod_streams' ? row.stream_icon : row.cover) ?? '').trim();
          const kind = classifyPoster(poster, isDirectProviderAddress, secrets);
          hosts.add(poster, kind.kind !== 'none');
          let origin = '', parsedPoster: URL | null = null;
          try {parsedPoster = new URL(poster); origin = parsedPoster.origin;} catch {}
          if (kind.kind === 'proxy') posters.provider++;
          else if (kind.kind === 'direct') posters.tmdb++;
          else if (!parsedPoster || !/^https?:$/.test(parsedPoster.protocol)) posters.none++;
          else if (isProviderAddress(parsedPoster)) posters.relay_host++;
          else posters.other_host++;
          if (origin && origin !== 'null') {
            if (origins.size < 500 || origins.has(origin)) origins.set(origin, (origins.get(origin) || 0) + 1);
          }
          if (action === 'get_vod_streams') {
            const ext = String(row.container_extension ?? '').toLowerCase();
            const key = /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'other';
            if (containers.size < 30 || containers.has(key)) containers.set(key, (containers.get(key) || 0) + 1);
          }
        }, {maxBytes: VOD_LIMITS.listBytes, maxItems: 200000, signal});
        Object.assign(entry, {bytes: result.bytes, items: result.items, skipped: result.skipped});
      } catch (error) {entry.error = error instanceof VodError ? error.code : 'vod_unavailable';}
      entry.ms = Date.now() - started;
      actions.push(entry);
    }
    report.actions = actions;
    // The catalogue image host's posters were counted as other_host above (no host is known until every list is read).
    const imageHost = hosts.elect();
    posters.catalogue_host = hosts.count(imageHost);
    posters.other_host -= posters.catalogue_host;
    const recorded = await store(new URL(req.url).origin, await catalogueKey(config.server, credentials, playerSecret())).imageHost().catch(() => null);
    report.posters = {
      ...posters, catalogue_host_origin: imageHost, catalogue_host_dirs: hosts.directories(imageHost), catalogue_host_recorded: recorded,
      ...(imageHost ? {catalogue_host_probe: await probeImageHost(hosts.sample(imageHost), imageHost, refused, secrets, signal)} : {}),
      topOrigins: [...origins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
    report.containers = Object.fromEntries([...containers.entries()].sort((a, b) => b[1] - a[1]));
    return report;
  } catch (error) {throw toService(error);}
}
