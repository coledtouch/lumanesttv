// The web player's Movies & Series endpoints (lib/player-vod.ts) in workerd, with the real Workers Cache API and D1,
// and the provider and poster hosts replaced by an outbound double that counts every request it gets. Relay requests
// go through the real stream relay (cloudflare/lumanest-stream-relay.mjs) over a fake socket to the same double, so
// they pass only what the deployed relay passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';
import {createStreamRelay} from '../cloudflare/lumanest-stream-relay.mjs';

const KEY = 'a'.repeat(64), RELAY_KEY = 'b'.repeat(64);
const LOGINS = {
  'runtime-private-user': 'runtime-secret-password', 'other-user': 'other-password', 'huge-user': 'huge-password', 'slow-user': 'slow-password',
  'flaky-user': 'flaky-password', 'm3u-user': 'm3u-password', 'image-user': 'image-password', 'down-user': 'down-password', 'big-user': 'big-password',
  'waiting-user': 'waiting-password', 'slow-two': 'slow-two-password', 'workersdev-user': 'workersdev-password',
};
const SECRETS = ['runtime-private-user', 'runtime-secret-password', '136.148.65.', '/movie/', 'player_api', 'tv.lumanest.tv/posters', 'streams.lumanest.tv', RELAY_KEY];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

// ---------------------------------------------------------------- the provider double
const calls = [];
const state = {failing: false, down: false};
const count = (filter) => calls.filter(filter).length;
const apiCalls = (user, action) => count(call => call.path === '/player_api.php' && (!user || call.user === user) && (!action || call.action === action));
const posterCalls = (path) => count(call => call.path === path);

const categories = (kind) => kind === 'movie'
  ? [{category_id: '1', category_name: 'US | Action Movies', parent_id: 0}, {category_id: '2', category_name: 'FR | Films', parent_id: 0}, {category_id: '3', category_name: 'XXX', is_adult: 1}]
  : [{category_id: '5', category_name: 'NETFLIX SERIES', parent_id: 0}];
const movies = () => [
  {num: 1, stream_id: 123, name: 'Dune (2021)', category_id: '1', stream_icon: 'http://136.148.65.10/posters/p1.jpg', container_extension: 'mp4', added: '1700000000', rating: '8.1', tmdb: '438631', direct_source: 'http://136.148.65.10/movie/runtime-private-user/runtime-secret-password/123.mp4', custom_sid: 'x'},
  {num: 2, stream_id: 124, name: 'Le Film', category_id: '2', stream_icon: 'https://tv.lumanest.tv/posters/p2.jpg', container_extension: 'mkv', added: '1700000100'},
  {num: 3, stream_id: 125, name: 'Glass Onion', category_id: '1', stream_icon: 'https://image.tmdb.org/t/p/w600/g.jpg', container_extension: 'mp4'},
  {num: 4, stream_id: 126, name: 'Hot', category_id: '3', stream_icon: 'http://other.example/p.jpg', is_adult: '1'},
  {num: 5, name: 'No id'},
];
const series = () => [{num: 1, series_id: 9, name: 'Show', category_id: '5', cover: 'http://136.148.65.10/posters/s9.jpg', last_modified: '1700000500', rating: '7.5'}];
const seriesInfo = {
  info: {name: 'Show', plot: 'A plot', cover: 'http://136.148.65.10/posters/s9.jpg', genre: 'Drama', releaseDate: '2019-01-01'},
  episodes: {'1': [{id: '456', episode_num: 1, title: 'Pilot', container_extension: 'mkv'}, {id: '457', episode_num: 2, title: 'Two', container_extension: 'mp4', info: {duration_secs: 2700}}]},
};
const movieInfo = {info: {plot: 'Spice', duration_secs: 9000, genre: 'Science Fiction', director: 'D. V.', releasedate: '2021-10-22'}, movie_data: {stream_id: 123}};
const MEDIA = new TextEncoder().encode('0123456789'.repeat(100));

function chunked(chunks, delay = 0) {
  let i = 0, timer;
  return new ReadableStream({
    async pull(controller) {
      if (delay) await new Promise(resolve => {timer = setTimeout(resolve, delay);});
      if (i >= chunks.length) {controller.close(); return;}
      controller.enqueue(new TextEncoder().encode(chunks[i++]));
    },
    cancel() {clearTimeout(timer); i = chunks.length;},
  });
}

