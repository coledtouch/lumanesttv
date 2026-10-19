import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_VERSION, FRESH_MS, INFLIGHT_MAX_MS, LIST_MAX, NO_ROWS_BODY, ORIGIN_LOOKUPS, PARTIAL_FRESH_MS, RETRY_MS, SERVICES, US_PROVIDERS,
  cacheStore, createCatalog, movieOrigin, tmdbAuth, tmdbPlan, tmdbRequest, toItem, type CacheLike, type CatalogOptions,
} from '../lib/catalog.ts';

const V3 = '0123456789abcdef0123456789ABCDEF';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJsdW1hbmVzdCJ9.c2lnbmF0dXJlLXZhbHVl';
const quiet = (t: TestContext) => t.mock.method(console, 'error', () => {});

/** The Workers Cache API as one location sees it: entries expire after their Cache-Control max-age. */
class FakeCache implements CacheLike {
  entries = new Map<string, {body: Promise<string>; headers: [string, string][]; expires: number}>();
  clock: () => number;
  constructor(clock: () => number) {this.clock = clock;}
  async match(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.clock()) return undefined;
    return new Response(await entry.body, {headers: entry.headers});
  }
  async put(key: string, response: Response) {
    const age = /(?:^|,\s*)max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '');
    assert.ok(age && /public/.test(response.headers.get('Cache-Control') || ''), 'cacheable by the Workers Cache API');
    // Visible to every isolate as soon as put is called, as in one Cloudflare location.
    this.entries.set(key, {body: response.text(), headers: [...response.headers], expires: this.clock() + Number(age[1]) * 1000});
  }
  async delete(key: string) {return this.entries.delete(key);}
}

const DETAILS = /^\/3\/movie\/(\d+)$/;
/** The countries the double's movie details give: mostly origin_country, sometimes only production_countries, sometimes 404. */
function detailOrigin(id: number): string[] | null {
  if (id % 10 === 7) return null;
  if (id % 10 === 9) return ['CA'];
  return [id % 2 ? 'GB' : 'US'];
}

/**
 * A TMDB double: 22 results per page (so five pages exceed 100), a duplicate, an adult title and junk. List and
 * genre requests are recorded in calls, movie detail lookups (/movie/{id}) in details.
 */
function tmdb(options: {generation?: () => number; fail?: (url: URL) => number | 'network' | 'hang' | undefined} = {}) {
  const calls: {url: URL; headers: Headers}[] = [], details: {url: URL; headers: Headers}[] = [];
  const send = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    (DETAILS.test(url.pathname) ? details : calls).push({url, headers});
    const failure = options.fail?.(url);
    if (failure === 'network') throw new TypeError('network down');
    if (failure === 'hang') return await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {once: true}));
    if (failure) return new Response('{"status_message":"no"}', {status: failure});
    const detail = DETAILS.exec(url.pathname);
    if (detail) {
      const id = Number(detail[1]), origin = detailOrigin(id);
      if (!origin) return new Response('{"status_message":"not found"}', {status: 404});
      return Response.json(origin[0] === 'CA'
        ? {id, origin_country: [], production_countries: [{iso_3166_1: 'CA', name: 'Canada'}]}
        : {id, origin_country: origin, production_countries: [{iso_3166_1: 'US'}, {iso_3166_1: 'GB'}]});
    }
    if (url.pathname === '/3/genre/movie/list') return Response.json({genres: [{id: 28, name: 'Action'}, {id: 12, name: 'Adventure'}, {id: 0, name: 'bad'}]});
    if (url.pathname === '/3/genre/tv/list') return Response.json({genres: [{id: 10759, name: 'Action & Adventure'}]});
    const media = url.pathname.includes('/tv') ? 'tv' : 'movie', page = Number(url.searchParams.get('page'));
    const list = url.pathname + '?' + (url.searchParams.get('with_watch_providers') || '');
    const base = (hash(list) % 1000) * 100000 + page * 1000, generation = options.generation?.() ?? 1;
    const results: unknown[] = [];
    for (let i = 0; i < 22; i++) {
      // Page 2 repeats page 1's first title, as TMDB does when popularity shifts between page requests.
      const id = page === 2 && i === 0 ? base - 1000 : base + i;
      const named = media === 'movie'
        ? {title: `Movie ${id} g${generation}`, original_title: `Film ${id}`, release_date: '2025-06-01', ...(i === 3 ? {production_countries: [{iso_3166_1: 'gb'}]} : {})}
        : {name: `Series ${id} g${generation}`, original_name: `Serie ${id}`, first_air_date: '2024-01-05', origin_country: ['US', 'CA']};
      results.push({id, adult: false, original_language: 'EN', genre_ids: [28, 12], popularity: 123.456, ...named});
    }
    results.push({id: base + 50, adult: true, title: 'Adult', name: 'Adult'}, {id: 'nope'}, null);
    return Response.json({page, total_pages: 500, results});
  };
  return {calls, details, send: send as typeof fetch};
}
function hash(text: string) {let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h;}

