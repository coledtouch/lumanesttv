// Popularity rows for Movies & Series browsing in every Tuner app (docs/browse.md), served by
// GET /api/catalog/rows?v=1. The apps never call TMDB: this Worker builds the lists from TMDB, caches them
// per Cloudflare location for 12 hours and keeps a stale copy for when TMDB fails.
//
// TMDB's free API key is licensed for non-commercial use only, and LumaNest TV is a business. TMDB_API_KEY
// stays unset until the owner has TMDB's commercial terms; without it every answer is
// {"v":1,"source":"none","movie":{},"tv":{},"genres":{}} and the apps use their category fallbacks.
// See docs/deployment.md.

export const CATALOG_VERSION = 1;
const TMDB_API = 'https://api.themoviedb.org/3';

/** A complete refresh is served this long before the next one. */
export const FRESH_MS = 12 * 60 * 60 * 1000;
/**
 * A refresh in which some requests failed, or that left movie origins to look up, is repeated sooner; failed
 * lists keep their previous copy meanwhile.
 */
export const PARTIAL_FRESH_MS = 60 * 60 * 1000;
/** How long a stale copy is kept for when TMDB fails. */
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** After a failed refresh, TMDB is left alone this long (per location and per isolate). */
export const RETRY_MS = 5 * 60 * 1000;
/** While one isolate refreshes, the others in the same location serve the stale copy instead of calling TMDB. */
export const REFRESH_HOLD_MS = 60 * 1000;
export const REQUEST_TIMEOUT_MS = 8000;
/**
 * The hold write and every TMDB request of a refresh end by then, counted from the start of the refresh. With
 * the final cache write (STORE_TIMEOUT_MS) it stays inside the 30 seconds waitUntil allows after the response.
 */
export const REFRESH_DEADLINE_MS = 25000;
/** A Cache API call that takes longer is given up; it never holds a refresh up. */
export const STORE_TIMEOUT_MS = 2000;
/**
 * A request with no copy at all waits this long for a refresh (its own or another isolate's) before it answers
 * 503, well inside the apps' own request timeouts (Roku waits 20 seconds). The refresh itself carries on.
 */
export const FIRST_WAIT_MS = 15000;
/**
 * A refresh still unsettled after this long is taken as lost (the request that ran it was cancelled, so its
 * timers never fire) and the next request starts another one.
 */
export const INFLIGHT_MAX_MS = 40000;
export const PAGES = 5;
export const LIST_MAX = 100;
/**
 * TMDB's movie list results carry no countries, so each refresh looks up at most this many movies' details
 * (origin_country) whose countries are not known yet, in list order. Origins found earlier are kept from the
 * previous copy, so after the first refreshes only new titles are looked up.
 */
export const ORIGIN_LOOKUPS = 300;
// Workers allow six connections waiting for headers per request; stay below that and well inside TMDB's rate limit.
const CONCURRENCY = 5;

export const SERVICES = ['netflix', 'disney', 'max', 'prime', 'apple', 'hulu', 'paramount', 'peacock'] as const;
export type Service = (typeof SERVICES)[number];
/**
 * TMDB watch-provider ids for the US subscription services, from TMDB's US provider list
 * (watch/providers/movie and watch/providers/tv with watch_region=US; checked October 2026). Discover joins
 * several ids with "|" (OR). Store, rental and add-on channel ids (Apple TV Store 2, Amazon Video 10,
 * "… Amazon Channel", "… Apple TV channel", "… Roku Premium Channel") are deliberately left out.
 */
export const US_PROVIDERS: Readonly<Record<Service, readonly number[]>> = {
  netflix: [8, 1796], // Netflix, Netflix Standard with Ads
  disney: [337], // Disney Plus
  max: [1899], // HBO Max (listed as "Max" in 2023-25; 384 is the retired HBO Max id)
  prime: [9, 2100], // Amazon Prime Video, Amazon Prime Video with Ads
  apple: [350], // Apple TV, formerly Apple TV+ (2 is the Apple TV Store, rent or buy)
  hulu: [15], // Hulu
  paramount: [2303, 2616], // Paramount Plus Premium, Paramount Plus Essential (531 is no longer listed for the US)
  peacock: [386, 387], // Peacock Premium, Peacock Premium Plus
};