function provider(url, headers = new Headers()) {
  const call = {host: url.host, path: url.pathname, user: url.searchParams.get('username'), action: url.searchParams.get('action')};
  calls.push(call);
  if (url.pathname === '/m3u') {
    const user = url.searchParams.get('u');
    if (LOGINS[user] !== url.searchParams.get('p')) return new Response('no', {status: 401});
    const base = `https://tv.lumanest.tv/live/${user}/${LOGINS[user]}`;
    let text = `#EXTM3U\n#EXTINF:-1 group-title="News",News\n${base}/1.m3u8\n#EXTINF:-1 group-title="Sports",Sports\n${base}/2.ts\n`;
    if (user === 'm3u-user') text += `#EXTINF:-1 tvg-logo="http://136.148.65.10/posters/m1.jpg" group-title="VOD Movies",Heat (1995)\nhttps://tv.lumanest.tv/movie/${user}/${LOGINS[user]}/77.mkv\n` +
      `#EXTINF:-1 tvg-logo="https://tv.lumanest.tv/posters/m2.jpg" group-title="VOD Movies",Up (2009)\nhttps://tv.lumanest.tv/movie/${user}/${LOGINS[user]}/78.mp4\n` +
      `#EXTINF:-1 tvg-logo="https://image.tmdb.org/t/p/w600/x.jpg" group-title="VOD Series",Show S01E01\nhttps://tv.lumanest.tv/series/${user}/${LOGINS[user]}/88.mp4\n`;
    return new Response(text, {headers: {'Content-Type': 'audio/x-mpegurl'}});
  }
  if (url.pathname === '/player_api.php') {
    const user = call.user;
    if (LOGINS[user] !== url.searchParams.get('password')) return Response.json({user_info: {auth: 0}});
    if (user === 'flaky-user' && state.failing) return new Response('down', {status: 503});
    if (user === 'down-user' && state.down) return new Response('down', {status: 502});
    const action = call.action;
    if (action === 'get_vod_streams' && user === 'huge-user') {
      // About 60 MB of titles, made as it is read.
      const item = JSON.stringify({stream_id: 1, name: 'x'.repeat(1400), stream_icon: 'https://image.tmdb.org/t/p/w600/a.jpg'});
      let sent = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (sent === 0) controller.enqueue(new TextEncoder().encode('['));
          controller.enqueue(new TextEncoder().encode((item + ',').repeat(64)));
          if (++sent > 1000) controller.close();
        },
      }), {headers: {'Content-Type': 'application/json'}});
    }
    // Slower than the build deadline the test sets (1.5 s); it ends after 4 s, as the mock can't see the Worker give up.
    if (action === 'get_vod_streams' && user.startsWith('slow-')) return new Response(chunked(['[', ...Array.from({length: 80}, (_, i) => JSON.stringify({stream_id: i}) + ',')], 50), {headers: {'Content-Type': 'application/json'}});
    // About 560 KB of compact titles (names are cut at 150 characters).
    if (action === 'get_vod_streams' && user === 'big-user') return Response.json(Array.from({length: 3000}, (_, i) => ({stream_id: i + 1, name: 'Title ' + i + ' ' + 'x'.repeat(1000)})));
    if (action === 'get_vod_categories') return Response.json(categories('movie'));
    if (action === 'get_series_categories') return Response.json(categories('series'));
    // Split into small chunks, so the list is read as a stream.
    if (action === 'get_vod_streams') return new Response(chunked(JSON.stringify(movies()).match(/.{1,37}/gs)), {headers: {'Content-Type': 'application/json'}});
    if (action === 'get_series') return Response.json(series());
    if (action === 'get_series_info') return url.searchParams.get('series_id') === '9' ? Response.json(seriesInfo) : Response.json({info: {}, episodes: {}});
    if (action === 'get_vod_info') return Response.json(movieInfo);
    return new Response('unknown action', {status: 400});
  }
  if (url.pathname.startsWith('/posters/')) {
    if (url.pathname.endsWith('.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {headers: {'Content-Type': 'image/svg+xml'}});
    if (url.pathname.endsWith('page.jpg')) return new Response('<!doctype html><title>x</title>', {headers: {'Content-Type': 'image/jpeg'}});
    if (url.pathname.endsWith('big.jpg')) return new Response(new Uint8Array(3 * 1024 * 1024).fill(0xff), {headers: {'Content-Type': 'image/jpeg'}});
    if (url.pathname.endsWith('gone.jpg')) return new Response('gone', {status: 404});
    if (url.pathname.endsWith('down.jpg')) return new Response('down', {status: 503});
    if (url.pathname.endsWith('reset.jpg')) throw new Error('connection reset');
    return new Response(JPEG, {headers: {'Content-Type': 'image/jpeg'}});
  }
  const media = /^\/(movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(\w+)$/.exec(url.pathname);
  if (media && LOGINS[decodeURIComponent(media[2])] === decodeURIComponent(media[3])) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get('Range') || '');
    if (range) {
      const from = Number(range[1]), to = range[2] ? Number(range[2]) : MEDIA.length - 1;
      return new Response(MEDIA.slice(from, to + 1), {status: 206, headers: {'Content-Type': 'video/mp4', 'Content-Range': `bytes ${from}-${to}/${MEDIA.length}`, 'Accept-Ranges': 'bytes'}});
    }
    return new Response(MEDIA, {headers: {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes'}});
  }
  return new Response('not found', {status: 404});
}

// ---------------------------------------------------------------- the real relay, over a fake socket to the double
async function rawHttp(response) {
  const body = new Uint8Array(await response.arrayBuffer());
  let head = `HTTP/1.1 ${response.status} X\r\n`;
  response.headers.forEach((value, name) => {if (!['content-length', 'transfer-encoding'].includes(name)) head += `${name}: ${value}\r\n`;});
  head = new TextEncoder().encode(head + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head); bytes.set(body, head.length);
  return bytes;
}
const relay = createStreamRelay(({hostname}) => {
  let received = '', answer;
  const asked = new Promise(resolve => {answer = resolve;});
  return {
    opened: Promise.resolve(), closed: Promise.resolve(), close() {},
    writable: new WritableStream({write(chunk) {received += new TextDecoder().decode(chunk); if (received.includes('\r\n\r\n')) answer(received);}}),
    readable: new ReadableStream({async start(controller) {
      const [line, ...fields] = (await asked).split('\r\n');
      const range = fields.find(field => /^range:/i.test(field))?.slice(6).trim();
      const inner = new URL('http://' + hostname + line.split(' ')[1]);
      calls.push({host: 'relay', path: inner.pathname});
      let response;
      try {response = await provider(inner, new Headers(range ? {Range: range} : {}));} catch {controller.error(new Error('reset')); return;}
      controller.enqueue(await rawHttp(response));
      controller.close();
    }}),
  };
});

async function outbound(request) {
  const url = new URL(request.url);
  if (url.origin === 'https://streams.lumanest.tv') return relay.fetch(request, {STREAM_RELAY_KEY: RELAY_KEY, STREAM_RELAY_ALLOWED_HOSTS: '136.148.65.0/24'});
  if (!['tv.lumanest.tv', 'image.tmdb.org'].includes(url.hostname)) {calls.push({host: url.host, path: url.pathname, blocked: true}); return new Response('unexpected host', {status: 599});}
  return provider(url, request.headers);
}

test('the relay double passes only what the real relay passes: media, never JSON or images', async () => {
  const ask = path => relay.fetch(new Request('https://streams.lumanest.tv/relay', {method: 'POST', headers: {Authorization: 'Bearer ' + RELAY_KEY, 'Content-Type': 'application/json'}, body: JSON.stringify({url: 'http://136.148.65.10' + path})}), {STREAM_RELAY_KEY: RELAY_KEY, STREAM_RELAY_ALLOWED_HOSTS: '136.148.65.0/24'});
  const media = await ask('/movie/m3u-user/m3u-password/123.mp4');
  assert.equal(media.status, 200);
  assert.equal((await media.arrayBuffer()).byteLength, 1000);
  for (const path of ['/posters/p1.jpg', '/player_api.php?username=relay-check&password=x&action=get_vod_streams', '/posters/gone.jpg']) {
    const response = await ask(path);
    assert.equal(response.status, 502, path);
    await response.body?.cancel();
  }
});

// ---------------------------------------------------------------- the site worker
let runtime;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {GET as vodGET} from './app/api/player/vod/route.ts';
        import {GET as seriesGET} from './app/api/player/vod/series/route.ts';
        import {GET as movieGET} from './app/api/player/vod/movie/route.ts';
        import {POST as playPOST} from './app/api/player/vod/play/route.ts';
        import {GET as imageGET} from './app/api/player/image/route.ts';
        import {GET as channelsGET} from './app/api/player/channels/route.ts';
        import {GET as streamGET} from './app/api/player/stream/route.ts';
        import {POST as castPOST} from './app/api/player/cast/route.ts';
        import {POST as logoutPOST} from './app/api/player/logout/route.ts';
        import {GET as diagnosticsGET} from './app/api/player/diagnostics/route.ts';
        import {seal, open} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {VOD_TIMING} from './lib/player-vod.ts';
        import {VOD_LIMITS} from './lib/player-vod-data.ts';
        import {env} from 'cloudflare:workers';
        const LOGINS = ${JSON.stringify(LOGINS)};
        const logged = [];
        for (const level of ['log', 'warn', 'error']) console[level] = (...args) => {logged.push(args.join(' '));};
        const sessions = {};
        export default {async fetch(request) {
          globalThis.__testHeaders = request.headers;
          const headers = new Headers(request.headers);
          const kind = headers.get('test-player-session');
          if (kind) {
            const [user, variant] = kind.split('#');
            sessions[kind] ||= await seal({username: user, password: LOGINS[user], exp: Date.now() + 3600000, sid: crypto.randomUUID()}, env.PLAYER_COOKIE_KEY, 'player-session');
            headers.set('Cookie', PLAYER_COOKIE + '=' + sessions[kind]);
          }
          if (headers.get('test-same-origin')) headers.set('Origin', new URL(request.url).origin);
          const url = new URL(request.url), pathname = url.pathname;
          const req = new Request(request, {headers});
          if (pathname === '/test/logs') return Response.json(logged.splice(0));
          if (pathname === '/test/timing') {for (const [name, value] of url.searchParams) VOD_TIMING[name] = Number(value); return Response.json({ok: true});}
          if (pathname === '/test/limits') {for (const [name, value] of url.searchParams) VOD_LIMITS[name] = Number(value); return Response.json({ok: true});}
          // Moves this isolate's catalogue clock, as if time had passed.
          if (pathname === '/test/clock') {const offset = Number(url.searchParams.get('offset')); VOD_TIMING.now = () => Date.now() + offset; return Response.json({ok: true});}
          // Re-seals an image token with another expiry or line, as if made long ago or for someone else.
          if (pathname === '/test/reseal-image') {
            const item = await open(url.searchParams.get('t'), env.PLAYER_COOKIE_KEY, 'player-image');
            if (url.searchParams.has('exp')) item.exp = Number(url.searchParams.get('exp'));
            if (url.searchParams.has('l')) item.l = url.searchParams.get('l');
            if (url.searchParams.has('u')) item.u = url.searchParams.get('u');
            return Response.json({t: await seal(item, env.PLAYER_COOKIE_KEY, 'player-image')});
          }
          if (pathname === '/api/player/vod') return vodGET(req);
          if (pathname === '/api/player/vod/series') return seriesGET(req);
          if (pathname === '/api/player/vod/movie') return movieGET(req);
          if (pathname === '/api/player/vod/play') return playPOST(req);
          if (pathname === '/api/player/image') return imageGET(req);
          if (pathname === '/api/player/channels') return channelsGET(req);
          if (pathname === '/api/player/stream') return streamGET(req);
          if (pathname === '/api/player/cast') return castPOST(req);
          if (pathname === '/api/player/logout') return logoutPOST(req);
          if (pathname === '/api/player/diagnostics') return diagnosticsGET(req);
          return new Response('not found', {status: 404});
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'player-vod-runtime-worker.ts', loader: 'ts',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name: 'mock-framework-request-context', setup(builder) {
      builder.onResolve({filter: /^next\/(headers|navigation)$/}, args => ({path: args.path, namespace: 'mock-framework'}));
      builder.onLoad({filter: /.*/, namespace: 'mock-framework'}, args => ({contents: args.path.endsWith('/headers') ? 'export async function headers(){return globalThis.__testHeaders || new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}', loader: 'js'}));
    }}],
  });
  const base = {ADMIN_USER_ID: 'runtime-owner', PLAYER_COOKIE_KEY: KEY, CUSTOMER_PORTAL_URL: 'https://tv.lumanest.tv', PLAYER_ALLOWED_HOSTS: 'tv.lumanest.tv', PLAYER_ALLOWED_HTTP_HOSTS: 'tv.lumanest.tv'};
  const relaySettings = {PLAYER_STREAM_RELAY_URL: 'https://streams.lumanest.tv/relay', PLAYER_STREAM_RELAY_KEY: RELAY_KEY, STREAM_RELAY_ALLOWED_HOSTS: '136.148.65.0/24'};
  const worker = (name, bindings) => ({
    name, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'enable_request_signal'], modules: true, script: bundle.outputFiles[0].text,
    scriptPath: fileURLToPath(new URL('../player-vod-runtime-worker.js', import.meta.url)), d1Databases: {DB: 'vod-' + name}, bindings: {...base, ...bindings}, outboundService: outbound,
  });
  runtime = new Miniflare({workers: [
    worker('vod-xtream', {...relaySettings, TV_APP_XTREAM_SERVER: 'https://tv.lumanest.tv'}),
    worker('vod-none', {}),
    worker('vod-unapproved', {...relaySettings, TV_APP_XTREAM_SERVER: 'https://evil.example'}),
    worker('vod-relay-ip', {...relaySettings, TV_APP_XTREAM_SERVER: 'http://136.148.65.50/'}),
    worker('vod-http', {...relaySettings, TV_APP_XTREAM_SERVER: 'http://tv.lumanest.tv'}),
  ]});
  const migrations = [];
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) migrations.push(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  for (const name of ['vod-xtream', 'vod-none', 'vod-unapproved', 'vod-relay-ip', 'vod-http']) {
    const database = await runtime.getD1Database('DB', name);
    for (const migration of migrations) await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
});
test.after(async () => {await runtime?.dispose();});

