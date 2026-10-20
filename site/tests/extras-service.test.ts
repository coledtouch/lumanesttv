// The subtitle and trailer endpoints (lib/extras-service.ts) with OpenSubtitles, TMDB, R2, D1 and the rate-limit
// bindings replaced by doubles. Nothing here reaches the network: every upstream request goes to the double, which
// answers 599 to anything it doesn't expect. D1 is an in-memory SQLite database with the site's migrations.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
  BUDGET_LOW_SHARE, COUNT_RETRY_S, FILE_MAX_BYTES, LIMITS, LOGIN_TTL_MS, MEMORY_MAX, PURGE_EVERY_MS, RETRY_MS, STALE_MAX_MS, createExtras, optionsAnswer, withoutBody,
  type D1Like, type D1StatementLike, type ExtrasEnv, type R2Like, type RateLimitLike,
} from '../lib/extras-service.ts';
import {CLIENT_DAILY_DOWNLOADS, CREDIT, DAILY_DOWNLOADS, NETWORK_DAILY_DOWNLOADS, parseSrt, toSrt, toVtt} from '../lib/extras.ts';
import {mac} from '../lib/player-crypto.ts';
import {qrRows} from '../lib/qr.ts';

const PLAYER_KEY = 'c'.repeat(64);
const OS_KEY = 'os-consumer-key-SECRET';
const OS_USER = 'os-user-SECRET';
const OS_PASSWORD = 'os-password SECRET!';
const OS_TOKEN = 'eyJos.login.TOKEN-SECRET';
const TMDB_V3 = '0123456789abcdef0123456789abcdef';
const TMDB_V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJsdW1hbmVzdCJ9.c2lnbmF0dXJlLXZhbHVl';
const IP = '203.0.113.77';
/** Never in an answer or a log line. */
const SECRETS = [OS_KEY, OS_USER, OS_PASSWORD, OS_TOKEN, TMDB_V3, TMDB_V4, PLAYER_KEY, IP, 'opensubtitles.com/download'];
/** Never in a log line either: titles and upstream URLs. */
const LOG_SECRETS = [...SECRETS, 'Matrix', 'matrix', 'themoviedb', 'youtu'];
const START = Date.parse('2026-10-20T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SRT = '1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> & <b>world</b>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<script>alert(1)</script>Bye\r\n';

/** R2 as the Worker sees it: one bucket shared by every isolate. */
class FakeR2 implements R2Like {
  objects = new Map<string, string>();
  gets = 0;
  puts: string[] = [];
  failing = false;
  async get(key: string) {
    this.gets++;
    if (this.failing) throw new Error('r2 down');
    const value = this.objects.get(key);
    return value === undefined ? null : {text: async () => value};
  }
  async put(key: string, value: string) {
    if (this.failing) throw new Error('r2 down');
    this.puts.push(key);
    this.objects.set(key, value);
    return {};
  }
  json(key: string) {const value = this.objects.get(key); return value === undefined ? undefined : JSON.parse(value);}
}

// Node prints that node:sqlite is experimental the first time it's used (a moment later): here, before any test
// watches the logs.
new DatabaseSync(':memory:').close();
await new Promise(resolve => setTimeout(resolve, 10));

/** D1 as the Worker sees it, on SQLite with the site's migrations: a batch runs in one transaction, in order. */
class FakeD1 implements D1Like {
  sqlite = new DatabaseSync(':memory:');
  batches = 0;
  statements: string[] = [];
  /** 'throw': every call fails; 'shape': batches answer without rows. */
  failing: '' | 'throw' | 'shape' = '';
  constructor() {
    const dir = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(file, dir), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  prepare(sql: string): D1StatementLike {
    const statement = (values: unknown[]): D1StatementLike & {sql: string; values: unknown[]} => ({
      sql, values,
      bind: (...more: unknown[]) => statement(more),
      run: async () => {
        if (this.failing === 'throw') throw new Error('d1 down');
        this.statements.push(sql);
        return this.sqlite.prepare(sql).run(...(values as (string | number)[]));
      },
    });
    return statement([]);
  }
  async batch(statements: D1StatementLike[]) {
    this.batches++;
    if (this.failing === 'throw') throw new Error('d1 down');
    if (this.failing === 'shape') return statements.map(() => ({}));
    this.sqlite.exec('BEGIN');
    try {
      const results = (statements as (D1StatementLike & {sql: string; values: (string | number)[]})[]).map(item => {
        this.statements.push(item.sql);
        return {results: this.sqlite.prepare(item.sql).all(...item.values)};
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {this.sqlite.exec('ROLLBACK'); throw error;}
  }
  rows() {return this.sqlite.prepare('SELECT day, client, count FROM extras_download_counts ORDER BY day, client').all().map(row => ({...row}));}
  count(day: string, client: string) {return (this.sqlite.prepare('SELECT count FROM extras_download_counts WHERE day=? AND client=?').get(day, client) as {count: number} | undefined)?.count ?? 0;}
}

type Call = {method: string; url: URL; headers: Headers; body: string | null};
/** An answer whose JSON the tests read freely. */
type Answer = {json(): Promise<any>} & Response;
type Handler = (call: Call, signal: AbortSignal | null) => Response | Promise<Response>;

function entry(fileId: number, extra: Record<string, unknown> = {}, feature: Record<string, unknown> = {}) {
  return {id: String(fileId), type: 'subtitle', attributes: {
    language: 'en', download_count: 1000 - fileId, hearing_impaired: false, ai_translated: false, machine_translated: false, foreign_parts_only: false,
    from_trusted: true, upload_date: '2024-01-01T00:00:00Z', files: [{file_id: fileId, cd_number: 1, file_name: 'x.srt'}],
    feature_details: {feature_type: 'Movie', tmdb_id: 603, ...feature}, ...extra,
  }};
}
const SEARCH: Record<string, unknown[]> = {
  603: [entry(110), entry(111, {hearing_impaired: true}), entry(112, {}, {tmdb_id: 999}), entry(113, {download_count: 5}), entry(114, {language: 'fr'}), entry(115, {download_count: 1})],
  550: [entry(201, {language: 'es'}, {tmdb_id: 550})],
  episode: [entry(301, {}, {feature_type: 'Episode', parent_tmdb_id: 1399, season_number: 1, episode_number: 3, tmdb_id: 63056}),
    entry(302, {}, {feature_type: 'Episode', parent_tmdb_id: 1399, season_number: 1, episode_number: 4})],
};
const VIDEOS: Record<string, unknown[]> = {
  603: [
    {iso_639_1: 'en', iso_3166_1: 'US', name: 'Featurette', key: 'feature0001', site: 'YouTube', type: 'Featurette', official: true, published_at: '2019-01-01T00:00:00.000Z'},
    {iso_639_1: 'en', iso_3166_1: 'US', name: 'The Matrix - Official Trailer', key: 'vKQi3bBA1y8', site: 'YouTube', type: 'Trailer', official: true, published_at: '2021-01-01T00:00:00.000Z'},
  ],
  1399: [{iso_639_1: 'en', name: 'Season 1 Teaser', key: 'BpJYNVhGf1s', site: 'YouTube', type: 'Teaser', official: true, published_at: '2011-01-01T00:00:00.000Z'}],
  13: [{iso_639_1: 'en', name: 'Clip', key: 'clip0000001', site: 'YouTube', type: 'Clip', official: true}],
};

function harness(t: TestContext, options: {env?: Partial<ExtrasEnv>; bucket?: FakeR2 | null; db?: FakeD1 | null; timing?: {requestMs?: number; linkMs?: number}; waitUntil?: (job: Promise<unknown>) => void} = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const texts: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => {logs.push(args.map(String).join(' '));});
  t.mock.method(console, 'log', (...args: unknown[]) => {logs.push(args.map(String).join(' '));});
  const state = {clock: START, downloads: 0, logins: 0, remaining: 100};
  const bucket = options.bucket === undefined ? new FakeR2() : options.bucket;
  const db = options.db === undefined ? new FakeD1() : options.db;
  t.after(() => db?.sqlite.close());
  const handlers: Record<string, Handler> = {
    login: call => {
      state.logins++;
      const body = JSON.parse(call.body || '{}');
      if (body.username !== OS_USER || body.password !== OS_PASSWORD) return Response.json({message: 'Error, invalid username/password', status: 401}, {status: 401});
      return Response.json({user: {allowed_downloads: 1000, vip: true}, base_url: 'vip-api.opensubtitles.com', token: OS_TOKEN, status: 200});
    },
    search: call => {
      const u = call.url;
      const key = u.searchParams.get('type') === 'episode' ? 'episode' : u.searchParams.get('tmdb_id') || '';
      return Response.json({total_pages: 1, total_count: (SEARCH[key] || []).length, per_page: 60, page: 1, data: SEARCH[key] || []});
    },
    download: call => {
      state.downloads++;
      const {file_id} = JSON.parse(call.body || '{}');
      state.remaining--;
      return Response.json({link: `https://www.opensubtitles.com/download/ABC${file_id}/subfile/x.srt`, file_name: 'x.srt', requests: 1, remaining: state.remaining, message: 'ok', reset_time: '11 hours', reset_time_utc: '2026-10-21T00:00:00.000Z'});
    },
    file: () => new Response(SRT, {headers: {'Content-Type': 'application/x-subrip'}}),
    videos: call => {
      const id = /\/(\d+)\/videos$/.exec(call.url.pathname)![1];
      if (id === '404') return Response.json({success: false, status_code: 34}, {status: 404});
      return Response.json({id: Number(id), results: VIDEOS[id] || []});
    },
    tmdbSearch: call => {
      const query = call.url.searchParams.get('query');
      if (call.url.pathname === '/3/search/movie' && query === 'matrix') {
        return Response.json({page: 1, results: [
          {id: 603, title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-31'},
          {id: 604, title: 'The Matrix Reloaded', original_title: 'The Matrix Reloaded', release_date: '2003-05-15'},
        ]});
      }
      if (query === 'heat') return Response.json({page: 1, results: [{id: 949, title: 'Heat', release_date: '1995-12-15'}, {id: 1111, title: 'Heat', release_date: '1995-01-01'}]});
      if (call.url.pathname === '/3/search/tv' && query === 'game of thrones') return Response.json({page: 1, results: [{id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17'}]});
      return Response.json({page: 1, results: []});
    },
  };
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {method: init?.method || 'GET', url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : null};
    calls.push(call);
    assert.equal(init?.redirect ?? (url.hostname.endsWith('opensubtitles.com') ? 'missing' : 'follow'), url.hostname.endsWith('opensubtitles.com') ? 'manual' : 'follow', 'OpenSubtitles redirects are followed by hand');
    const signal = init?.signal || null;
    const pick = (): Handler | null => {
      if ((url.hostname === 'api.opensubtitles.com' || url.hostname === 'vip-api.opensubtitles.com') && url.protocol === 'https:') {
        if (url.pathname === '/api/v1/login' && call.method === 'POST') return handlers.login;
        if (url.pathname === '/api/v1/subtitles' && call.method === 'GET') return handlers.search;
        if (url.pathname === '/api/v1/download' && call.method === 'POST') return handlers.download;
      }
      if (url.hostname.endsWith('.opensubtitles.com') && url.pathname.startsWith('/download/')) return handlers.file;
      if (url.origin === 'https://api.themoviedb.org') {
        if (/^\/3\/(movie|tv)\/\d+\/videos$/.test(url.pathname)) return handlers.videos;
        if (/^\/3\/search\/(movie|tv)$/.test(url.pathname)) return handlers.tmdbSearch;
      }
      return null;
    };
    const handler = pick();
    if (!handler) return new Response('unexpected request', {status: 599});
    return await handler(call, signal);
  }) as typeof fetch;
  const env: ExtrasEnv = {OPENSUBTITLES_API_KEY: OS_KEY, PLAYER_COOKIE_KEY: PLAYER_KEY, TMDB_API_KEY: TMDB_V3, BUCKET: bucket, DB: db, ...options.env};
  let instance = createExtras();
  const deps = () => ({env, fetch: send, now: () => state.clock, waitUntil: options.waitUntil, timing: {requestMs: 300, linkMs: 300, retryDelayMs: 5, storeMs: 300, ...options.timing}});
  const request = (path: string, init: RequestInit = {}) => new Request('https://lumanest.tv' + path, {...init, headers: {'CF-Connecting-IP': IP, ...(init.headers as Record<string, string> || {})}});
  async function keep(response: Response): Promise<Answer> {
    const copy = response.clone();
    texts.push(JSON.stringify([...copy.headers]) + '\n' + await copy.text());
    return response as Answer;
  }
  const h = {
    calls, logs, state, bucket, db, handlers, env,
    get clock() {return state.clock;},
    set clock(value: number) {state.clock = value;},
    /** A new isolate: fresh memory, the same R2. */
    newIsolate() {instance = createExtras();},
    subtitles: async (query: string, init?: RequestInit) => keep(await instance.subtitles(request('/api/extras/subtitles?' + query, init), deps())),
    file: async (path: string, head = false, init: RequestInit = {}) => keep(await instance.subtitleFile(request(path, {...init, ...(head ? {method: 'HEAD'} : {})}), deps(), {head})),
    trailer: async (query: string, init?: RequestInit) => keep(await instance.trailer(request('/api/extras/trailer?' + query, init), deps())),
    upstream: (filter: (call: Call) => boolean = () => true) => calls.filter(filter).length,
    searches: () => calls.filter(c => c.url.pathname === '/api/v1/subtitles').length,
    downloadCalls: () => calls.filter(c => c.url.pathname === '/api/v1/download').length,
    tmdbCalls: () => calls.filter(c => c.url.hostname === 'api.themoviedb.org').length,
    /** No secret, IP or URL ever appears in an answer or a log line. */
    checkNoSecrets() {
      for (const text of texts) for (const secret of SECRETS) assert.ok(!text.includes(secret), `"${secret}" leaked: ${text.slice(0, 300)}`);
      for (const line of logs) for (const secret of LOG_SECRETS) assert.ok(!line.includes(secret), `"${secret}" logged: ${line}`);
      for (const line of logs) assert.match(line, /^lumanest_[a-z_]+(?: \{"remaining":(?:-?\d+|null)\})?$/, 'fixed codes and numbers only: ' + line);
    },
  };
  return h;
}

/**
 * An upstream that never answers, until the request's signal gives up. Node's AbortSignal.timeout timer doesn't
 * keep the process alive, so the double holds a timer of its own meanwhile.
 */
const hang: Handler = (_call, signal) => new Promise((_, reject) => {
  const alive = setTimeout(() => reject(new Error('the request was never given up')), 5000);
  signal!.addEventListener('abort', () => {clearTimeout(alive); reject(signal!.reason);});
});

async function token(fileId: number, key = PLAYER_KEY) {return fileId + '-' + (await mac('extras-subtitle-v1\n' + fileId, key, 'extras-subtitle')).slice(0, 22);}
/** The client column of the daily count: a keyed hash of the client's network, never the address. */
const clientHash = (prefix: string) => mac('extras-client-v1\n' + prefix, PLAYER_KEY, 'extras-client');
const from = (ip: string): RequestInit => ({headers: {'CF-Connecting-IP': ip}});
const TODAY = '2026-10-20';
const filePath = async (fileId: number, ext = 'vtt') => `/api/extras/subtitles/file/${await token(fileId)}.${ext}`;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// ------------------------------------------------------------------ not configured

test('without OPENSUBTITLES_API_KEY or a valid PLAYER_COOKIE_KEY: "not_configured", no upstream request, files 503', async t => {
  for (const env of [{OPENSUBTITLES_API_KEY: undefined}, {OPENSUBTITLES_API_KEY: '  '}, {PLAYER_COOKIE_KEY: undefined}, {PLAYER_COOKIE_KEY: 'short'}]) {
    const h = harness(t, {env});
    const response = await h.subtitles('v=1&type=movie&tmdb=603');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=600');
    assert.deepEqual(await response.json(), {v: 1, status: 'not_configured', tmdb: 603, tracks: [], credit: CREDIT});
    const named = await (await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999')).json();
    assert.equal(named.status, 'not_configured');
    assert.equal(named.tmdb, null);
    const file = await h.file(await filePath(110));
    assert.equal(file.status, 503);
    assert.equal((await file.json()).error.code, 'unavailable');
    assert.equal(h.calls.length, 0);
    h.checkNoSecrets();
  }
});

test('trailer without TMDB_API_KEY (or with an unrecognized one): "not_configured"; the name fallback answers "unmatched"', async t => {
  for (const key of [undefined, 'Bearer nonsense']) {
    const h = harness(t, {env: {TMDB_API_KEY: key}});
    const response = await h.trailer('v=1&type=movie&tmdb=603');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=600');
    assert.deepEqual(await response.json(), {v: 1, status: 'not_configured', tmdb: 603, trailer: null});
    const subtitles = await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999');
    assert.equal(subtitles.headers.get('Cache-Control'), 'public, max-age=21600');
    assert.deepEqual(await subtitles.json(), {v: 1, status: 'unmatched', tmdb: null, tracks: [], credit: CREDIT});
    assert.equal(h.calls.length, 0);
    h.checkNoSecrets();
  }
});

// ------------------------------------------------------------------ lookups

test('a movie lookup: OpenSubtitles search, the best three files as signed same-origin URLs, cached in R2 for everyone', async t => {
  const h = harness(t);
  const response = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(response.status, 200);
  for (const [name, value] of Object.entries({
    'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400', 'X-Content-Type-Options': 'nosniff',
  })) assert.equal(response.headers.get(name), value, name);
  const body = await response.json();
  const base = 'https://lumanest.tv/api/extras/subtitles/file/';
  assert.deepEqual(body, {v: 1, status: 'ok', tmdb: 603, credit: CREDIT, tracks: [
    {id: await token(110), lang: 'en', label: 'English (OpenSubtitles)', hi: false, vtt: base + await token(110) + '.vtt', srt: base + await token(110) + '.srt'},
    {id: await token(113), lang: 'en', label: 'English (OpenSubtitles 2)', hi: false, vtt: base + await token(113) + '.vtt', srt: base + await token(113) + '.srt'},
    {id: await token(115), lang: 'en', label: 'English (OpenSubtitles 3)', hi: false, vtt: base + await token(115) + '.vtt', srt: base + await token(115) + '.srt'},
  ]});
  // The search: exact path and query order, the required headers, no login.
  assert.equal(h.calls.length, 1);
  const search = h.calls[0];
  assert.equal(search.url.href, 'https://api.opensubtitles.com/api/v1/subtitles?languages=en&order_by=download_count&order_direction=desc&tmdb_id=603&type=movie');
  assert.equal(search.headers.get('Api-Key'), OS_KEY);
  assert.equal(search.headers.get('User-Agent'), 'LumaNest TV v1.0');
  assert.equal(search.headers.get('Accept'), '*/*');
  assert.equal(search.headers.get('Authorization'), null);
  // Metadata only, under extras/v1/, fresh for 30 days.
  const stored = h.bucket!.json('extras/v1/subtitles/movie/603/en.json');
  assert.deepEqual(stored, {v: 1, stored: '2026-10-20T12:00:00.000Z', expires: '2026-11-19T12:00:00.000Z', files: [
    {file_id: 110, hi: false, label: 'English (OpenSubtitles)'}, {file_id: 113, hi: false, label: 'English (OpenSubtitles 2)'}, {file_id: 115, hi: false, label: 'English (OpenSubtitles 3)'},
  ]});
  // Another isolate, 29 days later: served from R2 without a search.
  h.newIsolate();
  h.clock = START + 29 * DAY;
  const again = await (await h.subtitles('v=1&type=movie&tmdb=603')).json();
  assert.deepEqual(again, body);
  assert.equal(h.searches(), 1);
  // The track URLs follow the origin the request came to.
  const local = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.ok((await local.json()).tracks.every((track: {vtt: string}) => track.vtt.startsWith('https://lumanest.tv/api/extras/subtitles/file/')));
  h.checkNoSecrets();
});

test('an episode lookup searches the series by season and episode; HI-only, wrong episodes and nothing usable', async t => {
  const h = harness(t);
  const body = await (await h.subtitles('v=1&type=episode&tmdb=1399&season=01&episode=3')).json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.tracks.map((track: {id: string}) => track.id), [await token(301)]);
  assert.equal(h.calls[0].url.href, 'https://api.opensubtitles.com/api/v1/subtitles?episode_number=3&languages=en&order_by=download_count&order_direction=desc&parent_tmdb_id=1399&season_number=1&type=episode');
  assert.ok(h.bucket!.objects.has('extras/v1/subtitles/tv/1399/s1/e3/en.json'));
  // Nothing usable: "none", cached for 3 days (a negative cache), and the apps get a shorter Cache-Control.
  const none = await h.subtitles('v=1&type=movie&tmdb=550');
  assert.equal(none.headers.get('Cache-Control'), 'public, max-age=21600');
  assert.deepEqual(await none.json(), {v: 1, status: 'none', tmdb: 550, tracks: [], credit: CREDIT});
  assert.deepEqual(h.bucket!.json('extras/v1/subtitles/movie/550/en.json'), {v: 1, stored: '2026-10-20T12:00:00.000Z', expires: '2026-10-23T12:00:00.000Z', files: []});
  h.clock = START + 3 * DAY - 1;
  await h.subtitles('v=1&type=movie&tmdb=550');
  assert.equal(h.searches(), 2);
  h.clock = START + 3 * DAY;
  await h.subtitles('v=1&type=movie&tmdb=550');
  assert.equal(h.searches(), 3, 'searched again once the 3 days are over');
  h.checkNoSecrets();
});

test('upstream failures: never cached as "none"; 503 without a copy; a stale copy for up to 90 days with a 5-minute hold', async t => {
  const h = harness(t);
  let failing = true;
  const search = h.handlers.search;
  h.handlers.search = (call, signal) => failing ? new Response('busy', {status: 503}) : search(call, signal);
  const failed = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  assert.equal(failed.headers.get('Retry-After'), '300');
  assert.deepEqual(await failed.json(), {v: 1, error: {code: 'unavailable', message: 'This is not available right now. Please try again later.'}});
  assert.equal(h.bucket!.objects.size, 0, 'a failure is not stored');
  assert.ok(h.logs.includes('lumanest_subtitles_search_failed'));
  // Without a copy, the next request tries again at once.
  failing = false;
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=603')).json()).status, 'ok');
  assert.equal(h.searches(), 2);
  // Expired, and the refresh fails: the stale copy, briefly cacheable, and no new refresh for 5 minutes.
  failing = true;
  h.clock = START + 31 * DAY;
  const stale = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await stale.json()).tracks.length, 3);
  assert.equal(h.searches(), 3);
  h.clock += RETRY_MS - 1;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=603')).headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(h.searches(), 3, 'held for 5 minutes');
  h.clock += 1;
  await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(h.searches(), 4);
  // A copy 90 days old is not served any more.
  h.clock = START + STALE_MAX_MS;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=603')).status, 503);
  // Bad JSON, a missing data array and a timeout are failures too.
  failing = false;
  for (const handler of [() => new Response('{nope'), () => Response.json({total_count: 0})]) {
    h.handlers.search = handler;
    assert.equal((await h.subtitles('v=1&type=movie&tmdb=604')).status, 503);
  }
  h.handlers.search = hang;
  const started = Date.now();
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=604')).status, 503);
  assert.ok(Date.now() - started < 2000, 'timed out');
  assert.equal(h.bucket!.objects.has('extras/v1/subtitles/movie/604/en.json'), false);
  h.checkNoSecrets();
});

test('concurrent lookups of one title share one search; R2 failures never fail a lookup; without R2 nothing is cached', async t => {
  const h = harness(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const search = h.handlers.search;
  h.handlers.search = async (call, signal) => {await gate; return search(call, signal);};
  const both = Promise.all([h.subtitles('v=1&type=movie&tmdb=603'), h.subtitles('v=1&type=movie&tmdb=603')]);
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const [a, b] = await both;
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(h.searches(), 1);
  assert.equal(h.bucket!.puts.filter(key => key === 'extras/v1/subtitles/movie/603/en.json').length, 1);
  h.handlers.search = search;
  h.bucket!.failing = true;
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=605')).json()).status, 'none');

  const bare = harness(t, {bucket: null});
  for (let i = 0; i < 3; i++) assert.equal((await (await bare.subtitles('v=1&type=movie&tmdb=603')).json()).status, 'ok');
  assert.equal(bare.searches(), 3, 'every lookup searches without R2');
  bare.checkNoSecrets();
});

test('a corrupt or foreign R2 object is ignored and replaced', async t => {
  const h = harness(t);
  for (const value of ['{', '[]', JSON.stringify({v: 2, stored: 'x', expires: 'y', files: []}),
    JSON.stringify({v: 1, stored: '2026-10-20T00:00:00Z', expires: '2099-01-01T00:00:00Z', files: [{file_id: 'x'}]}),
    JSON.stringify({v: 1, stored: '2026-10-20T00:00:00Z', expires: '2099-01-01T00:00:00Z', files: [{file_id: 1}, {file_id: 2}, {file_id: 3}, {file_id: 4}]})]) {
    h.bucket!.objects.set('extras/v1/subtitles/movie/603/en.json', value);
    assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=603')).json()).tracks.length, 3);
  }
  assert.equal(h.searches(), 5);
});

// ------------------------------------------------------------------ the name fallback

test('the name fallback resolves with TMDB (exact title and year, one id), cached under a hash, never the text search', async t => {
  const h = harness(t);
  const body = await (await h.subtitles('v=1&type=movie&name=EN+%7C+The+Matrix+(1999)&year=1999')).json();
  assert.equal(body.status, 'ok');
  assert.equal(body.tmdb, 603);
  const tmdb = h.calls.find(call => call.url.hostname === 'api.themoviedb.org')!;
  assert.equal(tmdb.url.pathname, '/3/search/movie');
  assert.deepEqual(Object.fromEntries(tmdb.url.searchParams), {query: 'matrix', year: '1999', include_adult: 'false', language: 'en-US', page: '1', api_key: TMDB_V3});
  // OpenSubtitles is only ever searched by TMDB id.
  assert.ok(h.calls.filter(call => call.url.pathname === '/api/v1/subtitles').every(call => call.url.searchParams.get('tmdb_id') === '603' && !call.url.searchParams.has('query')));
  // Brackets are dropped by normalizing; the whole key keeps the leading tag.
  const object = 'extras/v1/resolve/movie/' + sha256('matrix\nen the matrix\n1999') + '.json';
  assert.deepEqual(h.bucket!.json(object), {v: 1, stored: '2026-10-20T12:00:00.000Z', expires: '2026-11-19T12:00:00.000Z', tmdb: 603});
  await h.subtitles('v=1&type=movie&name=EN+%7C+The+Matrix+(1999)&year=1999');
  assert.equal(h.tmdbCalls(), 1, 'the resolution is cached');
  // The same name finds the trailer through the same cached resolution.
  const trailer = await (await h.trailer('v=1&type=movie&name=EN+%7C+The+Matrix+(1999)&year=1999')).json();
  assert.equal(trailer.tmdb, 603);
  assert.equal(trailer.status, 'ok');
  // Two titles of the same name and year, or none: unmatched (cached for 7 days); series search the tv list.
  const heat = await h.subtitles('v=1&type=movie&name=Heat&year=1995');
  assert.equal(heat.headers.get('Cache-Control'), 'public, max-age=21600');
  assert.deepEqual(await heat.json(), {v: 1, status: 'unmatched', tmdb: null, tracks: [], credit: CREDIT});
  const heatObject = h.bucket!.json('extras/v1/resolve/movie/' + sha256('heat\nheat\n1995') + '.json');
  assert.equal(heatObject.tmdb, null);
  assert.equal(heatObject.expires, '2026-10-27T12:00:00.000Z');
  const episode = await (await h.subtitles('v=1&type=episode&name=Game+of+Thrones&year=2011&season=1&episode=3')).json();
  assert.equal(episode.tmdb, 1399);
  assert.equal(episode.status, 'ok');
  assert.ok(h.calls.some(call => call.url.pathname === '/3/search/tv' && call.url.searchParams.get('first_air_date_year') === '2011'));
  // A name that normalizes to nothing never reaches TMDB.
  const calls = h.tmdbCalls();
  assert.equal((await (await h.subtitles('v=1&type=movie&name=%7C%7C%7C&year=1999')).json()).status, 'unmatched');
  assert.equal(h.tmdbCalls(), calls);
  // TMDB failing with no copy: 503, nothing stored.
  h.handlers.tmdbSearch = () => new Response('down', {status: 500});
  const down = await h.subtitles('v=1&type=movie&name=Up&year=2009');
  assert.equal(down.status, 503);
  assert.ok(h.logs.includes('lumanest_extras_resolve_failed'));
  h.checkNoSecrets();
});

// ------------------------------------------------------------------ files

test('a file: one download per GET, converted, sanitized, nothing stored; HEAD downloads nothing', async t => {
  const h = harness(t);
  const vtt = await h.file(await filePath(110));
  assert.equal(vtt.status, 200);
  for (const [name, value] of Object.entries({
    'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=604800', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
  })) assert.equal(vtt.headers.get(name), value, name);
  const text = await vtt.text();
  assert.equal(text, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello &amp; world\n\n00:00:03.000 --> 00:00:04.000\nalert(1)Bye\n');
  assert.equal(text, toVtt(parseSrt(SRT)));
  const download = h.calls.find(call => call.url.pathname === '/api/v1/download')!;
  assert.equal(download.url.href, 'https://api.opensubtitles.com/api/v1/download');
  assert.equal(download.method, 'POST');
  assert.deepEqual(JSON.parse(download.body!), {file_id: 110});
  assert.equal(download.headers.get('Content-Type'), 'application/json');
  assert.equal(download.headers.get('Api-Key'), OS_KEY);
  assert.equal(download.headers.get('User-Agent'), 'LumaNest TV v1.0');
  assert.ok(h.calls.some(call => call.url.href === 'https://www.opensubtitles.com/download/ABC110/subfile/x.srt'));
  assert.ok(h.logs.includes('lumanest_subtitles_download {"remaining":99}'));
  // SRT for platforms that want it (Roku): the same plain text, no tag left.
  const srt = await h.file(await filePath(110, 'srt'));
  assert.equal(srt.headers.get('Content-Type'), 'application/x-subrip; charset=utf-8');
  assert.equal(await srt.text(), toSrt(parseSrt(SRT)));
  assert.equal(h.downloadCalls(), 2, 'every GET downloads: nothing is kept');
  assert.equal(h.bucket!.puts.filter(key => !key.startsWith('extras/v1/state/')).length, 0, 'no file in R2');
  // HEAD: the headers only, no download.
  const head = await h.file(await filePath(110), true);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'text/vtt; charset=utf-8');
  assert.equal(await head.text(), '');
  assert.equal(h.downloadCalls(), 2);
  // A Range header changes nothing.
  const ranged = await h.file(await filePath(110));
  assert.equal(ranged.status, 200);
  h.checkNoSecrets();
});

test('file tokens: only the ones a lookup handed out', async t => {
  const h = harness(t);
  const good = await token(110);
  const other = await token(110, 'd'.repeat(64));
  for (const path of [
    '/api/extras/subtitles/file/' + other + '.vtt', '/api/extras/subtitles/file/111-' + good.split('-')[1] + '.vtt',
    '/api/extras/subtitles/file/' + good + '.ass', '/api/extras/subtitles/file/0' + good + '.vtt', '/api/extras/subtitles/file/' + good + '.vtt.vtt',
    '/api/extras/subtitles/file/9999999999-' + good.split('-')[1] + '.vtt', '/api/extras/subtitles/file/' + good.slice(0, -1) + '.vtt',
  ]) {
    const response = await h.file(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), {v: 1, error: {code: 'not_found', message: 'This subtitle file is not available.'}});
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(h.calls.length, 0);
});

test('downloads: quota used up, a gone link, server errors, 429, hosts, sizes and unreadable files', async t => {
  // Many files in one minute: a limiter binding that always allows.
  const h = harness(t, {env: {SUBTITLE_FILE_LIMITER: {limit: async () => ({success: true})}}});
  // 406 with the reset time: 503 until then, recorded for every isolate; lookups say "unavailable" meanwhile.
  h.handlers.download = () => Response.json({requests: 101, remaining: -1, message: 'You have downloaded your allowed 100 subtitles for 24h', reset_time_utc: '2026-10-21T00:00:00.000Z'}, {status: 406});
  const quota = await h.file(await filePath(110));
  assert.equal(quota.status, 503);
  assert.equal(quota.headers.get('Retry-After'), String(12 * 60 * 60));
  assert.ok(h.logs.includes('lumanest_subtitles_quota_exhausted'));
  assert.equal(h.bucket!.json('extras/v1/state/opensubtitles.json').quotaUntil, '2026-10-21T00:00:00.000Z');
  h.newIsolate();
  const calls = h.calls.length;
  const blocked = await h.file(await filePath(110));
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get('Retry-After'), String(12 * 60 * 60));
  const lookup = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(lookup.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await lookup.json(), {v: 1, status: 'unavailable', tmdb: 603, tracks: [], credit: CREDIT});
  assert.equal(h.calls.length, calls, 'OpenSubtitles is not called until the reset');
  // A reset time far ahead counts at most 24 hours; a missing one, the next midnight UTC.
  h.clock = Date.parse('2026-10-21T00:00:00.000Z');
  h.newIsolate();
  h.handlers.download = () => Response.json({remaining: -1, reset_time_utc: '2027-01-01T00:00:00.000Z'}, {status: 406});
  assert.equal((await h.file(await filePath(110))).headers.get('Retry-After'), '86400');
  h.clock += DAY;
  h.newIsolate();
  h.handlers.download = () => Response.json({remaining: -1}, {status: 406});
  assert.equal((await h.file(await filePath(110))).headers.get('Retry-After'), '86400');
  h.clock += DAY;
  h.newIsolate();

  const download = (call: Call) => Response.json({link: `https://www.opensubtitles.com/download/X/${JSON.parse(call.body!).file_id}.srt`, remaining: 50});
  // A gone link (410) is asked for again once.
  let fileCalls = 0;
  h.handlers.download = download;
  h.handlers.file = () => ++fileCalls === 1 ? new Response('gone', {status: 410}) : new Response(SRT);
  const before = h.downloadCalls();
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.downloadCalls() - before, 2);
  // A server error is retried once, after a pause.
  let errors = 0;
  h.handlers.file = () => new Response(SRT);
  h.handlers.download = call => ++errors === 1 ? new Response('oops', {status: 502}) : download(call);
  assert.equal((await h.file(await filePath(110))).status, 200);
  h.handlers.download = () => new Response('oops', {status: 500});
  const twice = h.downloadCalls();
  assert.equal((await h.file(await filePath(110))).status, 503);
  assert.equal(h.downloadCalls() - twice, 2);
  assert.ok(h.logs.includes('lumanest_subtitles_download_failed'));
  // 429: try again in 5 seconds.
  h.handlers.download = () => new Response('slow down', {status: 429});
  const limited = await h.file(await filePath(110));
  assert.equal(limited.status, 503);
  assert.equal(limited.headers.get('Retry-After'), '5');
  // Links and redirects only on https under opensubtitles.com.
  for (const link of ['https://evil.example/x.srt', 'http://www.opensubtitles.com/x.srt', 'https://opensubtitles.com.evil.example/x.srt', 'https://www.opensubtitles.com:8443/x.srt', 42]) {
    h.handlers.download = () => Response.json({link, remaining: 1});
    assert.equal((await h.file(await filePath(110))).status, 503, String(link));
  }
  h.handlers.download = download;
  h.handlers.file = () => new Response(null, {status: 302, headers: {Location: 'https://evil.example/x.srt'}});
  assert.equal((await h.file(await filePath(110))).status, 503);
  h.handlers.file = () => new Response(null, {status: 302, headers: {Location: '/download/moved.srt'}});
  const moved = h.calls.length;
  h.handlers.file = call => call.url.pathname === '/download/moved.srt' ? new Response(SRT) : new Response(null, {status: 302, headers: {Location: '/download/moved.srt'}});
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.ok(h.calls.slice(moved).some(call => call.url.href === 'https://www.opensubtitles.com/download/moved.srt'));
  // A redirect loop ends.
  h.handlers.file = () => new Response(null, {status: 302, headers: {Location: '/download/loop.srt'}});
  assert.equal((await h.file(await filePath(110))).status, 503);
  // At most 2 MB, declared or not.
  h.handlers.file = () => new Response(SRT + 'x'.repeat(FILE_MAX_BYTES));
  assert.equal((await h.file(await filePath(110))).status, 503);
  h.handlers.file = () => new Response(new ReadableStream({start(controller) {for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(1024 * 1024).fill(65)); controller.close();}}));
  assert.equal((await h.file(await filePath(110))).status, 503);
  // No cue left: 502; invalid UTF-8 is decoded with replacement characters.
  h.handlers.file = () => new Response('this is not a subtitle file');
  const unreadable = await h.file(await filePath(110));
  assert.equal(unreadable.status, 502);
  assert.equal((await unreadable.json()).error.code, 'unreadable');
  h.handlers.file = () => new Response(new Uint8Array([...new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nCaf'), 0xe9, 0xff, 10]));
  assert.equal(await (await h.file(await filePath(110))).text(), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCaf\ufffd\ufffd\n');
  // A link that never answers times out.
  h.handlers.file = hang;
  assert.equal((await h.file(await filePath(110))).status, 503);
  h.checkNoSecrets();
});

test('OpenSubtitles redirects are followed only to https hosts under opensubtitles.com, keeping a POST on 307/308', async t => {
  const h = harness(t);
  const download = h.handlers.download;
  h.handlers.download = (call, signal) => call.url.hostname === 'api.opensubtitles.com'
    ? new Response(null, {status: 307, headers: {Location: 'https://vip-api.opensubtitles.com/api/v1/download'}})
    : download(call, signal);
  assert.equal((await h.file(await filePath(110))).status, 200);
  const moved = h.calls.find(call => call.url.hostname === 'vip-api.opensubtitles.com')!;
  assert.equal(moved.method, 'POST');
  assert.equal(moved.headers.get('Api-Key'), OS_KEY, 'from one API host to the other, the key goes along');
  assert.deepEqual(JSON.parse(moved.body!), {file_id: 110});
  h.handlers.download = () => new Response(null, {status: 308, headers: {Location: 'https://api.opensubtitles.evil.example/api/v1/download'}});
  assert.equal((await h.file(await filePath(110))).status, 503);
  assert.ok(!h.calls.some(call => call.url.hostname.endsWith('evil.example')));
  h.checkNoSecrets();
});

// ------------------------------------------------------------------ login

test('with a login: one login, the token sealed in R2 and used for 23 hours by every isolate, on the base_url host', async t => {
  const h = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: OS_PASSWORD}});
  // A lookup alone never logs in.
  await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(h.state.logins, 0);
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 1);
  const login = h.calls.find(call => call.url.pathname === '/api/v1/login')!;
  assert.equal(login.url.href, 'https://api.opensubtitles.com/api/v1/login');
  assert.deepEqual(JSON.parse(login.body!), {username: OS_USER, password: OS_PASSWORD});
  assert.equal(login.headers.get('Api-Key'), OS_KEY);
  const download = h.calls.find(call => call.url.pathname === '/api/v1/download')!;
  assert.equal(download.url.hostname, 'vip-api.opensubtitles.com', 'the login\'s base_url');
  assert.equal(download.headers.get('Authorization'), 'Bearer ' + OS_TOKEN);
  const state = h.bucket!.objects.get('extras/v1/state/opensubtitles.json')!;
  for (const secret of [OS_TOKEN, OS_USER, OS_PASSWORD]) assert.ok(!state.includes(secret), 'sealed: ' + secret);
  assert.equal(JSON.parse(state).login.at, '2026-10-20T12:00:00.000Z');
  // Another isolate uses the held token (searches too) without a login.
  h.newIsolate();
  h.clock = START + LOGIN_TTL_MS - 1000;
  h.bucket!.objects.delete('extras/v1/subtitles/movie/603/en.json');
  await h.subtitles('v=1&type=movie&tmdb=603');
  const search = h.calls.filter(call => call.url.pathname === '/api/v1/subtitles').at(-1)!;
  assert.equal(search.url.hostname, 'vip-api.opensubtitles.com');
  assert.equal(search.headers.get('Authorization'), 'Bearer ' + OS_TOKEN);
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 1);
  // After 23 hours: a new login.
  h.clock = START + LOGIN_TTL_MS;
  h.newIsolate();
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 2);
  h.checkNoSecrets();
});

test('a refused login is logged once and never retried with those credentials; downloads go on without it', async t => {
  const h = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: 'wrong password'}});
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 1);
  assert.deepEqual(h.logs.filter(line => line === 'lumanest_subtitles_login_rejected'), ['lumanest_subtitles_login_rejected']);
  const download = h.calls.find(call => call.url.pathname === '/api/v1/download')!;
  assert.equal(download.headers.get('Authorization'), null);
  assert.equal(download.url.hostname, 'api.opensubtitles.com');
  // A keyed hash of the refused secrets ('extras-credential'), not a plain SHA-256 a guess could be checked against.
  const rejected = h.bucket!.json('extras/v1/state/opensubtitles.json').rejected;
  assert.equal(rejected, await mac('extras-cred-v1\n' + OS_USER + '\nwrong password', PLAYER_KEY, 'extras-credential'));
  assert.match(rejected, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rejected, sha256(OS_USER + '\nwrong password'));
  h.clock += DAY;
  h.newIsolate();
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 1, 'refused credentials are not tried again');
  // New secrets are tried.
  h.env.OPENSUBTITLES_PASSWORD = OS_PASSWORD;
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.state.logins, 2);
  assert.equal(h.calls.filter(call => call.url.pathname === '/api/v1/download').at(-1)!.headers.get('Authorization'), 'Bearer ' + OS_TOKEN);
  h.checkNoSecrets();
});