export type Media = 'movie' | 'tv';
export type Item = {id: number; title: string; original_title: string; year: string; origin: string[]; lang: string; genres: number[]; popularity: number};
export type Genre = {id: number; name: string};
export type MediaLists = {popular: Item[]; featured: Item[]; top_rated: Item[]; services: Record<Service, Item[]>};
export type CatalogRows = {v: 1; source: 'tmdb'; generated: string; movie: MediaLists; tv: MediaLists; genres: {movie: Genre[]; tv: Genre[]}};
export const NO_ROWS_BODY = JSON.stringify({v: CATALOG_VERSION, source: 'none', movie: {}, tv: {}, genres: {}});

export type TmdbAuth = {kind: 'v3' | 'v4'; value: string};
/** A v3 API key is 32 hex characters (sent as api_key); a v4 API Read Access Token is a JWT (sent as a Bearer token). */
export function tmdbAuth(key: string | undefined): TmdbAuth | null {
  const value = (key || '').trim();
  if (/^[a-f0-9]{32}$/i.test(value)) return {kind: 'v3', value};
  if (/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(value)) return {kind: 'v4', value};
  return null;
}

type ListName = 'popular' | 'featured' | 'top_rated' | Service;
export type PlannedList = {media: Media; list: ListName; path: string; query: Record<string, string>};
/** Every list the endpoint builds, each fetched as PAGES pages of 20. */
export function tmdbPlan(): PlannedList[] {
  const plan: PlannedList[] = [];
  for (const media of ['movie', 'tv'] as const) {
    // TMDB's movie lists take a region; its TV lists and trending do not.
    const base: Record<string, string> = media === 'movie' ? {language: 'en-US', region: 'US'} : {language: 'en-US'};
    plan.push(media === 'movie'
      ? {media, list: 'popular', path: '/movie/popular', query: base}
      // TMDB's own TV popular list is worldwide and led by daily soaps from elsewhere. The most popular series
      // that stream in the US (subscription, free or with ads) make the US Popular – Series row.
      : {media, list: 'popular', path: '/discover/tv', query: {
        ...base, watch_region: 'US', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', include_adult: 'false',
      }});
    plan.push({media, list: 'featured', path: `/trending/${media}/week`, query: {language: 'en-US'}});
    plan.push({media, list: 'top_rated', path: `/${media}/top_rated`, query: base});
    for (const service of SERVICES) {
      plan.push({media, list: service, path: `/discover/${media}`, query: {
        ...base, watch_region: 'US', with_watch_providers: US_PROVIDERS[service].join('|'), sort_by: 'popularity.desc', include_adult: 'false',
      }});
    }
  }
  return plan;
}

export function tmdbRequest(auth: TmdbAuth, path: string, query: Record<string, string>): [string, RequestInit] {
  const url = new URL(TMDB_API + path);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  if (auth.kind === 'v3') url.searchParams.set('api_key', auth.value);
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (auth.kind === 'v4') headers.Authorization = 'Bearer ' + auth.value;
  return [url.href, {headers}];
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function countries(...values: unknown[]) {
  const out = new Set<string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      // origin_country is ["US"]; production_countries (when a list carries it) is [{iso_3166_1: "US", name: …}].
      const code = text(typeof entry === 'string' ? entry : (entry as {iso_3166_1?: unknown} | null)?.iso_3166_1).toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) out.add(code);
    }
  }
  return [...out];
}

/**
 * Maps one TMDB list result. Movie list results carry no countries, so a movie's origin starts as [] and is
 * filled in from the movie's details (fillMovieOrigins).
 */
export function toItem(media: Media, raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.adult === true || typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0) return null;
  const title = text(media === 'movie' ? r.title : r.name);
  if (!title) return null;
  const date = text(media === 'movie' ? r.release_date : r.first_air_date);
  const popularity = typeof r.popularity === 'number' && Number.isFinite(r.popularity) ? Math.round(r.popularity * 10) / 10 : 0;
  return {
    id: r.id,
    title,
    original_title: text(media === 'movie' ? r.original_title : r.original_name) || title,
    year: /^\d{4}/.test(date) ? date.slice(0, 4) : '',
    origin: countries(r.origin_country, r.production_countries),
    lang: text(r.original_language).toLowerCase(),
    genres: Array.isArray(r.genre_ids) ? r.genre_ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) : [],
    popularity,
  };
}

/** A movie's countries of origin from its details (/movie/{id}): origin_country, else production_countries. */
export function movieOrigin(raw: unknown): string[] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const origin = countries(r.origin_country);
  return origin.length ? origin : countries(r.production_countries);
}