async function call(workerName, path, {session, body, method = body === undefined ? 'GET' : 'POST', headers = {}} = {}) {
  const worker = await runtime.getWorker(workerName);
  const response = await worker.fetch('https://lumanest.tv' + path, {method, body, headers: {...(session ? {'test-player-session': session} : {}), ...(body ? {'Content-Type': 'application/json', 'test-same-origin': '1'} : {}), ...headers}});
  const type = response.headers.get('Content-Type') || '';
  const data = type.startsWith('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return {status: response.status, headers: response.headers, data};
}
const timing = (worker, values) => call(worker, '/test/timing?' + new URLSearchParams(values));
const settle = () => new Promise(resolve => setTimeout(resolve, 300));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {if (await check()) return true; await new Promise(resolve => setTimeout(resolve, 100));}
  return false;
}
function posterSrc(poster, bases) {
  const match = /^~(\d+):(.*)$/.exec(poster);
  return match ? '/api/player/image?t=' + encodeURIComponent(bases[Number(match[1])]) + '&f=' + encodeURIComponent(match[2]) : poster;
}

// ---------------------------------------------------------------- tests

test('every endpoint needs a player session', async () => {
  for (const path of ['/api/player/vod?v=1', '/api/player/vod/series?id=9', '/api/player/vod/movie?id=123', '/api/player/image?t=x']) {
    const response = await call('vod-xtream', path);
    assert.equal(response.status, 401, path);
    assert.equal(response.data.error.code, 'player_login_required');
  }
  assert.equal((await call('vod-xtream', '/api/player/vod/play', {body: JSON.stringify({type: 'movie', id: '123', ext: 'mp4'})})).status, 401);
  assert.equal((await call('vod-xtream', '/api/player/vod?v=2', {session: 'runtime-private-user'})).status, 400);
});