test('logins: at most one a minute when they fail; a refused token is renewed once', async t => {
  const h = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: OS_PASSWORD}});
  const login = h.handlers.login;
  h.handlers.login = () => new Response('down', {status: 503});
  for (let i = 0; i < 3; i++) assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.calls.filter(call => call.url.pathname === '/api/v1/login').length, 1, 'one login attempt a minute');
  h.newIsolate();
  await h.file(await filePath(110));
  assert.equal(h.calls.filter(call => call.url.pathname === '/api/v1/login').length, 1, 'also across isolates (R2 state)');
  h.clock += 60 * 1000;
  h.handlers.login = login;
  await h.file(await filePath(110));
  assert.equal(h.calls.filter(call => call.url.pathname === '/api/v1/login').length, 2);
  // A token /download refuses: log in again once and retry once.
  h.clock += 60 * 1000;
  const download = h.handlers.download;
  let refused = 0;
  h.handlers.download = (call, signal) => call.headers.get('Authorization') === 'Bearer ' + OS_TOKEN && refused++ === 0 ? new Response('expired', {status: 401}) : download(call, signal);
  assert.equal((await h.file(await filePath(110))).status, 200);
  assert.equal(h.calls.filter(call => call.url.pathname === '/api/v1/login').length, 3);
  // A held token a search refuses: the search is repeated without it.
  const search = h.handlers.search;
  h.handlers.search = (call, signal) => call.headers.get('Authorization') ? new Response('no', {status: 401}) : search(call, signal);
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=604')).json()).status, 'none');
  h.checkNoSecrets();
});