/** Pages in order, invalid and adult results dropped, first occurrence of each id kept, at most LIST_MAX. */
export function mergePages(media: Media, pages: unknown[][]): Item[] {
  const seen = new Set<number>(), out: Item[] = [];
  for (const page of pages) for (const raw of page) {
    const item = toItem(media, raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= LIST_MAX) return out;
  }
  return out;
}

function toGenres(raw: unknown): Genre[] {
  const list = (raw as {genres?: unknown} | null)?.genres;
  if (!Array.isArray(list)) throw new Error('unexpected_genres');
  const out: Genre[] = [];
  for (const entry of list) {
    const g = entry as {id?: unknown; name?: unknown} | null;
    if (typeof g?.id === 'number' && Number.isSafeInteger(g.id) && g.id > 0 && text(g.name)) out.push({id: g.id, name: text(g.name)});
  }
  return out;
}

/** TMDB refused the key (401 or 403). */
export class TmdbUnauthorized extends Error {}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {clearTimeout(timer); resolve();}, {once: true});
});

type Timing = {timeoutMs?: number; deadlineMs?: number; retryDelayMs?: number};
async function getJSON(send: typeof fetch, [url, init]: [string, RequestInit], signal: AbortSignal, timing: Timing): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new Error('tmdb_deadline');
    let response: Response;
    try {
      response = await send(url, {...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timing.timeoutMs ?? REQUEST_TIMEOUT_MS)])});
    } catch (error) {
      // A timeout or network failure gets one retry.
      if (attempt > 0 || signal.aborted) throw error;
      await sleep(timing.retryDelayMs ?? 1000, signal);
      continue;
    }
    if (response.status === 401 || response.status === 403) {await response.body?.cancel(); throw new TmdbUnauthorized('tmdb_unauthorized');}
    if (response.ok) return await response.json();
    await response.body?.cancel();
    // So do rate limits and server errors.
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {await sleep(timing.retryDelayMs ?? 1000, signal); continue;}
    throw new Error('tmdb_status_' + response.status);
  }
}

async function pool<T>(jobs: (() => Promise<T>)[], limit: number) {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      try {results[index] = {status: 'fulfilled', value: await jobs[index]()};}
      catch (reason) {results[index] = {status: 'rejected', reason};}
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, jobs.length)}, worker));
  return results;
}

const isCountry = (code: unknown): code is string => typeof code === 'string' && /^[A-Z]{2}$/.test(code);

/** Every movie item of the lists, by id (one TMDB title can sit in several lists, as separate items). */
function movieItems(lists: Partial<MediaLists> | undefined | null): Map<number, Item[]> {
  const byId = new Map<number, Item[]>();
  if (!lists || typeof lists !== 'object') return byId;
  const services = lists.services && typeof lists.services === 'object' ? lists.services : null;
  for (const list of [lists.popular, lists.featured, lists.top_rated, ...SERVICES.map(service => services?.[service])]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as Item[]) {
      if (!item || typeof item.id !== 'number') continue;
      const same = byId.get(item.id);
      if (same) same.push(item); else byId.set(item.id, [item]);
    }
  }
  return byId;
}

/**
 * Gives every movie item its countries of origin: from another item of the same title, from the previous copy,
 * or else from the movie's details, at most `limit` lookups in list order (Popular first). Returns how many
 * titles are still to look up (over the limit, or cut off by the deadline); a lookup that fails or finds no
 * country leaves origin [] ("unknown") until the next refresh.
 */
async function fillMovieOrigins(lists: MediaLists, previous: Partial<MediaLists> | undefined, lookup: (id: number) => Promise<unknown>, signal: AbortSignal, limit: number) {
  const byId = movieItems(lists);
  const known = new Map<number, string[]>();
  for (const [id, items] of byId) {
    const found = items.find(item => Array.isArray(item.origin) && item.origin.length);
    if (found) known.set(id, found.origin);
  }
  for (const [id, items] of movieItems(previous)) {
    if (known.has(id) || !byId.has(id)) continue;
    const origin = items.map(item => Array.isArray(item.origin) ? item.origin.filter(isCountry) : []).find(codes => codes.length);
    if (origin) known.set(id, origin);
  }
  const unknown: number[] = [];
  for (const [id, items] of byId) {
    const origin = known.get(id);
    if (origin) for (const item of items) item.origin = [...origin];
    else unknown.push(id);
  }
  const ids = unknown.slice(0, Math.max(0, limit));
  let pending = unknown.length - ids.length;
  const results = await pool(ids.map(id => () => lookup(id)), CONCURRENCY);
  results.forEach((result, index) => {
    if (result.status === 'rejected' && signal.aborted) {pending++; return;}
    const origin = result.status === 'fulfilled' ? movieOrigin(result.value) : [];
    for (const item of byId.get(ids[index]) || []) item.origin = [...origin];
  });
  return pending;
}