test('without an approved Xtream server the catalogue is "none" and nothing is fetched', async () => {
  const before = apiCalls(), relayed = count(call => call.host === 'relay');
  for (const [name, reason] of [['vod-none', 'not_configured'], ['vod-unapproved', 'server_not_approved'], ['vod-relay-ip', 'server_on_relay']]) {
    const {status, data, headers} = await call(name, '/api/player/vod?v=1', {session: 'runtime-private-user'});
    assert.equal(status, 200);
    assert.deepEqual([data.v, data.source, data.reason, data.movies.items, data.series.items], [1, 'none', reason, [], []]);
    assert.equal(headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await call(name, '/api/player/vod/series?id=9', {session: 'runtime-private-user'})).status, 404);
    assert.equal((await call(name, '/api/player/vod/play', {session: 'runtime-private-user', body: JSON.stringify({type: 'movie', id: '123', ext: 'mp4'})})).status, 404);
  }
  assert.equal(apiCalls(), before);
  assert.equal(count(call => call.host === 'evil.example'), 0);
  assert.equal(count(call => call.host === 'relay'), relayed, 'a server on a relay host is never asked: the relay passes only media');
  assert.deepEqual((await call('vod-unapproved', '/test/logs')).data, ['lumanest_vod_server_unapproved'], 'logged once per isolate, with a fixed code');
  assert.deepEqual((await call('vod-relay-ip', '/test/logs')).data, ['lumanest_vod_server_on_relay']);
});