// ------------------------------------------------------------------ trailers

test('a trailer: TMDB videos, the official English trailer, a QR code of the short link, cached in R2', async t => {
  const h = harness(t);
  const response = await h.trailer('v=1&type=movie&tmdb=603');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(await response.json(), {v: 1, status: 'ok', tmdb: 603, trailer: {
    key: 'vKQi3bBA1y8', name: 'The Matrix - Official Trailer', url: 'https://www.youtube.com/watch?v=vKQi3bBA1y8', short: 'youtu.be/vKQi3bBA1y8',
    qr: qrRows('https://youtu.be/vKQi3bBA1y8'),
  }});
  const call = h.calls[0];
  assert.equal(call.url.origin + call.url.pathname, 'https://api.themoviedb.org/3/movie/603/videos');
  assert.equal(call.url.searchParams.get('language'), 'en-US');
  assert.deepEqual(h.bucket!.json('extras/v1/trailers/movie/603.json'), {v: 1, stored: '2026-10-20T12:00:00.000Z', expires: '2026-11-19T12:00:00.000Z', trailer: {key: 'vKQi3bBA1y8', name: 'The Matrix - Official Trailer'}});
  h.newIsolate();
  await h.trailer('v=1&type=movie&tmdb=603');
  assert.equal(h.tmdbCalls(), 1);
  // Series: /tv/{id}/videos; a teaser when there is no trailer.
  const series = await (await h.trailer('v=1&type=tv&tmdb=1399')).json();
  assert.equal(series.trailer.key, 'BpJYNVhGf1s');
  assert.ok(h.calls.some(c => c.url.pathname === '/3/tv/1399/videos'));
  // Only clips, or an id TMDB doesn't know (404): "none", cached for 7 days.
  for (const id of ['13', '404']) {
    const none = await h.trailer('v=1&type=movie&tmdb=' + id);
    assert.equal(none.headers.get('Cache-Control'), 'public, max-age=21600');
    assert.deepEqual(await none.json(), {v: 1, status: 'none', tmdb: Number(id), trailer: null});
    assert.equal(h.bucket!.json(`extras/v1/trailers/movie/${id}.json`).expires, '2026-10-27T12:00:00.000Z');
  }
  // The v4 token goes in a header, never in the URL.
  const v4 = harness(t, {env: {TMDB_API_KEY: TMDB_V4}});
  await v4.trailer('v=1&type=movie&tmdb=603');
  assert.equal(v4.calls[0].headers.get('Authorization'), 'Bearer ' + TMDB_V4);
  assert.equal(v4.calls[0].url.searchParams.has('api_key'), false);
  v4.checkNoSecrets();
  h.checkNoSecrets();
});