export type BuildOptions = Timing & {fetch?: typeof fetch; now?: () => number; stale?: string | null; originLookups?: number};
export type BuildResult = {rows: CatalogRows; complete: boolean};
/**
 * Fetches every list (PAGES pages each) and both genre lists (112 TMDB requests), then the details of movies
 * whose countries of origin are not known yet (up to ORIGIN_LOOKUPS). A list with a failed page is replaced by
 * its copy from the stale response when there is one, and the result is marked incomplete, as it is when movie
 * origins are left to look up. Returns null when nothing usable came back: no list's first page at all, or a
 * list whose first page failed with no previous copy to keep. Throws TmdbUnauthorized when the key is refused.
 */
export async function buildRows(auth: TmdbAuth, options: BuildOptions = {}): Promise<BuildResult | null> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), options.deadlineMs ?? REFRESH_DEADLINE_MS);
  try {return await build(auth, options, controller);}
  finally {clearTimeout(deadline);}
}

async function build(auth: TmdbAuth, options: BuildOptions, controller: AbortController): Promise<BuildResult | null> {
  const send = options.fetch || fetch, now = options.now || Date.now;
  const plan = tmdbPlan();
  let refused = false;
  const get = (path: string, query: Record<string, string>) => getJSON(send, tmdbRequest(auth, path, query), controller.signal, options)
    .catch(error => {if (error instanceof TmdbUnauthorized) {refused = true; controller.abort();} throw error;});
  // Genres first, then page 1 of every list, then page 2 and so on, so a deadline costs only the deepest pages.
  const jobs = [() => get('/genre/movie/list', {language: 'en-US'}), () => get('/genre/tv/list', {language: 'en-US'})];
  for (let page = 1; page <= PAGES; page++) for (const entry of plan) jobs.push(() => get(entry.path, {...entry.query, page: String(page)}));
  const results = await pool(jobs, CONCURRENCY);
  if (refused) throw new TmdbUnauthorized('tmdb_unauthorized');

  let stale: Partial<CatalogRows> | null = null;
  try {stale = options.stale ? JSON.parse(options.stale) : null;} catch {stale = null;}
  let complete = true, usable = true, firstPages = 0;
  const list = (media: Media, name: ListName) => {
    const position = plan.findIndex(entry => entry.media === media && entry.list === name);
    const pages: unknown[][] = [];
    let ok = true, first = false;
    for (let page = 0; page < PAGES; page++) {
      const r = results[2 + page * plan.length + position];
      const items = r.status === 'fulfilled' ? (r.value as {results?: unknown} | null)?.results : undefined;
      if (Array.isArray(items)) {pages.push(items); if (page === 0) first = true;} else ok = false;
    }
    if (first) firstPages++;
    const items = mergePages(media, pages);
    if (ok) return items;
    // A failed list keeps its previous copy when there is one; either way the next refresh comes sooner.
    complete = false;
    const previous = stale?.[media];
    const copy: unknown = name === 'popular' || name === 'featured' || name === 'top_rated' ? previous?.[name] : previous?.services?.[name];
    if (Array.isArray(copy) && copy.length) return copy as Item[];
    // Without page 1 or a previous copy the list would only show what TMDB's failure left: don't use this refresh.
    if (!first) usable = false;
    return items;
  };
  const genres = (index: number, media: Media) => {
    const r = results[index];
    if (r.status === 'fulfilled') try {return toGenres(r.value);} catch {}
    complete = false;
    const previous = stale?.genres?.[media];
    return Array.isArray(previous) && previous.length ? previous : [];
  };
  const lists = (media: Media): MediaLists => ({
    popular: list(media, 'popular'), featured: list(media, 'featured'), top_rated: list(media, 'top_rated'),
    services: Object.fromEntries(SERVICES.map(service => [service, list(media, service)])) as Record<Service, Item[]>,
  });
  const rows: CatalogRows = {
    v: CATALOG_VERSION, source: 'tmdb', generated: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    movie: lists('movie'), tv: lists('tv'), genres: {movie: genres(0, 'movie'), tv: genres(1, 'tv')},
  };
  // The genre lists alone, or TMDB answering only some lists, must not replace good data on the TVs.
  if (!usable || firstPages === 0) return null;

  // A refusal here only stops the lookups (they count as still to do); the next refresh's lists will tell.
  const pending = await fillMovieOrigins(rows.movie, stale?.movie, id => get('/movie/' + id, {language: 'en-US'}), controller.signal, options.originLookups ?? ORIGIN_LOOKUPS);
  if (pending) complete = false;
  return {rows, complete};
}