let catalogue;
test('the catalogue: compact titles and categories, no login or provider address, built from four requests', async () => {
  const before = apiCalls('runtime-private-user');
  const {status, data, headers} = await call('vod-xtream', '/api/player/vod?v=1', {session: 'runtime-private-user'});
  assert.equal(status, 200);
  assert.equal(apiCalls('runtime-private-user') - before, 4);
  assert.deepEqual(['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'].map(action => apiCalls('runtime-private-user', action)), [1, 1, 1, 1]);
  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual([data.v, data.source, data.movies.truncated, data.series.truncated], [1, 'xtream', false, false]);
  assert.match(data.generated, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(data.movies.categories, [{id: '1', name: 'US | Action Movies'}, {id: '2', name: 'FR | Films'}, {id: '3', name: 'XXX', adult: true}]);
  assert.deepEqual(data.movies.items.map(item => item.id), ['123', '124', '125', '126']);
  const dune = data.movies.items[0];
  assert.deepEqual(Object.keys(dune).sort(), ['added', 'cat', 'ext', 'id', 'name', 'rating', 'tmdb', 'year']);
  assert.deepEqual([dune.name, dune.year, dune.ext, dune.rating, dune.tmdb], ['Dune (2021)', '2021', 'mp4', 8.1, '438631']);
  assert.equal(dune.poster, undefined, 'a poster on a relay host gets a title card: the relay passes no images');
  assert.match(data.movies.items[1].poster, /^~0:p2\.jpg$/);
  assert.equal(data.movies.items[2].poster, 'https://image.tmdb.org/t/p/w600/g.jpg');
  assert.equal(data.movies.items[3].poster, undefined, 'a poster on another host gets a title card');
  assert.equal(data.movies.items[3].adult, true);
  assert.deepEqual(data.series.items, [{id: '9', name: 'Show', cat: '5', rating: 7.5, added: 1700000500}]);
  assert.equal(data.posterBases.length, 1, 'one sealed token per poster directory');
  const text = JSON.stringify(data);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
  catalogue = data;
});

test('the catalogue is cached per line: no provider request the second time, its own entry for another line', async () => {
  const before = apiCalls();
  const again = await call('vod-xtream', '/api/player/vod?v=1', {session: 'runtime-private-user'});
  assert.equal(again.status, 200);
  assert.equal(apiCalls(), before);
  assert.deepEqual(again.data, catalogue);
  const other = await call('vod-xtream', '/api/player/vod?v=1', {session: 'other-user'});
  assert.equal(other.status, 200);
  assert.equal(apiCalls('other-user'), 4);
  assert.notDeepEqual(other.data.posterBases, catalogue.posterBases, 'poster links are sealed for each line');
});

test('refresh: once, then not again for 5 minutes', async () => {
  const before = apiCalls('other-user');
  const refreshed = await call('vod-xtream', '/api/player/vod?v=1&refresh=1', {session: 'other-user'});
  assert.equal(refreshed.status, 200);
  assert.equal(apiCalls('other-user') - before, 4);
  const limited = await call('vod-xtream', '/api/player/vod?v=1&refresh=1', {session: 'other-user'});
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, 'vod_refresh_limited');
  assert.ok(Number(limited.headers.get('Retry-After')) > 200);
  assert.equal(apiCalls('other-user') - before, 4);
});

test('a stale copy is served at once while one background refresh runs; a failed refresh keeps it', async () => {
  const user = 'flaky-user';
  assert.equal((await call('vod-xtream', '/api/player/vod?v=1', {session: user})).status, 200);
  assert.equal(apiCalls(user), 4);
  // 31 minutes later.
  await call('vod-xtream', '/test/clock?offset=' + 31 * 60 * 1000);
  const stale = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('X-Vod-Stale'), '1');
  assert.ok(await until(() => apiCalls(user) === 8), 'one background refresh');
  await settle();
  state.failing = true;
  // Another 31 minutes on: the refreshed copy is stale too.
  await call('vod-xtream', '/test/clock?offset=' + 62 * 60 * 1000);
  const before = apiCalls(user);
  const kept = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  assert.equal(kept.status, 200);
  assert.equal(kept.data.source, 'xtream');
  assert.ok(await until(() => apiCalls(user) > before));
  await settle();
  // The failed refresh is not tried again on every request: the stale copy is served and the provider left alone.
  const failedAt = apiCalls(user);
  for (let i = 0; i < 3; i++) {
    const again = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
    assert.deepEqual([again.status, again.headers.get('X-Vod-Stale')], [200, '1']);
  }
  await settle();
  assert.equal(apiCalls(user), failedAt, 'no build for 5 minutes after a failed one');
  // No copy at all and the provider fails: an error the page can retry.
  const fresh = await call('vod-xtream', '/api/player/vod?v=1', {session: 'flaky-user#2', headers: {}});
  assert.equal(fresh.status, 200, 'the same line shares its copy');
  state.failing = false;
  await call('vod-xtream', '/test/clock?offset=0');
});

test('a failing provider with no copy, a list too large and a provider too slow give fixed errors, not retried at once', async () => {
  state.down = true;
  const failed = await call('vod-http', '/api/player/vod?v=1', {session: 'down-user'});
  assert.equal(failed.status, 502, JSON.stringify(failed.data).slice(0, 300));
  assert.equal(failed.data.error.code, 'vod_unavailable');
  await settle();
  const asked = apiCalls('down-user');
  state.down = false;
  // For 5 minutes the same error comes back at once, with when to try again, and the provider is left alone.
  const held = await call('vod-http', '/api/player/vod?v=1', {session: 'down-user'});
  assert.deepEqual([held.status, held.data.error.code], [502, 'vod_unavailable']);
  assert.ok(Number(held.headers.get('Retry-After')) > 200);
  assert.equal(apiCalls('down-user'), asked);
  // Refresh (once per 5 minutes) still tries again.
  const refreshed = await call('vod-http', '/api/player/vod?v=1&refresh=1', {session: 'down-user'});
  assert.equal(refreshed.status, 200);
  assert.equal(apiCalls('down-user') - asked, 4);
  assert.equal((await call('vod-http', '/api/player/vod?v=1', {session: 'down-user'})).status, 200);

  const huge = await call('vod-xtream', '/api/player/vod?v=1', {session: 'huge-user'});
  assert.equal(huge.status, 502);
  assert.equal(huge.data.error.code, 'vod_too_large');
  await timing('vod-xtream', {buildMs: 1500});
  const slow = await call('vod-xtream', '/api/player/vod?v=1', {session: 'slow-user'});
  await timing('vod-xtream', {buildMs: 40000});
  assert.equal(slow.status, 504);
  assert.equal(slow.data.error.code, 'vod_timeout');
  await settle();
  const slowCalls = apiCalls('slow-user');
  const slowAgain = await call('vod-xtream', '/api/player/vod?v=1', {session: 'slow-user'});
  assert.deepEqual([slowAgain.status, slowAgain.data.error.code], [504, 'vod_timeout']);
  assert.equal(apiCalls('slow-user'), slowCalls, 'a timed-out build is not started again at once');
  // The isolate carries on serving.
  assert.equal((await call('vod-xtream', '/api/player/vod?v=1', {session: 'runtime-private-user'})).status, 200);
  for (const response of [failed, held, huge, slow]) for (const secret of SECRETS) assert.ok(!JSON.stringify(response.data).includes(secret));
});