test('trailer failures: a refused key or an error is 503 without a copy and the stale copy with one', async t => {
  const h = harness(t);
  h.handlers.videos = () => new Response('{"status_code":7}', {status: 401});
  const refused = await h.trailer('v=1&type=movie&tmdb=603');
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('Retry-After'), '300');
  assert.ok(h.logs.includes('lumanest_trailer_tmdb_failed'));
  assert.equal(h.bucket!.objects.size, 0);
  h.handlers.videos = () => Response.json({results: VIDEOS[603]});
  await h.trailer('v=1&type=movie&tmdb=603');
  h.clock += 31 * DAY;
  h.handlers.videos = () => new Response('down', {status: 500});
  const stale = await h.trailer('v=1&type=movie&tmdb=603');
  assert.equal(stale.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await stale.json()).trailer.key, 'vKQi3bBA1y8');
  h.handlers.videos = () => Response.json({results: 'nope'});
  assert.equal((await h.trailer('v=1&type=tv&tmdb=1399')).status, 503);
  h.checkNoSecrets();
});

// ------------------------------------------------------------------ parameters, errors and limits

test('bad parameters, versions and methods', async t => {
  const h = harness(t);
  for (const query of ['v=1&type=film&tmdb=603', 'v=1&type=movie', 'v=1&type=movie&tmdb=0603', 'v=1&type=episode&tmdb=1399&season=1', 'v=1&type=movie&tmdb=603&lang=de',
    'v=1&type=episode&tmdb=1399&season=101&episode=1', 'v=1&type=episode&tmdb=1399&season=1&episode=5001', 'v=1&type=episode&name=Dark&year=2017&season=9999&episode=9999']) {
    const response = await h.subtitles(query);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(await response.json(), {v: 1, error: {code: 'bad_request', message: 'Check the parameters and try again.'}});
  }
  assert.deepEqual(await (await h.subtitles('v=2&type=movie&tmdb=603')).json(), {v: 1, error: {code: 'unsupported_version', message: 'This version is not available.'}});
  assert.equal((await h.trailer('v=1&type=episode&tmdb=603')).status, 400);
  assert.equal((await h.trailer('v=0&type=tv&tmdb=603')).status, 400);
  assert.equal(h.calls.length, 0);
  const options = optionsAnswer();
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');
  const head = await withoutBody(await h.subtitles('v=1&type=movie&tmdb=603'));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'application/json');
  assert.equal(await head.text(), '');
});