function setup(start = Date.parse('2026-10-19T00:00:00Z')) {
  let time = start;
  const clock = () => time;
  const cache = new FakeCache(clock);
  const pending: Promise<unknown>[] = [];
  const options = (send: typeof fetch, extra: Partial<CatalogOptions> = {}): CatalogOptions => ({
    // Enough lookups for every movie in the double's lists, so a good refresh is complete.
    key: V3, store: cacheStore(cache, 'https://lumanest.tv'), fetch: send, now: clock, waitUntil: p => {pending.push(p);}, retryDelayMs: 0, pollMs: 5, originLookups: 5000, ...extra,
  });
  return {cache, clock, advance: (ms: number) => {time += ms;}, options, settle: async () => {while (pending.length) await pending.shift();}};
}

test('TMDB US watch-provider ids are the subscription services, OR-joined in discover', () => {
  // From TMDB's US provider list (watch/providers/{movie,tv}?watch_region=US), checked October 2026.
  assert.deepEqual(US_PROVIDERS, {netflix: [8, 1796], disney: [337], max: [1899], prime: [9, 2100], apple: [350], hulu: [15], paramount: [2303, 2616], peacock: [386, 387]});
  assert.deepEqual([...SERVICES], ['netflix', 'disney', 'max', 'prime', 'apple', 'hulu', 'paramount', 'peacock']);
  // Rental stores and add-on channels would fill the rows with titles the service does not include, and 531
  // (the old Paramount+ id) and 384 (the old HBO Max id) are no longer on TMDB's US list.
  for (const id of [2, 10, 3, 1825, 582, 633, 1853, 2243, 531, 384]) assert.ok(!Object.values(US_PROVIDERS).flat().includes(id), String(id));

  const plan = tmdbPlan();
  assert.equal(plan.length, 22);
  // Popular – Series: TMDB's TV popular list is worldwide, so it is the most popular series streaming in the US.
  const tvPopular = plan.find(e => e.media === 'tv' && e.list === 'popular');
  assert.equal(tvPopular?.path, '/discover/tv');
  assert.deepEqual(tvPopular?.query, {language: 'en-US', watch_region: 'US', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', include_adult: 'false'});
  for (const media of ['movie', 'tv'] as const) {
    for (const service of SERVICES) {
      const entry = plan.find(e => e.media === media && e.list === service);
      assert.ok(entry);
      assert.equal(entry.path, `/discover/${media}`);
      const [url] = tmdbRequest({kind: 'v4', value: V4}, entry.path, {...entry.query, page: '1'});
      const q = new URL(url).searchParams;
      assert.equal(q.get('with_watch_providers'), US_PROVIDERS[service].join('|'));
      assert.equal(q.get('watch_region'), 'US');
      assert.equal(q.get('sort_by'), 'popularity.desc');
      assert.equal(q.get('include_adult'), 'false');
      assert.equal(q.get('language'), 'en-US');
      assert.equal(q.get('region'), media === 'movie' ? 'US' : null);
    }
    assert.equal(plan.find(e => e.media === media && e.list === 'featured')?.path, `/trending/${media}/week`);
    if (media === 'movie') assert.equal(plan.find(e => e.media === media && e.list === 'popular')?.path, '/movie/popular');
    assert.equal(plan.find(e => e.media === media && e.list === 'top_rated')?.path, `/${media}/top_rated`);
  }
});

test('the key format decides between a v3 api_key and a v4 bearer token', () => {
  assert.deepEqual(tmdbAuth(' ' + V3 + '\n'), {kind: 'v3', value: V3});
  assert.deepEqual(tmdbAuth(V4), {kind: 'v4', value: V4});
  for (const key of [undefined, '', '   ', V3.slice(1), V3 + '0', 'g'.repeat(32), 'Bearer ' + V4, 'eyJ.only', 'not a key']) assert.equal(tmdbAuth(key), null, String(key));

  const [v3url, v3init] = tmdbRequest({kind: 'v3', value: V3}, '/movie/popular', {language: 'en-US'});
  assert.equal(new URL(v3url).searchParams.get('api_key'), V3);
  assert.equal(new Headers(v3init.headers).get('Authorization'), null);
  const [v4url, v4init] = tmdbRequest({kind: 'v4', value: V4}, '/movie/popular', {language: 'en-US'});
  assert.equal(new URL(v4url).searchParams.get('api_key'), null);
  assert.equal(new Headers(v4init.headers).get('Authorization'), 'Bearer ' + V4);
  assert.equal(new URL(v4url).origin + new URL(v4url).pathname, 'https://api.themoviedb.org/3/movie/popular');
});

test('without a key the answer is exactly "none" and TMDB and the cache are never touched', async () => {
  const {cache, options} = setup();
  const {calls, send} = tmdb();
  for (const key of [undefined, '', 'not-a-tmdb-key']) {
    const answer = await createCatalog().rows(options(send, {key}));
    assert.deepEqual(answer, {body: NO_ROWS_BODY, source: 'none', failed: false});
  }
  assert.equal(NO_ROWS_BODY, '{"v":1,"source":"none","movie":{},"tv":{},"genres":{}}');
  assert.equal(calls.length, 0);
  assert.equal(cache.entries.size, 0);
});

test('a key that held TMDB data is removed: TMDB data stops at once', async () => {
  const {options} = setup();
  const {send} = tmdb(), catalog = createCatalog();
  assert.equal((await catalog.rows(options(send))).source, 'tmdb');
  assert.equal((await catalog.rows(options(send, {key: undefined}))).body, NO_ROWS_BODY);
});

test('the response has the documented shape, US lists of up to 100 deduplicated titles', async () => {
  const {options, cache} = setup();
  const {calls, details, send} = tmdb();
  const answer = await createCatalog().rows(options(send, {key: V4}));
  assert.equal(answer.source, 'tmdb');
  assert.equal(answer.failed, false);
  const rows = JSON.parse(answer.body);
  assert.deepEqual(Object.keys(rows), ['v', 'source', 'generated', 'movie', 'tv', 'genres']);
  assert.equal(rows.v, CATALOG_VERSION);
  assert.equal(rows.source, 'tmdb');
  assert.equal(rows.generated, '2026-10-19T00:00:00Z');
  assert.deepEqual(rows.genres, {movie: [{id: 28, name: 'Action'}, {id: 12, name: 'Adventure'}], tv: [{id: 10759, name: 'Action & Adventure'}]});
  for (const media of ['movie', 'tv']) {
    assert.deepEqual(Object.keys(rows[media]), ['popular', 'featured', 'top_rated', 'services']);
    assert.deepEqual(Object.keys(rows[media].services), [...SERVICES]);
    const lists = [rows[media].popular, rows[media].featured, rows[media].top_rated, ...Object.values(rows[media].services)] as {id: number}[][];
    for (const list of lists) {
      assert.equal(list.length, LIST_MAX);
      assert.equal(new Set(list.map(item => item.id)).size, list.length);
    }
    const first = rows[media].popular[0];
    assert.deepEqual(Object.keys(first), ['id', 'title', 'original_title', 'year', 'origin', 'lang', 'genres', 'popularity']);
    assert.equal(first.lang, 'en');
    assert.deepEqual(first.genres, [28, 12]);
    assert.equal(first.popularity, 123.5);
    if (media === 'tv') {
      assert.match(first.title, /^Series \d+ g1$/);
      assert.equal(first.year, '2024');
      assert.deepEqual(first.origin, ['US', 'CA']);
    } else {
      assert.match(first.title, /^Movie \d+ g1$/);
      assert.equal(first.year, '2025');
      // Movie list results carry no countries: they come from each movie's details (origin_country, else
      // production_countries), or from the list result when it has them (no lookup then).
      for (const item of lists.flat() as {id: number; origin: string[]}[]) {
        const known = item.id % 1000 === 3 ? ['GB'] : detailOrigin(item.id) ?? [];
        assert.deepEqual(item.origin, known, String(item.id));
      }
      assert.deepEqual(rows.movie.popular[3].origin, ['GB']);
    }
    assert.ok(!lists.flat().some(item => (item as {title?: string}).title === 'Adult'));
  }
  // 22 lists of 5 pages plus the two genre lists, all on TMDB's API with the v4 token as a bearer, then one
  // lookup per movie whose list result had no countries.
  assert.equal(calls.length, 112);
  const movieIds = new Set((Object.values(rows.movie).flatMap(v => Array.isArray(v) ? v : Object.values(v as object).flat()) as {id: number}[]).map(item => item.id));
  const fromLists = [...movieIds].filter(id => id % 1000 === 3).length;
  assert.equal(details.length, movieIds.size - fromLists);
  assert.equal(new Set(details.map(d => d.url.pathname)).size, details.length, 'each movie is looked up once');
  for (const {url, headers} of [...calls, ...details]) {
    assert.equal(url.origin, 'https://api.themoviedb.org');
    assert.equal(url.searchParams.get('language'), 'en-US');
    assert.equal(url.searchParams.get('api_key'), null);
    assert.equal(headers.get('Authorization'), 'Bearer ' + V4);
  }
  assert.deepEqual([...new Set(calls.filter(c => c.url.pathname === '/3/movie/popular').map(c => c.url.searchParams.get('page')))], ['1', '2', '3', '4', '5']);
  assert.equal(cache.entries.size, 1);
});

test('toItem skips adult and malformed results and never invents a title', () => {
  assert.equal(toItem('movie', {id: 1, title: 'X', adult: true}), null);
  assert.equal(toItem('movie', {id: 1.5, title: 'X'}), null);
  assert.equal(toItem('tv', {id: 2, title: 'Movie field on a series'}), null);
  assert.deepEqual(toItem('tv', {id: 3, name: ' Show ', origin_country: ['us', 'USA', 7]}), {id: 3, title: 'Show', original_title: 'Show', year: '', origin: ['US'], lang: '', genres: [], popularity: 0});
});

test('TMDB is called once per 12 hours per location; other isolates share the cached copy', async () => {
  const {options, advance, settle} = setup();
  let generation = 1;
  const {calls, send} = tmdb({generation: () => generation});
  const isolateA = createCatalog(), isolateB = createCatalog(), isolateC = createCatalog();

  // Simultaneous first requests in one isolate share one refresh.
  const [first, second] = await Promise.all([isolateA.rows(options(send)), isolateA.rows(options(send))]);
  assert.equal(first.body, second.body);
  assert.equal(calls.length, 112);
  assert.equal((await isolateA.rows(options(send))).body, first.body);
  assert.equal((await isolateB.rows(options(send))).body, first.body);
  advance(FRESH_MS - 1000);
  assert.equal((await isolateC.rows(options(send))).body, first.body);
  assert.equal(calls.length, 112);

  // After 12 hours the stale copy is answered at once while one refresh runs in the background.
  advance(2000);
  generation = 2;
  const stale = await isolateB.rows(options(send));
  assert.equal(stale.body, first.body);
  // Another isolate in the location sees the refresh under way and does not start its own.
  assert.equal((await isolateC.rows(options(send))).body, first.body);
  await settle();
  assert.equal(calls.length, 224);
  const refreshed = await isolateC.rows(options(send));
  assert.notEqual(refreshed.body, first.body);
  assert.match(JSON.parse(refreshed.body).movie.popular[0].title, / g2$/);
  assert.equal(JSON.parse(refreshed.body).generated, '2026-10-19T12:00:01Z');
  assert.equal((await isolateA.rows(options(send))).body, refreshed.body);
  assert.equal(calls.length, 224);
});

test('an isolate that finds another one building the first copy waits for it', async () => {
  const {options, settle} = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const {calls, send} = tmdb();
  const gated = (async (input: string | URL | Request, init?: RequestInit) => {await gate; return send(input, init);}) as typeof fetch;
  const building = createCatalog().rows(options(gated));
  await new Promise(resolve => setTimeout(resolve, 10));
  const waiting = createCatalog().rows(options(send));
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const [a, b] = await Promise.all([building, waiting]);
  await settle();
  assert.equal(a.source, 'tmdb');
  assert.equal(b.body, a.body);
  assert.equal(calls.length, 112);
});

test('when TMDB fails the stale copy is served and TMDB is left alone for five minutes', async t => {
  quiet(t);
  const {options, advance, settle} = setup();
  let down = false;
  const {calls, send} = tmdb({fail: () => down ? 503 : undefined});
  const good = await createCatalog().rows(options(send));
  advance(FRESH_MS + 60 * 60 * 1000);
  down = true;
  const isolate = createCatalog();
  const during = await isolate.rows(options(send));
  assert.deepEqual(during, good);
  await settle();
  const attempted = calls.length;
  // 112 requests, each retried once after a server error.
  assert.equal(attempted, 112 + 224);
  assert.deepEqual(await isolate.rows(options(send)), good);
  assert.deepEqual(await createCatalog().rows(options(send)), good);
  advance(RETRY_MS - 1000);
  assert.deepEqual(await createCatalog().rows(options(send)), good);
  assert.equal(calls.length, attempted);

  // Once the pause is over the next request tries again; a recovered TMDB replaces the stale copy.
  advance(2000);
  down = false;
  assert.deepEqual(await isolate.rows(options(send)), good);
  await settle();
  assert.equal(calls.length, attempted + 112);
  const recovered = await createCatalog().rows(options(send));
  assert.equal(recovered.source, 'tmdb');
  assert.notEqual(recovered.body, good.body);
});

test('with no copy at all a TMDB failure answers "none" and is not retried at once', async t => {
  quiet(t);
  const {options, settle, advance} = setup();
  const {calls, send} = tmdb({fail: () => 'network'});
  const isolate = createCatalog();
  assert.deepEqual(await isolate.rows(options(send)), {body: NO_ROWS_BODY, source: 'none', failed: true});
  await settle();
  const attempted = calls.length;
  assert.equal(attempted, 224);
  assert.equal((await isolate.rows(options(send))).body, NO_ROWS_BODY);
  assert.equal((await createCatalog().rows(options(send))).body, NO_ROWS_BODY);
  assert.equal(calls.length, attempted);
  advance(RETRY_MS + 1000);
  await createCatalog().rows(options(send));
  assert.equal(calls.length, attempted * 2);
});

test('a refused key stops the refresh after the first refusal', async t => {
  quiet(t);
  const {options} = setup();
  const {calls, send} = tmdb({fail: () => 401});
  assert.deepEqual(await createCatalog().rows(options(send)), {body: NO_ROWS_BODY, source: 'none', failed: true});
  assert.ok(calls.length <= 5, String(calls.length));
});

test('TMDB requests time out and the whole refresh has a deadline', async t => {
  quiet(t);
  const {options} = setup();
  const {calls, send} = tmdb({fail: () => 'hang'});
  const started = Date.now();
  const answer = await createCatalog().rows(options(send, {timeoutMs: 20, deadlineMs: 150}));
  assert.deepEqual(answer, {body: NO_ROWS_BODY, source: 'none', failed: true});
  assert.ok(Date.now() - started < 2000);
  assert.ok(calls.length < 112, String(calls.length));
});

test('a list that fails keeps its stale copy and the refresh is repeated after an hour', async t => {
  quiet(t);
  const {options, advance, settle} = setup();
  let generation = 1, broken = false;
  const {calls, send} = tmdb({
    generation: () => generation,
    fail: url => broken && url.pathname === '/3/discover/movie' && url.searchParams.get('with_watch_providers') === '8|1796' && url.searchParams.get('page') === '3' ? 500 : undefined,
  });
  const isolate = createCatalog();
  const before = JSON.parse((await isolate.rows(options(send))).body);
  advance(FRESH_MS + 1000);
  generation = 2; broken = true;
  await isolate.rows(options(send));
  await settle();
  const partial = JSON.parse((await isolate.rows(options(send))).body);
  assert.deepEqual(partial.movie.services.netflix, before.movie.services.netflix);
  assert.match(partial.movie.services.disney[0].title, / g2$/);
  assert.match(partial.tv.services.netflix[0].title, / g2$/);

  const counted = calls.length;
  advance(PARTIAL_FRESH_MS - 1000);
  await isolate.rows(options(send));
  assert.equal(calls.length, counted);
  advance(2000);
  broken = false; generation = 3;
  await isolate.rows(options(send));
  await settle();
  assert.match(JSON.parse((await isolate.rows(options(send))).body).movie.services.netflix[0].title, / g3$/);
});

test('without the Workers Cache API the isolate still caches and backs off on its own', async t => {
  quiet(t);
  const {options, advance, settle} = setup();
  let down = false;
  const {calls, send} = tmdb({fail: () => down ? 'network' : undefined});
  const isolate = createCatalog();
  const good = await isolate.rows(options(send, {store: null}));
  assert.equal((await isolate.rows(options(send, {store: null}))).body, good.body);
  assert.equal(calls.length, 112);
  advance(FRESH_MS + 1000);
  down = true;
  assert.equal((await isolate.rows(options(send, {store: null}))).body, good.body);
  await settle();
  const attempted = calls.length;
  assert.equal((await isolate.rows(options(send, {store: null}))).body, good.body);
  assert.equal(calls.length, attempted);
});

test('movie origins come from movie details, at most ORIGIN_LOOKUPS per refresh, and known origins are kept', async () => {
  const {options, advance, settle} = setup();
  const {calls, details, send} = tmdb();
  const isolate = createCatalog();
  const limited = (extra: Partial<CatalogOptions> = {}) => options(send, {originLookups: ORIGIN_LOOKUPS, ...extra});
  const looked = new Map<number, number>();
  const count = () => {for (const d of details.splice(0)) {const id = Number(DETAILS.exec(d.url.pathname)?.[1]); looked.set(id, (looked.get(id) || 0) + 1);}};

  const first = JSON.parse((await isolate.rows(limited())).body);
  assert.equal(details.length, ORIGIN_LOOKUPS, 'the first refresh looks up as many movies as allowed');
  // Popular first: its movies all have their countries after the first refresh.
  for (const item of first.movie.popular) assert.deepEqual(item.origin, item.id % 1000 === 3 ? ['GB'] : detailOrigin(item.id) ?? [], String(item.id));
  // Series list results carry origin_country themselves; nothing is looked up for them.
  assert.ok(details.every(d => d.url.pathname.startsWith('/3/movie/')));
  count();

  // Origins were left to look up, so the next refresh comes after an hour, not 12.
  advance(PARTIAL_FRESH_MS - 1000);
  await isolate.rows(limited());
  assert.equal(calls.length, 112);
  let refreshes = 1;
  for (; refreshes < 10; refreshes++) {
    advance(PARTIAL_FRESH_MS + 1000);
    await isolate.rows(limited());
    await settle();
    const before = new Map(looked);
    const batch = details.length;
    assert.ok(batch <= ORIGIN_LOOKUPS, String(batch));
    count();
    // A movie whose countries were found is never looked up again; only titles TMDB had nothing for are retried.
    for (const [id, times] of looked) if (times > (before.get(id) || 0) && before.has(id)) assert.equal(detailOrigin(id), null, String(id));
    if (calls.length === 112 * (refreshes + 1) && batch < ORIGIN_LOOKUPS) break;
  }
  const done = JSON.parse((await isolate.rows(limited())).body);
  for (const item of Object.values(done.movie.services).flat() as {id: number; origin: string[]}[]) {
    assert.deepEqual(item.origin, item.id % 1000 === 3 ? ['GB'] : detailOrigin(item.id) ?? [], String(item.id));
  }
  // With every origin looked up the copy is fresh for 12 hours again.
  const settled = calls.length;
  advance(PARTIAL_FRESH_MS + 1000);
  await isolate.rows(limited());
  await settle();
  assert.equal(calls.length, settled);
  assert.ok(refreshes >= 3 && refreshes < 10, String(refreshes));
});

test('movie detail lookups cut off by the deadline leave the lists in place', async t => {
  quiet(t);
  const {options} = setup();
  const {calls, details, send} = tmdb({fail: url => DETAILS.test(url.pathname) ? 'hang' : undefined});
  const answer = await createCatalog().rows(options(send, {deadlineMs: 300, timeoutMs: 5000}));
  assert.equal(answer.source, 'tmdb');
  const rows = JSON.parse(answer.body);
  assert.equal(rows.movie.popular.length, LIST_MAX);
  assert.deepEqual(rows.movie.popular[0].origin, []);
  assert.deepEqual(rows.tv.popular[0].origin, ['US', 'CA']);
  assert.equal(calls.length, 112);
  assert.ok(details.length > 0);
});

test('a movie origin comes from origin_country, else production_countries', () => {
  assert.deepEqual(movieOrigin({origin_country: ['us'], production_countries: [{iso_3166_1: 'GB'}]}), ['US']);
  assert.deepEqual(movieOrigin({origin_country: [], production_countries: [{iso_3166_1: 'FR'}, {iso_3166_1: 'BE'}]}), ['FR', 'BE']);
  assert.deepEqual(movieOrigin(null), []);
});

test('when only the genre lists answer, nothing from that refresh is served or cached', async t => {
  quiet(t);
  const {options, cache, advance, settle} = setup();
  let broken = true;
  const {calls, send} = tmdb({fail: url => broken && !url.pathname.startsWith('/3/genre/') ? 429 : undefined});
  // No copy anywhere: a failure, not a "tmdb" answer with every list empty.
  assert.deepEqual(await createCatalog().rows(options(send)), {body: NO_ROWS_BODY, source: 'none', failed: true});
  await settle();
  assert.equal(calls.length, 2 + 110 * 2);
  assert.ok(![...cache.entries.keys()].some(key => key.endsWith('catalog-rows-v1')), 'no copy is cached');

  // With a copy: it keeps being served, as it was, and TMDB is left alone for five minutes.
  advance(RETRY_MS + 1000);
  broken = false;
  const good = await createCatalog().rows(options(send));
  assert.equal(good.source, 'tmdb');
  advance(FRESH_MS + 1000);
  broken = true;
  const isolate = createCatalog();
  assert.deepEqual(await isolate.rows(options(send)), good);
  await settle();
  const attempted = calls.length;
  assert.deepEqual(await createCatalog().rows(options(send)), good);
  advance(RETRY_MS - 1000);
  assert.deepEqual(await isolate.rows(options(send)), good);
  assert.equal(calls.length, attempted);
});

test('a list whose first page fails is replaced by its previous copy, or else the refresh is not used', async t => {
  quiet(t);
  const {options, advance, settle} = setup();
  let broken = true, generation = 1;
  const netflixPage1 = (url: URL) => broken && url.pathname === '/3/discover/movie' && url.searchParams.get('with_watch_providers') === '8|1796' && url.searchParams.get('page') === '1' ? 500 : undefined;
  const {send} = tmdb({generation: () => generation, fail: netflixPage1});
  assert.deepEqual(await createCatalog().rows(options(send)), {body: NO_ROWS_BODY, source: 'none', failed: true});
  await settle();

  advance(RETRY_MS + 1000);
  broken = false;
  const before = JSON.parse((await createCatalog().rows(options(send))).body);
  advance(FRESH_MS + 1000);
  broken = true; generation = 2;
  const isolate = createCatalog();
  await isolate.rows(options(send));
  await settle();
  const after = JSON.parse((await isolate.rows(options(send))).body);
  assert.deepEqual(after.movie.services.netflix, before.movie.services.netflix);
  assert.match(after.movie.popular[0].title, / g2$/);
});

test('the key never reaches the answer or the logs; failures are logged with fixed codes', async t => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => {logged.push(args);});
  const {options, settle} = setup();
  const good = tmdb();
  for (const key of [V3, V4]) {
    const answer = await createCatalog().rows(options(good.send, {key}));
    assert.equal(answer.source, 'tmdb');
    assert.ok(!answer.body.includes(key));
  }

  // A key pasted the wrong way is reported once per isolate, and TMDB is not called with it.
  const isolate = createCatalog(), before = good.calls.length;
  for (const key of ['Bearer ' + V4, '"' + V3 + '"']) assert.deepEqual(await isolate.rows(options(good.send, {key})), {body: NO_ROWS_BODY, source: 'none', failed: false});
  assert.equal(good.calls.length, before);
  assert.deepEqual(logged, [['lumanest_catalog_key_unrecognized']]);

  logged.length = 0;
  await createCatalog().rows(setup().options(tmdb({fail: () => 401}).send));
  await createCatalog().rows(setup().options(tmdb({fail: () => 'network'}).send, {key: V4}));
  await settle();
  assert.deepEqual(logged, [['lumanest_catalog_tmdb_unauthorized'], ['lumanest_catalog_refresh_failed']]);
  for (const args of logged) for (const arg of args) assert.ok(!String(arg).includes(V3) && !String(arg).includes(V4));
});