test('a request waits a bounded time for another line’s build, then answers vod_busy', async () => {
  await timing('vod-xtream', {buildMs: 3000, waitMs: 500});
  const slow = call('vod-xtream', '/api/player/vod?v=1', {session: 'slow-two'});
  await new Promise(resolve => setTimeout(resolve, 400));
  const started = Date.now();
  const waiting = await call('vod-xtream', '/api/player/vod?v=1', {session: 'waiting-user'});
  assert.deepEqual([waiting.status, waiting.data.error.code, waiting.headers.get('Retry-After')], [503, 'vod_busy', '10']);
  assert.ok(Date.now() - started < 2500, 'answered within about waitMs');
  assert.equal(apiCalls('waiting-user'), 0);
  assert.equal((await slow).status, 504);
  await timing('vod-xtream', {buildMs: 40000, waitMs: 15000});
  assert.equal((await call('vod-xtream', '/api/player/vod?v=1', {session: 'waiting-user'})).status, 200, 'the slot is free again');
});

test('the catalogue is cut at its byte budget and marked truncated', async () => {
  await call('vod-xtream', '/test/limits?' + new URLSearchParams({catalogueBytes: String(300000), moviesBytes: String(200000)}));
  const worker = await runtime.getWorker('vod-xtream');
  const response = await worker.fetch('https://lumanest.tv/api/player/vod?v=1', {headers: {'test-player-session': 'big-user'}});
  const text = await response.text();
  await call('vod-xtream', '/test/limits?' + new URLSearchParams({catalogueBytes: String(12 * 1024 * 1024), moviesBytes: String(9 * 1024 * 1024)}));
  assert.equal(response.status, 200);
  const data = JSON.parse(text);
  assert.equal(data.movies.truncated, true, JSON.stringify([text.length, data.movies.items.length]));
  assert.ok(data.movies.items.length > 900 && data.movies.items.length < 1100, String(data.movies.items.length));
  assert.ok(text.length < 200000 + 5000, String(text.length));
  assert.equal(data.series.items.length, 1, 'series keep the rest of the budget');
});

test('on a workers.dev address (no working Cache API) the catalogue is kept in the isolate, not rebuilt every time', async () => {
  const worker = await runtime.getWorker('vod-xtream');
  const ask = () => worker.fetch('https://lumanest-tv.example.workers.dev/api/player/vod?v=1', {headers: {'test-player-session': 'workersdev-user'}});
  const first = await ask();
  assert.equal(first.status, 200);
  assert.equal((await first.json()).movies.items.length, 4);
  assert.equal(apiCalls('workersdev-user'), 4);
  const second = await ask();
  assert.equal(second.status, 200);
  await second.arrayBuffer();
  assert.equal(apiCalls('workersdev-user'), 4, 'served from this isolate');
});

test('an Xtream server on an approved http host (not a relay host) is reached directly', async () => {
  const before = count(call => call.host === 'relay');
  const {status, data} = await call('vod-http', '/api/player/vod?v=1', {session: 'runtime-private-user'});
  assert.equal(status, 200);
  assert.equal(data.movies.items.length, 4);
  assert.equal(count(call => call.host === 'relay') - before, 0);
  for (const secret of SECRETS) assert.ok(!JSON.stringify(data).includes(secret));
});

test('series and movie details: compact, cached, and only for numeric ids', async () => {
  const before = apiCalls('runtime-private-user', 'get_series_info');
  const series = await call('vod-xtream', '/api/player/vod/series?id=9', {session: 'runtime-private-user'});
  assert.equal(series.status, 200);
  assert.deepEqual(series.data.seasons, [{season: 1, name: 'Season 1', episodes: [{id: '456', episode: 1, title: 'Pilot', ext: 'mkv'}, {id: '457', episode: 2, title: 'Two', ext: 'mp4', duration: 2700}]}]);
  assert.deepEqual([series.data.name, series.data.plot, series.data.year], ['Show', 'A plot', '2019']);
  assert.equal(series.data.poster, '', 'a cover on a relay host gets a title card');
  assert.deepEqual(series.data.posterBases, []);
  for (const secret of SECRETS) assert.ok(!JSON.stringify(series.data).includes(secret));
  assert.equal((await call('vod-xtream', '/api/player/vod/series?id=9', {session: 'runtime-private-user'})).status, 200);
  assert.equal(apiCalls('runtime-private-user', 'get_series_info') - before, 1, 'cached');
  assert.equal((await call('vod-xtream', '/api/player/vod/series?id=10', {session: 'runtime-private-user'})).status, 404);
  const movie = await call('vod-xtream', '/api/player/vod/movie?id=123', {session: 'runtime-private-user'});
  assert.deepEqual(movie.data, {id: '123', plot: 'Spice', duration: 9000, genre: 'Science Fiction', cast: '', director: 'D. V.', released: '2021-10-22', rating: 0, tmdb: ''});
  const calls = apiCalls();
  for (const id of ['abc', '1;2', '', '12345678901', '9&action=get_live_streams']) {
    assert.equal((await call('vod-xtream', '/api/player/vod/series?id=' + encodeURIComponent(id), {session: 'runtime-private-user'})).status, 400, id);
  }
  assert.equal(apiCalls(), calls, 'nothing is fetched for a bad id');
});