test('rate limits per client without bindings: 120 lookups and 12 files a minute', async t => {
  const h = harness(t);
  await h.subtitles('v=1&type=movie&tmdb=603');
  for (let i = 1; i < LIMITS.lookup; i++) assert.equal((await h.trailer('v=1&type=movie&tmdb=603')).status, 200, String(i));
  const over = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('Retry-After'), '60');
  assert.deepEqual(await over.json(), {v: 1, error: {code: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.'}});
  // Another address is not limited.
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=603', {headers: {'CF-Connecting-IP': '198.51.100.1'}})).status, 200);
  for (let i = 0; i < LIMITS.file; i++) assert.equal((await h.file(await filePath(110))).status, 200, String(i));
  assert.equal((await h.file(await filePath(110))).status, 429);
  assert.equal(h.downloadCalls(), LIMITS.file);
  h.clock += 60 * 1000;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=603')).status, 200);
  assert.equal((await h.file(await filePath(110))).status, 200);
  h.checkNoSecrets();
});

test('rate limits with the Workers Rate Limiting bindings: keyed by client, misses and upstream; a failing binding falls back to the isolate', async t => {
  const keys: string[] = [];
  let allow = true, broken = false;
  const binding = (name: string): RateLimitLike => ({limit: async ({key}) => {keys.push(name + ' ' + key); if (broken) throw new Error('down'); return {success: allow};}});
  const h = harness(t, {env: {EXTRAS_LIMITER: binding('EXTRAS_LIMITER'), SUBTITLE_FILE_LIMITER: binding('SUBTITLE_FILE_LIMITER')}});
  const miss = 'miss:' + await clientHash(IP);
  await h.subtitles('v=1&type=movie&tmdb=603');
  await h.trailer('v=1&type=movie&tmdb=603');
  await h.subtitles('v=1&type=movie&tmdb=603');
  await h.file(await filePath(110));
  await h.file(await filePath(110), true);
  assert.deepEqual(keys, [
    'EXTRAS_LIMITER lookup:' + IP, 'SUBTITLE_FILE_LIMITER ' + miss, 'EXTRAS_LIMITER upstream:opensubtitles',
    'EXTRAS_LIMITER lookup:' + IP, 'SUBTITLE_FILE_LIMITER ' + miss, 'EXTRAS_LIMITER upstream:tmdb',
    'EXTRAS_LIMITER lookup:' + IP, 'SUBTITLE_FILE_LIMITER file:' + IP, 'EXTRAS_LIMITER lookup:' + IP,
  ], 'a cached lookup takes no miss or upstream token');
  // An IPv6 client is keyed by its /64; the miss keys are keyed hashes of it and of its /48, never the address.
  keys.length = 0;
  await h.subtitles('v=1&type=movie&tmdb=604', from('2001:DB8:0:1:aaaa::1'));
  assert.deepEqual(keys, [
    'EXTRAS_LIMITER lookup:2001:db8:0:1::/64', 'SUBTITLE_FILE_LIMITER miss:' + await clientHash('2001:db8:0:1::/64'),
    'SUBTITLE_FILE_LIMITER miss:' + await clientHash('2001:db8:0::/48'), 'EXTRAS_LIMITER upstream:opensubtitles',
  ]);
  assert.ok(keys.every(key => !key.includes('aaaa')));
  allow = false;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=603')).status, 429);
  assert.equal((await h.file(await filePath(110))).status, 429);
  // A binding that throws: this isolate's windows decide, with the same limits.
  allow = true;
  broken = true;
  for (let i = 0; i < LIMITS.lookup; i++) assert.equal((await h.trailer('v=1&type=movie&tmdb=603')).status, 200, String(i));
  assert.equal((await h.trailer('v=1&type=movie&tmdb=603')).status, 429);
  // Working bindings again: the isolate windows are not used.
  broken = false;
  for (let i = 0; i < LIMITS.lookup + 5; i++) assert.equal((await h.trailer('v=1&type=movie&tmdb=603', from('198.51.100.9'))).status, 200);
});

// ------------------------------------------------------------------ the daily download count

const fileLimiterOff = {SUBTITLE_FILE_LIMITER: {limit: async () => ({success: true})}};

test('each client gets 60 downloads a UTC day, then 429 until midnight; the count is a keyed hash, never the address', async t => {
  const h = harness(t, {env: fileLimiterOff});
  const path = await filePath(110), me = await clientHash(IP);
  for (let i = 0; i < CLIENT_DAILY_DOWNLOADS; i++) assert.equal((await h.file(path)).status, 200, String(i));
  const over = await h.file(path);
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('Retry-After'), String(12 * 60 * 60), 'until midnight UTC');
  assert.equal(over.headers.get('Cache-Control'), 'no-store');
  assert.equal((await over.json()).error.code, 'rate_limited');
  assert.equal(h.downloadCalls(), CLIENT_DAILY_DOWNLOADS, 'nothing downloaded over the cap');
  for (let i = 0; i < 5; i++) assert.equal((await h.file(path)).status, 429);
  // HEAD downloads nothing and is not counted.
  assert.equal((await h.file(path, true)).status, 200);
  // The day's total counts only requests within a client's cap, so one client can't use it up for everyone.
  assert.equal(h.db!.count(TODAY, '*'), CLIENT_DAILY_DOWNLOADS);
  assert.equal(h.db!.count(TODAY, me), CLIENT_DAILY_DOWNLOADS + 1, 'once over, refused from memory without D1');
  assert.deepEqual(h.db!.rows().map(row => row.client).sort(), ['*', me].sort());
  assert.ok(!JSON.stringify(h.db!.rows()).includes('203.0.113'), 'no address in D1');
  // Another network is not limited, and this one starts again the next UTC day.
  assert.equal((await h.file(path, false, from('198.51.100.20'))).status, 200);
  h.clock = Date.parse('2026-10-21T00:00:00.000Z');
  assert.equal((await h.file(path)).status, 200);
  assert.equal(h.db!.count('2026-10-21', me), 1);
  h.checkNoSecrets();
});

test('IPv6 addresses of one /64 share a count and the limits; an IPv4-mapped address is its IPv4 address', async t => {
  const h = harness(t, {env: fileLimiterOff});
  const path = await filePath(110);
  for (let i = 0; i < CLIENT_DAILY_DOWNLOADS; i++) assert.equal((await h.file(path, false, from('2001:db8:1:2:' + (i + 1).toString(16) + '::1'))).status, 200, String(i));
  assert.equal((await h.file(path, false, from('2001:DB8:1:2:FFFF:FFFF:FFFF:FFFF'))).status, 429, 'a new address in the same /64');
  assert.equal((await h.file(path, false, from('2001:db8:1:3::1'))).status, 200, 'the next /64 is another client');
  assert.equal(h.db!.count(TODAY, await clientHash('2001:db8:1:2::/64')), CLIENT_DAILY_DOWNLOADS + 1);
  assert.equal((await h.file(path, false, from('::ffff:203.0.113.77'))).status, 200);
  assert.equal(h.db!.count(TODAY, await clientHash(IP)), 1, 'counted as 203.0.113.77');
  // Without bindings, lookups are limited per /64 too: rotating addresses inside it gains nothing.
  const bare = harness(t);
  for (let i = 0; i < LIMITS.lookup; i++) assert.equal((await bare.trailer('v=1&type=movie&tmdb=603', from('2001:db8:9:9::' + (i + 1).toString(16)))).status, 200, String(i));
  assert.equal((await bare.trailer('v=1&type=movie&tmdb=603', from('2001:db8:9:9:1:2:3:4'))).status, 429);
  assert.equal((await bare.trailer('v=1&type=movie&tmdb=603', from('2001:db8:9:a::1'))).status, 200);
});

test('the /64s of one IPv6 /48 share 240 downloads a UTC day and 12 uncached lookups a minute; other networks are not limited', async t => {
  const h = harness(t, {env: fileLimiterOff});
  const path = await filePath(110);
  // A household's /56 (or a free tunnel's /48) holds many /64s: 25 of them, 12 files each, all within one /48.
  const statuses: Record<number, number> = {};
  for (let net = 0; net < 25; net++) {
    for (let i = 0; i < 12; i++) {
      const status = (await h.file(path, false, from('2001:db8:aa00:' + net.toString(16) + '::' + (i + 1).toString(16)))).status;
      statuses[status] = (statuses[status] || 0) + 1;
    }
  }
  assert.deepEqual(statuses, {200: NETWORK_DAILY_DOWNLOADS, 429: 25 * 12 - NETWORK_DAILY_DOWNLOADS});
  assert.equal(h.downloadCalls(), NETWORK_DAILY_DOWNLOADS, 'nothing downloaded over the /48\'s cap');
  assert.equal(h.db!.count(TODAY, '*'), NETWORK_DAILY_DOWNLOADS, 'the day\'s total counts only requests within both caps');
  assert.equal(h.db!.count(TODAY, await clientHash('2001:db8:aa00::/48')), NETWORK_DAILY_DOWNLOADS + 1, 'once over, refused from memory without D1');
  assert.ok(!JSON.stringify(h.db!.rows()).includes('2001'), 'no address or network in D1');
  const over = await h.file(path, false, from('2001:db8:aa00:ff::1'));
  assert.equal(over.status, 429, 'a new /64 of the same /48');
  assert.equal(over.headers.get('Retry-After'), String(12 * 60 * 60), 'until midnight UTC');
  assert.equal((await over.json()).error.code, 'rate_limited');
  for (const ip of ['2001:db8:aa01::1', '2002:c633:6415::1', '198.51.100.20']) assert.equal((await h.file(path, false, from(ip))).status, 200, ip);
  h.clock = Date.parse('2026-10-21T00:00:00.000Z');
  assert.equal((await h.file(path, false, from('2001:db8:aa00:ff::1'))).status, 200, 'a new UTC day');
  // Uncached lookups: 12 a minute for the whole /48 too, so its /64s can't take every upstream token.
  const m = harness(t);
  for (let i = 0; i < LIMITS.miss; i++) assert.equal((await m.subtitles('v=1&type=movie&tmdb=' + (700 + i), from('2001:db8:cc00:' + i.toString(16) + '::1'))).status, 200, String(i));
  assert.equal((await m.subtitles('v=1&type=movie&tmdb=800', from('2001:db8:cc00:ff::1'))).status, 429, 'a new /64 of the same /48');
  assert.equal((await m.subtitles('v=1&type=movie&tmdb=800', from('2001:db8:cd00::1'))).status, 200, 'another /48');
  assert.equal((await m.subtitles('v=1&type=movie&tmdb=700', from('2001:db8:cc00:ff::1'))).status, 200, 'cached: free');
  assert.equal(m.searches(), LIMITS.miss + 1);
  h.checkNoSecrets();
  m.checkNoSecrets();
});

test('a client or /48 found over its daily cap is answered from the isolate\'s memory until midnight UTC, without D1', async t => {
  const h = harness(t, {env: fileLimiterOff});
  const path = await filePath(110), me = await clientHash(IP);
  const rows = () => h.db!.rows().length;
  for (let i = 0; i < CLIENT_DAILY_DOWNLOADS; i++) assert.equal((await h.file(path)).status, 200, String(i));
  let batches = h.db!.batches;
  assert.equal((await h.file(path)).status, 429, 'over the cap: learned from D1');
  assert.equal(h.db!.batches, ++batches);
  for (let i = 0; i < 20; i++) {
    const over = await h.file(path);
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('Retry-After'), String(12 * 60 * 60), 'until midnight UTC');
    assert.equal((await over.json()).error.code, 'rate_limited');
  }
  assert.equal(h.db!.batches, batches, 'no D1 batch once known');
  assert.equal(h.db!.count(TODAY, me), CLIENT_DAILY_DOWNLOADS + 1);
  assert.equal((await h.file(path, false, from('198.51.100.20'))).status, 200, 'another client');
  batches = h.db!.batches;
  // A /48: its 241st file is refused by D1; then every new /64 of it is answered without D1 and adds no row.
  for (let net = 0; net < 20; net++) {
    for (let i = 0; i < 12; i++) assert.equal((await h.file(path, false, from('2001:db8:aa00:' + net.toString(16) + '::' + (i + 1).toString(16)))).status, 200);
  }
  assert.equal((await h.file(path, false, from('2001:db8:aa00:100::1'))).status, 429);
  batches += 20 * 12 + 1;
  assert.equal(h.db!.batches, batches);
  const before = rows();
  for (let net = 0x200; net < 0x200 + 300; net++) assert.equal((await h.file(path, false, from('2001:db8:aa00:' + net.toString(16) + '::1'))).status, 429);
  assert.equal(h.db!.batches, batches, 'no D1 batch for new /64s of a /48 known to be over');
  assert.equal(rows(), before, 'and no new row');
  assert.equal(h.db!.count(TODAY, await clientHash('2001:db8:aa00::/48')), NETWORK_DAILY_DOWNLOADS + 1);
  assert.equal(h.downloadCalls(), CLIENT_DAILY_DOWNLOADS + 1 + NETWORK_DAILY_DOWNLOADS);
  assert.equal((await h.file(path, false, from('2001:db8:aa01::1'))).status, 200, 'another /48');
  // Another isolate learns it from D1 once.
  h.newIsolate();
  batches = h.db!.batches;
  assert.equal((await h.file(path)).status, 429);
  assert.equal((await h.file(path)).status, 429);
  assert.equal(h.db!.batches, batches + 1);
  // A new UTC day: the memory has expired.
  h.clock = Date.parse('2026-10-21T00:00:00.000Z');
  assert.equal((await h.file(path)).status, 200);
  assert.equal((await h.file(path, false, from('2001:db8:aa00:300::1'))).status, 200);
  h.checkNoSecrets();
});