// ---------------------------------------------------------------- caching

export type Snapshot = {body: string; freshUntil: number};
export type Hold = 'refreshing' | 'retry';
export type StoreState = {snapshot: Snapshot | null; hold: Hold | null};
/** Shared by every isolate in one Cloudflare location (the Workers Cache API). */
export interface RowsStore {
  read(): Promise<StoreState>;
  write(snapshot: Snapshot): Promise<void>;
  hold(kind: Hold, ms: number): Promise<void>;
  release(): Promise<void>;
}
export type CacheLike = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
};

/** Stores the assembled response in the Workers Cache API under private keys on this site's own origin. */
export function cacheStore(cache: CacheLike, origin: string): RowsStore {
  const dataKey = origin + '/__lumanest-cache/catalog-rows-v' + CATALOG_VERSION;
  const holdKey = dataKey + '-hold';
  return {
    async read() {
      const [data, hold] = await Promise.all([cache.match(dataKey), cache.match(holdKey)]);
      const kind = hold ? await hold.text() : '';
      const freshUntil = Number(data?.headers.get('X-Catalog-Fresh-Until'));
      return {
        snapshot: data ? {body: await data.text(), freshUntil: Number.isFinite(freshUntil) ? freshUntil : 0} : null,
        hold: kind === 'refreshing' || kind === 'retry' ? kind : null,
      };
    },
    async write(snapshot) {
      // Kept for STALE_MS so it can stand in when TMDB fails; X-Catalog-Fresh-Until decides when to refresh.
      await cache.put(dataKey, new Response(snapshot.body, {headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + STALE_MS / 1000, 'X-Catalog-Fresh-Until': String(snapshot.freshUntil),
      }}));
    },
    async hold(kind, ms) {
      await cache.put(holdKey, new Response(kind, {headers: {'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=' + Math.ceil(ms / 1000)}}));
    },
    async release() {await cache.delete(holdKey);},
  };
}

export type CatalogOptions = Timing & {
  key: string | undefined;
  store?: RowsStore | null;
  fetch?: typeof fetch;
  now?: () => number;
  waitUntil?: (promise: Promise<unknown>) => void;
  pollMs?: number;
  /** How long a request with no copy waits for a refresh (FIRST_WAIT_MS). */
  waitMs?: number;
  /** Movie detail lookups per refresh (ORIGIN_LOOKUPS). */
  originLookups?: number;
};
/**
 * body is the JSON to send. failed marks a "none" answer caused by a TMDB failure with no copy to serve (sent as
 * HTTP 503, so the apps keep their own copy), as opposed to the deliberate answer without a key (HTTP 200).
 */
export type CatalogAnswer = {body: string; source: 'tmdb' | 'none'; failed: boolean};

/** The promise's value, or null once ms have passed (the promise carries on). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<null>(resolve => {timer = setTimeout(() => resolve(null), ms);})]);}
  finally {clearTimeout(timer);}
}
/** Waits for a Cache API call for at most STORE_TIMEOUT_MS; its failure or slowness never fails a refresh. */
const bounded = (work: () => Promise<unknown>) => within(work().catch(() => null), STORE_TIMEOUT_MS);

/**
 * One per isolate. Serves the newest copy it can find (this isolate's memory, then the location's cache),
 * starts at most one refresh per isolate when that copy is stale, serves the stale copy while the refresh runs
 * or after it fails, and answers "none" only when there is no copy at all.
 */