test('playing a movie: a stream token like a channel’s, seeking with ranges, bound to this session', async () => {
  const play = await call('vod-xtream', '/api/player/vod/play', {session: 'runtime-private-user', body: JSON.stringify({type: 'movie', id: '123', ext: 'mp4'})});
  assert.equal(play.status, 200);
  assert.equal(play.data.container, 'mp4');
  assert.ok(play.data.expiresAt > Date.now());
  for (const secret of SECRETS) assert.ok(!JSON.stringify(play.data).includes(secret));
  const stream = '/api/player/stream?token=' + encodeURIComponent(play.data.token);
  const ranged = await call('vod-xtream', stream, {session: 'runtime-private-user', headers: {Range: 'bytes=0-99'}});
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 0-99/1000');
  assert.equal(ranged.data.length, 100);
  assert.equal((await call('vod-xtream', stream, {session: 'other-user', headers: {Range: 'bytes=0-99'}})).status, 403, 'another session can’t use it');
  const cast = await call('vod-xtream', '/api/player/cast', {session: 'runtime-private-user', body: JSON.stringify({token: play.data.token})});
  assert.equal(cast.status, 200);
  assert.match(cast.data.url, /^https:\/\/lumanest\.tv\/api\/cast\/video\.mp4\?t=/);
  assert.equal(cast.data.live, false);
  const mkv = await call('vod-xtream', '/api/player/vod/play', {session: 'runtime-private-user', body: JSON.stringify({type: 'episode', id: '456', ext: 'mkv'})});
  assert.equal(mkv.status, 200);
  const notCastable = await call('vod-xtream', '/api/player/cast', {session: 'runtime-private-user', body: JSON.stringify({token: mkv.data.token})});
  assert.equal(notCastable.status, 400);
  assert.equal(notCastable.data.error.code, 'not_castable');
  for (const body of [{type: 'movie', id: '123', ext: 'exe'}, {type: 'movie', id: '12x', ext: 'mp4'}, {type: 'live', id: '1', ext: 'ts'}, {type: 'movie', id: '1', ext: 'mp4', url: 'http://169.254.169.254/'}]) {
    const response = await call('vod-xtream', '/api/player/vod/play', {session: 'runtime-private-user', body: JSON.stringify(body)});
    assert.equal(response.status, body.url ? 200 : 400, JSON.stringify(body));
  }
});

test('posters: line-bound tokens, image names only, raster images only, edge-cached, failures remembered', async () => {
  const user = 'image-user';
  const {data} = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  assert.equal(data.movies.items[0].poster, undefined, 'a poster on a relay host gets a title card');
  const poster = posterSrc(data.movies.items[1].poster, data.posterBases);
  const before = posterCalls('/posters/p2.jpg');
  const image = await call('vod-xtream', poster, {session: user});
  assert.equal(image.status, 200);
  assert.deepEqual([...image.data], [...JPEG]);
  assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(image.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'");
  assert.equal(image.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(image.headers.get('Cache-Control'), 'private, max-age=604800');
  assert.equal(posterCalls('/posters/p2.jpg') - before, 1);
  await settle();
  assert.equal((await call('vod-xtream', poster, {session: user})).status, 200);
  assert.equal(posterCalls('/posters/p2.jpg') - before, 1, 'the second request comes from the edge cache');

  const token = new URL('https://x' + poster).searchParams.get('t');
  const fetched = calls.length;
  // Another line's session can't use this line's poster links.
  assert.equal((await call('vod-xtream', poster, {session: 'other-user'})).status, 403);
  const forOther = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t: token, l: 'someone-else'}))).data.t;
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(forOther) + '&f=p2.jpg', {session: user})).status, 403);
  const expired = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t: token, exp: String(Date.now() - 1000)}))).data.t;
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(expired) + '&f=p2.jpg', {session: user})).status, 403);
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(token.slice(0, -4) + 'AAAA') + '&f=p2.jpg', {session: user})).status, 403, 'tampered');
  // Only plain image file names: never another file in the poster's directory.
  for (const file of ['', '../../player_api.php', 'player_api.php', 'index.html', 'cover', 'a/b.jpg', '%2e%2e%2fx', 'p2.jpg?x=1']) {
    assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(token) + '&f=' + encodeURIComponent(file), {session: user})).status, 403, file);
  }
  // A token for a host that is not (or no longer) approved: refused before any request.
  const otherToken = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t: token, u: 'https://other.example/posters/'}))).data.t;
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(otherToken) + '&f=p2.jpg', {session: user})).status, 403);
  // A token for a relay host (made before the relay rule, say) is refused too: the relay passes no images.
  const relayToken = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t: token, u: 'http://136.148.65.10/posters/'}))).data.t;
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(relayToken) + '&f=p1.jpg', {session: user})).status, 403);
  assert.equal(calls.length, fetched, 'no request reached the provider or the relay');

  for (const file of ['bad.svg', 'page.jpg', 'big.jpg', 'gone.jpg', 'down.jpg', 'reset.jpg']) {
    const response = await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(token) + '&f=' + file, {session: user});
    assert.equal(response.status, file === 'bad.svg' ? 403 : 404, file);
    assert.match(response.headers.get('Content-Type'), /^application\/json/);
  }
  await settle();
  const asked = ['page.jpg', 'gone.jpg', 'down.jpg', 'reset.jpg'].map(file => posterCalls('/posters/' + file));
  for (const file of ['page.jpg', 'gone.jpg', 'down.jpg', 'reset.jpg']) {
    assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(token) + '&f=' + file, {session: user})).status, 404, file);
  }
  assert.deepEqual(['page.jpg', 'gone.jpg', 'down.jpg', 'reset.jpg'].map(file => posterCalls('/posters/' + file)), asked, 'a missing, refused or failed poster is remembered (an hour, or 10 minutes for a failure)');

  // Signing out stops lists, playback and posters at once.
  const signedOut = await call('vod-xtream', '/api/player/logout', {session: user, body: '{}'});
  assert.equal(signedOut.status, 200);
  assert.equal((await call('vod-xtream', '/api/player/vod?v=1', {session: user})).status, 401);
  assert.equal((await call('vod-xtream', '/api/player/vod/series?id=9', {session: user})).status, 401);
  assert.equal((await call('vod-xtream', '/api/player/vod/play', {session: user, body: JSON.stringify({type: 'movie', id: '123', ext: 'mp4'})})).status, 401);
  const fetchedBefore = calls.length;
  assert.equal((await call('vod-xtream', poster, {session: user})).status, 401, 'a cached poster');
  assert.equal((await call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(token) + '&f=new.jpg', {session: user})).status, 401, 'a poster not seen yet');
  assert.equal(calls.length, fetchedBefore);
});