test('a download OpenSubtitles answered with an error (no link) is taken off every count again; one it may have counted is not', async t => {
  const h = harness(t, {env: fileLimiterOff});
  const path = await filePath(110), me = await clientHash(IP);
  const errors: [string, Handler][] = [
    ['401', () => new Response('no', {status: 401})], ['403', () => new Response('no', {status: 403})],
    ['406 without a quota', () => Response.json({message: 'invalid file_id'}, {status: 406})],
    ['429', () => new Response('slow down', {status: 429})], ['500 twice', () => new Response('oops', {status: 500})],
  ];
  // A wrong key, an outage or their rate limit uses up neither the client's 60 files nor the day's budget.
  for (let i = 0; i <= CLIENT_DAILY_DOWNLOADS; i++) {
    const [name, handler] = errors[i % errors.length];
    h.handlers.download = handler;
    assert.equal((await h.file(path)).status, 503, name);
    assert.equal(h.db!.count(TODAY, me), 0, name);
    assert.equal(h.db!.count(TODAY, '*'), 0, name);
  }
  const download = h.handlers.download = (call: Call) => Response.json({link: `https://www.opensubtitles.com/download/X/${JSON.parse(call.body!).file_id}.srt`, remaining: 50});
  assert.equal((await h.file(path)).status, 200, 'fixed: downloads again at once');
  assert.equal(h.db!.count(TODAY, me), 1);
  // IPv6: the /64's, the /48's and the total row all go back.
  h.handlers.download = errors[0][1];
  assert.equal((await h.file(path, false, from('2001:db8:aa00:1::1'))).status, 503);
  for (const client of [await clientHash('2001:db8:aa00:1::/64'), await clientHash('2001:db8:aa00::/48')]) assert.equal(h.db!.count(TODAY, client), 0);
  assert.equal(h.db!.count(TODAY, '*'), 1);
  // OpenSubtitles may have counted these: a link that then failed, and a /download request that got no answer.
  h.handlers.download = download;
  h.handlers.file = () => new Response('gone', {status: 500});
  assert.equal((await h.file(path)).status, 503, 'the link failed');
  h.handlers.download = hang;
  assert.equal((await h.file(path)).status, 503, 'no answer');
  assert.equal(h.db!.count(TODAY, me), 3);
  assert.equal(h.db!.count(TODAY, '*'), 3);
  // The quota used up (406 with its reset time) is not counted either.
  const q = harness(t, {env: fileLimiterOff});
  q.handlers.download = () => Response.json({remaining: -1, reset_time_utc: '2026-10-21T00:00:00.000Z'}, {status: 406});
  assert.equal((await q.file(path)).status, 503);
  assert.deepEqual(q.db!.rows().map(row => row.count), [0, 0]);
  // Taking a count back fails: the answer is the same, with a fixed log code.
  const f = harness(t, {env: fileLimiterOff});
  f.handlers.download = errors[0][1];
  const prepare = f.db!.prepare.bind(f.db!);
  f.db!.prepare = sql => prepare(sql.startsWith('UPDATE') ? 'SELECT nonsense FROM nowhere' : sql);
  assert.equal((await f.file(path)).status, 503);
  assert.ok(f.logs.includes('lumanest_subtitles_uncount_failed'));
  assert.equal(f.db!.count(TODAY, me), 1);
  for (const x of [h, q, f]) x.checkNoSecrets();
});