export function createCatalog() {
  let memo: Snapshot | null = null;
  let inflight: Promise<Snapshot | null> | null = null;
  let inflightSince = 0;
  let blockedUntil = 0;
  let warnedKey = false;
  const served = (snapshot: Snapshot): CatalogAnswer => ({body: snapshot.body, source: 'tmdb', failed: false});
  const none = (failed: boolean): CatalogAnswer => ({body: NO_ROWS_BODY, source: 'none', failed});
  const newer = (a: Snapshot | null, b: Snapshot | null) => !a ? b : !b ? a : b.freshUntil > a.freshUntil ? b : a;

  async function refresh(auth: TmdbAuth, stale: Snapshot | null, options: CatalogOptions): Promise<Snapshot | null> {
    const now = options.now || Date.now, store = options.store;
    // The deadline counts from here, so a slow hold write cannot push the refresh past waitUntil's 30 seconds.
    const started = Date.now();
    if (store) await bounded(() => store.hold('refreshing', REFRESH_HOLD_MS));
    let built: BuildResult | null = null, code = 'lumanest_catalog_refresh_failed';
    try {
      const deadlineMs = Math.max(0, (options.deadlineMs ?? REFRESH_DEADLINE_MS) - (Date.now() - started));
      built = await buildRows(auth, {...options, deadlineMs, stale: stale?.body});
    } catch (error) {
      if (error instanceof TmdbUnauthorized) code = 'lumanest_catalog_tmdb_unauthorized';
    }
    if (!built) {
      // Fixed codes only: never the key or TMDB's URLs.
      console.error(code);
      blockedUntil = now() + RETRY_MS;
      if (store) await bounded(() => store.hold('retry', RETRY_MS));
      return null;
    }
    const snapshot = {body: JSON.stringify(built.rows), freshUntil: now() + (built.complete ? FRESH_MS : PARTIAL_FRESH_MS)};
    memo = newer(memo, snapshot);
    blockedUntil = 0;
    if (store) await bounded(async () => {await store.write(snapshot); await store.release();});
    return snapshot;
  }

  async function waitForOtherIsolate(store: RowsStore, options: CatalogOptions) {
    const poll = options.pollMs ?? 500, polls = Math.max(1, Math.ceil((options.waitMs ?? FIRST_WAIT_MS) / poll));
    for (let i = 0; i < polls; i++) {
      await new Promise(resolve => setTimeout(resolve, poll));
      const state = await within(store.read().catch(() => null), STORE_TIMEOUT_MS);
      if (!state) return null;
      if (state.snapshot) return state.snapshot;
      if (state.hold !== 'refreshing') return null;
    }
    return null;
  }

  return {
    async rows(options: CatalogOptions): Promise<CatalogAnswer> {
      // No key: never call TMDB and never serve TMDB data cached under an earlier key.
      const auth = tmdbAuth(options.key);
      if (!auth) {
        // A key that is set but not a v3 key or v4 token (pasted with "Bearer " or quotes, say) is logged once.
        if ((options.key || '').trim() && !warnedKey) {warnedKey = true; console.error('lumanest_catalog_key_unrecognized');}
        return none(false);
      }
      const now = options.now || Date.now, store = options.store || null;
      if (memo && memo.freshUntil > now()) return served(memo);
      let shared: StoreState = {snapshot: null, hold: null};
      if (store) shared = await within(store.read().catch(() => null), STORE_TIMEOUT_MS) || shared;
      const snapshot = newer(memo, shared.snapshot);
      if (snapshot && snapshot.freshUntil > now()) {memo = snapshot; return served(snapshot);}
      // A refresh that never settled was lost with the request that ran it; it must not block this isolate.
      if (inflight && now() - inflightSince > INFLIGHT_MAX_MS) inflight = null;
      let running = inflight;
      if (!running) {
        if (store && shared.hold === 'refreshing' && !snapshot) {
          // Another isolate here is building the first copy; wait for it rather than answer "none".
          const ready = await waitForOtherIsolate(store, options);
          if (ready) {memo = newer(memo, ready); return served(ready);}
          return none(true);
        }
        if (shared.hold || blockedUntil > now()) return snapshot ? served(snapshot) : none(true);
        const job: Promise<Snapshot | null> = refresh(auth, snapshot, options).finally(() => {if (inflight === job) inflight = null;});
        inflight = running = job;
        inflightSince = now();
        // The refresh finishes and is cached even if this client hangs up.
        try {options.waitUntil?.(job);} catch {}
      }
      // Stale while the refresh runs (or after it failed).
      if (snapshot) return served(snapshot);
      const fresh = await within(running, options.waitMs ?? FIRST_WAIT_MS);
      return fresh ? served(fresh) : none(true);
    },
  };
}