test('channel lists mark movie and series entries with their file type and a safe poster', async () => {
  const {status, data} = await call('vod-none', '/api/player/channels', {session: 'm3u-user'});
  assert.equal(status, 200);
  assert.deepEqual(data.channels.map(channel => [channel.name, channel.kind, channel.ext]), [['News', 'live', undefined], ['Sports', 'live', undefined], ['Heat (1995)', 'movie', 'mkv'], ['Up (2009)', 'movie', 'mp4'], ['Show S01E01', 'series', 'mp4']]);
  assert.equal(data.channels[0].logo, undefined);
  assert.equal(data.channels[2].logo, undefined, 'an http IP poster without the relay can’t be shown');
  assert.match(data.channels[3].logo, /^~0:m2\.jpg$/);
  assert.equal(data.channels[4].logo, 'https://image.tmdb.org/t/p/w600/x.jpg');
  const relayed = await call('vod-xtream', '/api/player/channels', {session: 'm3u-user'});
  assert.equal(relayed.data.channels[2].logo, undefined, 'nor through the relay, which passes no images');
  assert.match(relayed.data.channels[3].logo, /^~0:m2\.jpg$/);
  assert.equal(relayed.data.posterBases.length, 1);
  for (const response of [data, relayed.data]) {
    const text = JSON.stringify(response);
    for (const secret of ['m3u-password', '136.148.65.', '/movie/', '/series/', '/live/', 'streams.lumanest.tv', 'tv.lumanest.tv/posters']) assert.ok(!text.includes(secret), secret);
  }
  assert.equal((await call('vod-xtream', posterSrc(relayed.data.channels[3].logo, relayed.data.posterBases), {session: 'm3u-user'})).status, 200);
});

test('owner diagnostics report counts, sizes and origins only', async () => {
  const owner = {'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'owner@lumanest.tv'};
  assert.equal((await call('vod-xtream', '/api/player/diagnostics?profile=vod', {session: 'runtime-private-user'})).status, 401);
  assert.equal((await call('vod-xtream', '/api/player/diagnostics?profile=vod', {headers: owner})).status, 401);
  const {status, data} = await call('vod-xtream', '/api/player/diagnostics?profile=vod', {session: 'runtime-private-user', headers: owner});
  assert.equal(status, 200);
  assert.deepEqual(data.xtream, {configured: true, approved: true, origin: 'https://tv.lumanest.tv'});
  assert.deepEqual(data.actions.map(action => [action.action, action.status, action.items]), [['get_vod_categories', 200, 3], ['get_vod_streams', 200, 5], ['get_series_categories', 200, 1], ['get_series', 200, 1]]);
  assert.deepEqual(data.containers, {mp4: 2, mkv: 1, other: 2});
  assert.deepEqual(data.posters, {none: 1, provider: 1, tmdb: 1, relay_host: 2, other_host: 1, topOrigins: data.posters.topOrigins});
  assert.deepEqual(data.m3u, {live: 2, movie: 0, series: 0});
  const text = JSON.stringify(data);
  for (const secret of ['runtime-private-user', 'runtime-secret-password', 'Dune', '/posters/', 'player_api']) assert.ok(!text.includes(secret), secret);
  const none = await call('vod-none', '/api/player/diagnostics?profile=vod', {session: 'm3u-user', headers: owner});
  assert.deepEqual([none.data.xtream, none.data.m3u, none.data.actions], [{configured: false, approved: false, reason: 'not_configured'}, {live: 2, movie: 2, series: 1}, undefined]);
  const relayed = await call('vod-relay-ip', '/api/player/diagnostics?profile=vod', {session: 'runtime-private-user', headers: owner});
  assert.deepEqual(relayed.data.xtream, {configured: true, approved: false, reason: 'server_on_relay', origin: 'http://136.148.65.50'});
});

test('logs carry fixed codes and numbers only', async () => {
  const lines = [];
  for (const name of ['vod-xtream', 'vod-http', 'vod-relay-ip', 'vod-none', 'vod-unapproved']) lines.push(...(await call(name, '/test/logs')).data);
  assert.ok(lines.some(line => line.startsWith('lumanest_vod_build ')));
  assert.ok(lines.some(line => line.startsWith('lumanest_vod_failed ')));
  for (const line of lines) {
    assert.match(line, /^lumanest_[a-z_]+( \{.*\})?$/, line);
    for (const secret of [...SECRETS, ...Object.keys(LOGINS), ...Object.values(LOGINS), 'http']) assert.ok(!line.includes(secret), line);
  }
});