test('the day\'s budget: OPENSUBTITLES_DAILY_DOWNLOADS (else 1800); used up, 503 until midnight UTC; a warning past 80%', async t => {
  const h = harness(t, {env: {...fileLimiterOff, OPENSUBTITLES_DAILY_DOWNLOADS: '10'}});
  const path = await filePath(110);
  const lowLogs = () => h.logs.filter(line => line === 'lumanest_subtitles_budget_low').length;
  for (let i = 1; i <= 10; i++) {
    assert.equal((await h.file(path, false, from('198.51.100.' + i))).status, 200, String(i));
    assert.equal(lowLogs(), i > 10 * BUDGET_LOW_SHARE ? 1 : 0, 'logged once, when the count passes 80%: ' + i);
  }
  for (const ip of ['198.51.100.50', '198.51.100.51', '198.51.100.1']) {
    const batches = h.db!.batches;
    const over = await h.file(path, false, from(ip));
    assert.equal(over.status, 503);
    assert.equal(over.headers.get('Retry-After'), String(12 * 60 * 60));
    assert.equal((await over.json()).error.code, 'unavailable');
    // The first refusal is learnt from D1; after it, this isolate refuses without a D1 batch.
    assert.equal(h.db!.batches - batches, ip === '198.51.100.50' ? 1 : 0, ip);
  }
  assert.equal(h.downloadCalls(), 10);
  assert.deepEqual(h.logs.filter(line => line === 'lumanest_subtitles_budget_used_up'), ['lumanest_subtitles_budget_used_up'], 'once a day');
  // Lookups offer no track this isolate knows can't be served (another isolate learns it from its first refused file).
  const searches = h.searches();
  const lookup = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(lookup.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await lookup.json(), {v: 1, status: 'unavailable', tmdb: 603, tracks: [], credit: CREDIT});
  assert.equal(h.searches(), searches);
  // A new UTC day: downloads again, and lookups offer tracks.
  h.clock = Date.parse('2026-10-21T06:00:00.000Z');
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=603')).json()).status, 'ok');
  assert.equal((await h.file(path)).status, 200);
  h.checkNoSecrets();
  // Unset or not a positive whole number: 1800.
  for (const value of [undefined, '', '0', '-5', '1e3', '12.5', 'lots', 0, 2.5]) {
    const d = harness(t, {env: {...fileLimiterOff, OPENSUBTITLES_DAILY_DOWNLOADS: value}});
    d.db!.sqlite.prepare("INSERT INTO extras_download_counts VALUES (?, '*', ?)").run(TODAY, DAILY_DOWNLOADS - 1);
    assert.equal((await d.file(path)).status, 200, String(value));
    assert.equal((await d.file(path)).status, 503, String(value));
  }
  const number = harness(t, {env: {...fileLimiterOff, OPENSUBTITLES_DAILY_DOWNLOADS: 2}});
  for (const status of [200, 200, 503]) assert.equal((await number.file(path)).status, status);
});

test('when D1 fails or is missing, nothing is downloaded: 503 with a short Retry-After and a fixed log code', async t => {
  const path = await filePath(110);
  const check = async (h: ReturnType<typeof harness>) => {
    const answer = await h.file(path);
    assert.equal(answer.status, 503);
    assert.equal(answer.headers.get('Retry-After'), String(COUNT_RETRY_S));
    assert.equal((await answer.json()).error.code, 'unavailable');
    assert.equal(h.downloadCalls(), 0);
    assert.deepEqual(h.logs, ['lumanest_subtitles_count_failed']);
    h.checkNoSecrets();
  };
  for (const failing of ['throw', 'shape'] as const) {
    const h = harness(t);
    h.db!.failing = failing;
    await check(h);
  }
  await check(harness(t, {db: null}));
  const odd = harness(t);
  odd.db!.batch = async () => [{results: [{count: 'one'}]}, {results: [{count: 1}]}];
  await check(odd);
  const short = harness(t);
  short.db!.batch = async () => [{results: [{count: 1}]}];
  await check(short);
  // HEAD needs no count.
  const head = harness(t, {db: null});
  assert.equal((await head.file(path, true)).status, 200);
});

test('counts older than yesterday are deleted at most once an hour per isolate, after the answer', async t => {
  const jobs: Promise<unknown>[] = [];
  const h = harness(t, {waitUntil: job => {jobs.push(job);}});
  const path = await filePath(110);
  h.db!.sqlite.exec("INSERT INTO extras_download_counts VALUES ('2026-10-18','*',5),('2026-10-18','x',2),('2026-10-19','*',7),('2026-10-19','x',1)");
  const deletes = () => h.db!.statements.filter(sql => sql.startsWith('DELETE')).length;
  assert.equal((await h.file(path)).status, 200);
  await Promise.all(jobs);
  assert.equal(deletes(), 1);
  assert.deepEqual(h.db!.rows().map(row => row.day), ['2026-10-19', '2026-10-19', TODAY, TODAY], 'yesterday stays');
  h.clock += PURGE_EVERY_MS - 1;
  await h.file(path);
  await Promise.all(jobs);
  assert.equal(deletes(), 1, 'not again within the hour');
  h.clock += 1;
  await h.file(path);
  await Promise.all(jobs);
  assert.equal(deletes(), 2);
  // A new isolate deletes again; a failing delete changes no answer and logs a fixed code.
  h.newIsolate();
  const prepare = h.db!.prepare.bind(h.db!);
  h.db!.prepare = sql => sql.startsWith('DELETE') ? {bind() {return this;}, run: async () => {throw new Error('busy');}} : prepare(sql);
  assert.equal((await h.file(path)).status, 200);
  await Promise.all(jobs);
  assert.ok(h.logs.includes('lumanest_subtitles_count_cleanup_failed'));
  h.checkNoSecrets();
});

// ------------------------------------------------------------------ upstream limits

test('every search and TMDB request a cache miss makes takes a token per service: refused, a stale copy or 503, never a cached "none"', async t => {
  let refuse = '';
  const keys: string[] = [];
  const h = harness(t, {env: {EXTRAS_LIMITER: {limit: async ({key}) => {keys.push(key); return {success: key !== refuse};}}}});
  refuse = 'upstream:opensubtitles';
  const refused = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('Retry-After'), '300');
  assert.equal(h.searches(), 0);
  assert.equal(h.bucket!.objects.size, 0, 'nothing cached');
  assert.deepEqual(h.logs, ['lumanest_extras_upstream_limited']);
  refuse = 'upstream:tmdb';
  assert.equal((await h.trailer('v=1&type=movie&tmdb=603')).status, 503);
  assert.equal((await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999')).status, 503);
  assert.equal(h.tmdbCalls(), 0);
  assert.equal(h.bucket!.objects.size, 0);
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=603')).json()).status, 'ok', 'OpenSubtitles has its own tokens');
  refuse = 'upstream:opensubtitles';
  h.clock += 31 * DAY;
  const stale = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await stale.json()).tracks.length, 3);
  assert.equal(h.searches(), 1);
  assert.deepEqual(keys.filter(key => key.startsWith('upstream:')), ['upstream:opensubtitles', 'upstream:tmdb', 'upstream:tmdb', 'upstream:opensubtitles', 'upstream:opensubtitles']);
  h.checkNoSecrets();
});