test('a request with no copy waits a limited time; the refresh carries on and is cached', async () => {
  const {options, settle} = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const {send} = tmdb();
  const gated = (async (input: string | URL | Request, init?: RequestInit) => {await gate; return send(input, init);}) as typeof fetch;
  const isolate = createCatalog();
  assert.deepEqual(await isolate.rows(options(gated, {waitMs: 30})), {body: NO_ROWS_BODY, source: 'none', failed: true});
  // Another isolate in the location sees the refresh under way and waits for it no longer either.
  assert.deepEqual(await createCatalog().rows(options(send, {waitMs: 30})), {body: NO_ROWS_BODY, source: 'none', failed: true});
  release();
  await settle();
  assert.equal((await createCatalog().rows(options(send))).source, 'tmdb');
});

test('a refresh that never settles does not stop the isolate from refreshing again', async t => {
  quiet(t);
  const {options, advance, settle} = setup();
  let lost = true;
  const {calls, send} = tmdb({fail: () => lost ? 'hang' : undefined});
  const isolate = createCatalog();
  // The first refresh hangs (as if its request had been cancelled; here its deadline is long).
  assert.equal((await isolate.rows(options(send, {waitMs: 20, deadlineMs: 2000, timeoutMs: 2000}))).failed, true);
  const hanging = calls.length;
  assert.ok(hanging > 0);
  // Once the location's hold has lapsed and the refresh is older than INFLIGHT_MAX_MS, the next request starts anew.
  advance(Math.max(INFLIGHT_MAX_MS, 60 * 1000) + 1000);
  lost = false;
  const answer = await isolate.rows(options(send));
  assert.equal(answer.source, 'tmdb');
  assert.ok(calls.length >= hanging + 112);
  await settle();
});