test('without bindings, each isolate allows 120 upstream searches a minute across all clients', async t => {
  // The limits the bindings are created with (scripts/prepare-cloudflare.mjs): the isolate windows use the same.
  assert.deepEqual(LIMITS, {lookup: 120, file: 12, miss: 12, upstream: 120});
  const h = harness(t);
  let n = 0;
  for (let client = 1; n < LIMITS.upstream; client++) {
    for (let i = 0; i < LIMITS.miss && n < LIMITS.upstream; i++, n++) {
      assert.equal((await h.subtitles('v=1&type=movie&tmdb=' + (1000 + n), from('198.51.100.' + client))).status, 200, String(n));
    }
  }
  assert.equal(h.searches(), LIMITS.upstream);
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=5000', from('192.0.2.200'))).status, 503);
  assert.equal(h.searches(), LIMITS.upstream);
  h.clock += 60 * 1000;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=5000', from('192.0.2.200'))).status, 200);
});

test('a client gets 12 uncached lookups a minute; cached lookups, a refresh already running and other clients are not limited', async t => {
  const h = harness(t);
  for (let i = 0; i < LIMITS.miss; i++) assert.equal((await h.subtitles('v=1&type=movie&tmdb=' + (700 + i))).status, 200, String(i));
  const over = await h.subtitles('v=1&type=movie&tmdb=800');
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('Retry-After'), '60');
  assert.equal((await over.json()).error.code, 'rate_limited');
  assert.equal(h.searches(), LIMITS.miss);
  assert.equal((await h.trailer('v=1&type=movie&tmdb=603')).status, 429, 'trailers too');
  assert.equal((await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999')).status, 429, 'and names');
  assert.equal(h.tmdbCalls(), 0);
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=700')).status, 200, 'cached: free');
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=800', from('198.51.100.7'))).status, 200, 'another client');
  // A refresh another client started: joining it costs nothing.
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const search = h.handlers.search;
  h.handlers.search = async (call, signal) => {await gate; return search(call, signal);};
  const first = h.subtitles('v=1&type=movie&tmdb=900', from('198.51.100.8'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const joined = h.subtitles('v=1&type=movie&tmdb=900');
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  assert.equal((await first).status, 200);
  assert.equal((await joined).status, 200);
  h.handlers.search = search;
  h.clock += 60 * 1000;
  assert.equal((await h.subtitles('v=1&type=movie&tmdb=801')).status, 200, 'a new minute');
  h.checkNoSecrets();
});

test('over its uncached-lookup limit, a client gets an expired copy under 90 days old as a stale answer; only a title without one is 429', async t => {
  const h = harness(t);
  assert.equal((await (await h.subtitles('v=1&type=movie&tmdb=603')).json()).status, 'ok');
  assert.equal((await (await h.trailer('v=1&type=movie&tmdb=603')).json()).status, 'ok');
  assert.equal((await (await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999')).json()).tmdb, 603);
  // A month later every one of these objects has expired; a copy stored 100 days ago is too old to serve.
  h.clock += 31 * DAY;
  h.bucket!.objects.set('extras/v1/subtitles/movie/550/en.json', JSON.stringify({
    v: 1, stored: new Date(h.clock - 100 * DAY).toISOString(), expires: new Date(h.clock - 70 * DAY).toISOString(), files: [{file_id: 201, hi: false}],
  }));
  for (let i = 0; i < LIMITS.miss; i++) assert.equal((await h.subtitles('v=1&type=movie&tmdb=' + (700 + i))).status, 200, String(i));
  const searches = h.searches(), tmdb = h.tmdbCalls(), puts = h.bucket!.puts.length;
  const subtitles = await h.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(subtitles.status, 200);
  assert.equal(subtitles.headers.get('Cache-Control'), 'public, max-age=300');
  const body = await subtitles.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.tracks.length, 3);
  const trailer = await h.trailer('v=1&type=movie&tmdb=603');
  assert.equal(trailer.status, 200);
  assert.equal(trailer.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await trailer.json()).trailer.key, 'vKQi3bBA1y8');
  const named = await h.subtitles('v=1&type=movie&name=The+Matrix&year=1999');
  assert.equal(named.status, 200);
  assert.equal(named.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await named.json()).tmdb, 603);
  assert.equal(h.searches(), searches, 'no refresh over the limit');
  assert.equal(h.tmdbCalls(), tmdb);
  assert.equal(h.bucket!.puts.length, puts);
  for (const query of ['tmdb=800', 'tmdb=550']) {
    const over = await h.subtitles('v=1&type=movie&' + query);
    assert.equal(over.status, 429, query);
    assert.equal(over.headers.get('Retry-After'), '60');
  }
  // A client within its limit refreshes the object.
  const fresh = await h.subtitles('v=1&type=movie&tmdb=603', from('198.51.100.7'));
  assert.equal(fresh.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(h.searches(), searches + 1);
  h.checkNoSecrets();
});

test('without bindings, a full window table drops its oldest entries, never every count', async t => {
  const h = harness(t);
  const path = await filePath(110);
  const ip = (i: number) => '10.' + ((i >> 16) & 255) + '.' + ((i >> 8) & 255) + '.' + (i & 255);
  for (let i = 0; i < MEMORY_MAX - 1; i++) await h.file(path, true, from(ip(i)));
  for (let i = 0; i < LIMITS.lookup; i++) assert.equal((await h.file(path, true)).status, 200);
  assert.equal((await h.file(path, true)).status, 429);
  // A new network fills the table: the oldest window goes, this client's count stays.
  await h.file(path, true, from(ip(MEMORY_MAX)));
  assert.equal((await h.file(path, true)).status, 429);
  await h.file(path, true, from(ip(MEMORY_MAX + 1)));
  assert.equal((await h.file(path, true)).status, 429);
});

// ------------------------------------------------------------------ OpenSubtitles credentials

test('Api-Key and the login token go only to the API hosts: never to the download link or to another host after a redirect', async t => {
  const h = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: OS_PASSWORD}});
  assert.equal((await h.file(await filePath(110))).status, 200);
  const download = h.calls.find(call => call.url.pathname === '/api/v1/download')!;
  assert.equal(download.headers.get('Api-Key'), OS_KEY);
  assert.equal(download.headers.get('Authorization'), 'Bearer ' + OS_TOKEN);
  const link = h.calls.find(call => call.url.hostname === 'www.opensubtitles.com')!;
  assert.equal(link.headers.get('Api-Key'), null);
  assert.equal(link.headers.get('Authorization'), null);
  assert.equal(link.headers.get('User-Agent'), 'LumaNest TV v1.0');
  // A link on an API host, and the link's redirects, get no key either.
  h.handlers.download = () => Response.json({link: 'https://vip-api.opensubtitles.com/download/x.srt', remaining: 5});
  h.handlers.file = call => call.url.hostname === 'vip-api.opensubtitles.com' ? new Response(null, {status: 302, headers: {Location: 'https://api.opensubtitles.com/download/y.srt'}}) : new Response(SRT);
  const before = h.calls.length;
  assert.equal((await h.file(await filePath(110))).status, 200);
  const fetched = h.calls.slice(before).filter(call => call.url.pathname.startsWith('/download/'));
  assert.deepEqual(fetched.map(call => call.url.hostname), ['vip-api.opensubtitles.com', 'api.opensubtitles.com']);
  for (const call of fetched) assert.equal(call.headers.get('Api-Key') ?? call.headers.get('Authorization'), null, call.url.href);
  // An API request redirected to another opensubtitles.com host goes there without the key.
  h.handlers.search = () => new Response(null, {status: 302, headers: {Location: 'https://www.opensubtitles.com/api/v1/subtitles?x=1'}});
  h.bucket!.objects.clear();
  await h.subtitles('v=1&type=movie&tmdb=604');
  const moved = h.calls.find(call => call.url.hostname === 'www.opensubtitles.com' && call.url.pathname === '/api/v1/subtitles')!;
  assert.equal(moved.headers.get('Api-Key'), null);
  assert.equal(moved.headers.get('Authorization'), null);
  h.checkNoSecrets();
});

test('an older plain SHA-256 of refused secrets is ignored (one more login); the keyed one stops logins', async t => {
  const state = (rejected: string) => JSON.stringify({v: 1, stored: '2026-10-20T00:00:00.000Z', quotaUntil: null, login: null, lastLoginAttempt: null, rejected});
  const old = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: OS_PASSWORD}});
  old.bucket!.objects.set('extras/v1/state/opensubtitles.json', state(sha256(OS_USER + '\n' + OS_PASSWORD)));
  assert.equal((await old.file(await filePath(110))).status, 200);
  assert.equal(old.state.logins, 1);
  assert.equal(old.bucket!.json('extras/v1/state/opensubtitles.json').rejected, null, 'the old hash is dropped, not kept');
  const keyed = harness(t, {env: {OPENSUBTITLES_USERNAME: OS_USER, OPENSUBTITLES_PASSWORD: OS_PASSWORD}});
  keyed.bucket!.objects.set('extras/v1/state/opensubtitles.json', state(await mac('extras-cred-v1\n' + OS_USER + '\n' + OS_PASSWORD, PLAYER_KEY, 'extras-credential')));
  assert.equal((await keyed.file(await filePath(110))).status, 200);
  assert.equal(keyed.state.logins, 0);
  // Under another PLAYER_COOKIE_KEY the same secrets give another value: nothing to compare across sites.
  assert.notEqual(await mac('extras-cred-v1\n' + OS_USER + '\n' + OS_PASSWORD, 'd'.repeat(64), 'extras-credential'),
    await mac('extras-cred-v1\n' + OS_USER + '\n' + OS_PASSWORD, PLAYER_KEY, 'extras-credential'));
});
