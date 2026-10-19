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
  'waiting-user': 'waiting-password', 'slow-two': 'slow-two-password', 'workersdev-user': 'workersdev-password', 'host-user': 'host-password',
  'hostbudget-user': 'hostbudget-password', 'hostbreak-user': 'hostbreak-password', 'relayhttps-user': 'relayhttps-password', 'httponly-user': 'httponly-password',
  'ownhost-user': 'ownhost-password', 'spread-user': 'spread-password',
};
const SECRETS = ['runtime-private-user', 'runtime-secret-password', '136.148.65.', '/movie/', 'player_api', 'tv.lumanest.tv/posters', 'streams.lumanest.tv', RELAY_KEY];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

// ---------------------------------------------------------------- the provider double
const calls = [];
const state = {failing: false, down: false, hostGone: false};
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
// A line whose panel keeps nearly every poster on a third-party image host (as many do): 60 movie posters and a series
// cover there, one there carrying the login, two on the provider's own host and one on TMDB. With hostGone the panel
// has moved them to the provider host.
const IMAGE_HOST = 'https://img.posterhost.net';
// Where each such line keeps its 60 posters. relayhttps, httponly and ownhost use hosts that may never be a catalogue
// image host: a relay address over https, a provider host approved for http only over https, and this site's zone.
const POSTER_HOSTS = {
  'host-user': IMAGE_HOST, 'hostbudget-user': IMAGE_HOST, 'hostbreak-user': IMAGE_HOST,
  'relayhttps-user': 'https://136.148.65.10', 'httponly-user': 'https://plain.provider.net', 'ownhost-user': 'https://cdn.lumanest.tv',
};
const hostMovies = (user = 'host-user') => [
  ...Array.from({length: 60}, (_, i) => ({stream_id: 2000 + i, name: 'Hosted ' + i, category_id: '1', stream_icon: state.hostGone ? `https://tv.lumanest.tv/posters/h${i}.jpg` : `${POSTER_HOSTS[user]}/covers/${i}.jpg`, container_extension: 'mp4'})),
  {stream_id: 2060, name: 'Login poster', category_id: '1', stream_icon: `${IMAGE_HOST}/covers/l.jpg?username=${user}`, container_extension: 'mp4'},
  {stream_id: 2061, name: 'Provider poster', category_id: '1', stream_icon: 'https://tv.lumanest.tv/posters/p2.jpg', container_extension: 'mp4'},
  {stream_id: 2062, name: 'Provider poster 2', category_id: '1', stream_icon: 'https://tv.lumanest.tv/posters/p3.jpg', container_extension: 'mp4'},
  {stream_id: 2063, name: 'TMDB poster', category_id: '1', stream_icon: 'https://image.tmdb.org/t/p/w600/t.jpg', container_extension: 'mp4'},
];
const hostSeries = () => [{series_id: 31, name: 'Hosted Show', category_id: '5', cover: `${IMAGE_HOST}/shows/31.jpg`, last_modified: '1700000600'}];
// 64 movies whose posters are spread over 8 hosts (none with 20%): no catalogue image host.
const spreadMovies = () => Array.from({length: 64}, (_, i) => ({stream_id: 3000 + i, name: 'Spread title number ' + i, category_id: '1', stream_icon: `https://cdn${i % 8}.spread.net/p/${i}.jpg`, container_extension: 'mp4'}));
const hostSeriesInfo = {info: {name: 'Hosted Show', cover: `${IMAGE_HOST}/shows/31.jpg`}, episodes: {'1': [{id: '3101', episode_num: 1, title: 'One', container_extension: 'mp4'}]}};

/** The third-party image host and another host it might redirect to. */
function imageHost(url, headers = new Headers()) {
  calls.push({host: url.host, path: url.pathname, agent: headers.get('user-agent') || ''});
  if (url.host !== 'img.posterhost.net') return new Response(JPEG, {headers: {'Content-Type': 'image/jpeg'}});
  if (url.pathname === '/covers/moved.jpg') return new Response(null, {status: 302, headers: {Location: '/covers/1.jpg'}});
  if (url.pathname === '/covers/away.jpg') return new Response(null, {status: 302, headers: {Location: 'https://cdn.other.net/covers/1.jpg'}});
  if (url.pathname === '/covers/page.jpg') return new Response('<!doctype html><title>Just a moment...</title>', {headers: {'Content-Type': 'image/jpeg'}});
  if (url.pathname === '/covers/big.jpg') return new Response(new Uint8Array(3 * 1024 * 1024).fill(0xff), {headers: {'Content-Type': 'image/jpeg'}});
  if (url.pathname === '/covers/gone.jpg') return new Response('gone', {status: 404});
  if (url.pathname.startsWith('/covers/down')) return new Response('blocked', {status: 503});
  return new Response(JPEG, {headers: {'Content-Type': 'image/jpeg'}});
}
const hostCalls = (path) => count(call => (call.host === 'img.posterhost.net' || call.host === 'cdn.other.net') && (!path || call.path === path));
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
    if (action === 'get_vod_streams' && POSTER_HOSTS[user]) return Response.json(hostMovies(user));
    if (action === 'get_series' && POSTER_HOSTS[user]) return Response.json(hostSeries());
    if (action === 'get_series_info' && POSTER_HOSTS[user]) return Response.json(url.searchParams.get('series_id') === '31' ? hostSeriesInfo : {info: {}, episodes: {}});
    if (action === 'get_vod_streams' && user === 'spread-user') return Response.json(spreadMovies());
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
  if (url.hostname === 'img.posterhost.net' || url.hostname === 'cdn.other.net') {
    // The Worker must never send a cookie, referrer or the line's login to a third-party host.
    for (const name of ['cookie', 'referer', 'authorization']) if (request.headers.has(name)) calls.push({host: url.host, path: url.pathname, leaked: name});
    return imageHost(url, request.headers);
  }
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
        import {seal, open, mac} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {VOD_TIMING} from './lib/player-vod.ts';
        import {VOD_LIMITS, posterTag} from './lib/player-vod-data.ts';
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
            if (url.searchParams.get('h') === '1') item.h = 1;
            if (url.searchParams.get('h') === '0') delete item.h;
            return Response.json({t: await seal(item, env.PLAYER_COOKIE_KEY, 'player-image')});
          }
          if (pathname === '/test/open-image') return Response.json(await open(url.searchParams.get('t'), env.PLAYER_COOKIE_KEY, 'player-image'));
          // The tag a catalogue lists with a catalogue image host poster (line l, address a).
          if (pathname === '/test/tag-image') return Response.json({tag: posterTag(env.PLAYER_COOKIE_KEY, url.searchParams.get('l'), url.searchParams.get('a'))});
          // Drops a line's recorded catalogue image host ("record") or its catalogue copy ("copy") from this location, as
          // an eviction would.
          if (pathname === '/test/forget') {
            const user = url.searchParams.get('user');
            const key = await mac(env.TV_APP_XTREAM_SERVER + '\\n' + user + '\\n' + LOGINS[user], env.PLAYER_COOKIE_KEY, 'player-cache');
            const entry = url.origin + '/__lumanest-cache/vod-v1/' + key + (url.searchParams.get('what') === 'record' ? '-imagehost' : '');
            return Response.json({deleted: await caches.default.delete(entry)});
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
  const base = {ADMIN_USER_ID: 'runtime-owner', PLAYER_COOKIE_KEY: KEY, CUSTOMER_PORTAL_URL: 'https://tv.lumanest.tv', PLAYER_ALLOWED_HOSTS: 'tv.lumanest.tv', PLAYER_ALLOWED_HTTP_HOSTS: 'tv.lumanest.tv,plain.provider.net'};
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

/** The sealed directory or address behind a poster token, and the tag the catalogue would list with `path` under it. */
const openImage = async (t) => (await call('vod-xtream', '/test/open-image?t=' + encodeURIComponent(t))).data;
async function tagFor(t, path) {
  const token = await openImage(t);
  return (await call('vod-xtream', '/test/tag-image?' + new URLSearchParams({l: token.l, a: token.u + path}))).data.tag;
}
/** Asks the image route for `path` under the sealed directory t, tagged as the catalogue lists it unless `f` is given. */
async function hostImage(t, path, {session = 'host-user', f} = {}) {
  const value = f ?? path + '!' + await tagFor(t, path);
  return call('vod-xtream', '/api/player/image?t=' + encodeURIComponent(t) + '&f=' + encodeURIComponent(value), {session});
}
const owner = {'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'owner@lumanest.tv'};

test('a third-party host serving most of a line’s posters is that line’s catalogue image host, proxied like a provider host', async () => {
  const user = 'host-user';
  const {status, data} = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  assert.equal(status, 200);
  const items = data.movies.items;
  const t = data.posterBases[1];
  assert.equal(items[61].poster, '~0:p2.jpg', 'the provider poster, placed as it was read');
  assert.equal(items[0].poster, '~1:0.jpg!' + await tagFor(t, '0.jpg'), 'the host’s poster, with the tag that lets this line ask for it');
  assert.equal(items[59].poster, '~1:59.jpg!' + await tagFor(t, '59.jpg'), 'one sealed directory for the host’s posters');
  assert.equal(items[60].poster, undefined, 'a poster carrying the login never reaches the host: a title card');
  assert.equal(items[63].poster, 'https://image.tmdb.org/t/p/w600/t.jpg');
  assert.equal(data.series.items[0].poster, '~2:31.jpg!' + await tagFor(data.posterBases[2], '31.jpg'));
  const text = JSON.stringify(data);
  for (const secret of ['posterhost', 'host-password', 'covers/', 'tv.lumanest.tv']) assert.ok(!text.includes(secret), secret);
  const token = await openImage(t);
  assert.deepEqual([token.u, token.dir, token.h], [IMAGE_HOST + '/covers/', 1, 1]);
  assert.equal((await openImage(data.posterBases[0])).h, undefined, 'provider tokens are unchanged');

  // The poster comes through the image route with the same checks and headers as a provider poster, then the edge cache.
  const poster = posterSrc(items[0].poster, data.posterBases);
  const image = await call('vod-xtream', poster, {session: user});
  assert.equal(image.status, 200);
  assert.deepEqual([...image.data], [...JPEG]);
  assert.deepEqual([image.headers.get('Content-Type'), image.headers.get('Content-Security-Policy'), image.headers.get('Cache-Control'), image.headers.get('Cross-Origin-Resource-Policy')],
    ['image/jpeg', "sandbox; default-src 'none'", 'private, max-age=604800', 'same-origin']);
  assert.equal(hostCalls('/covers/0.jpg'), 1);
  assert.equal(calls.filter(call => call.host === 'img.posterhost.net').at(-1).agent, 'Mozilla/5.0 (compatible; LumaNestPosters/1.0; +https://lumanest.tv)');
  await settle();
  assert.equal((await call('vod-xtream', poster, {session: user})).status, 200);
  assert.equal(hostCalls('/covers/0.jpg'), 1, 'edge-cached');
  const show = await call('vod-xtream', posterSrc(data.series.items[0].poster, data.posterBases), {session: user});
  assert.equal(show.status, 200);

  // Only the names the catalogue listed, with their tags: a made-up name, a missing or wrong tag, another poster’s tag
  // or another line’s tag is refused before anything is fetched or looked up in the cache.
  const asked = hostCalls();
  const other = await call('vod-xtream', '/api/player/vod?v=1', {session: 'other-user'});
  const otherLine = (await openImage(other.data.posterBases[0])).l;
  const otherTag = (await call('vod-xtream', '/test/tag-image?' + new URLSearchParams({l: otherLine, a: IMAGE_HOST + '/covers/1.jpg'}))).data.tag;
  for (const f of ['1.jpg', '1.jpg!', '1.jpg!AAAAAAAA', '2.jpg!' + await tagFor(t, '1.jpg'), '1.jpg!' + otherTag, '../shows/31.jpg!' + await tagFor(t, '../shows/31.jpg'), 'x.svg!' + await tagFor(t, 'x.svg')]) {
    assert.equal((await hostImage(t, '', {f})).status, 403, f);
  }
  assert.equal(hostCalls(), asked, 'none of them reached the host');

  // Redirects stay on the host; raster images up to 2 MB only; failures remembered.
  assert.equal((await hostImage(t, 'moved.jpg')).status, 200, 'a redirect on the same host');
  assert.equal((await hostImage(t, 'away.jpg')).status, 404, 'a redirect to another host is not followed');
  assert.equal(count(call => call.host === 'cdn.other.net'), 0);
  for (const name of ['page.jpg', 'big.jpg', 'gone.jpg']) assert.equal((await hostImage(t, name)).status, 404, name);
  await settle();
  const fetched = hostCalls();
  for (const name of ['away.jpg', 'page.jpg', 'gone.jpg']) assert.equal((await hostImage(t, name)).status, 404, name);
  assert.equal(hostCalls(), fetched, 'remembered');

  // The image route serves this line only the host recorded for this line's catalogue.
  const before = hostCalls(), blocked = count(call => call.blocked);
  assert.equal((await call('vod-xtream', poster, {session: 'other-user'})).status, 403, 'another line’s session');
  const forOther = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t, l: otherLine}))).data.t;
  assert.equal((await hostImage(forOther, '1.jpg', {session: 'other-user'})).status, 403, 'a line whose catalogue has no image host');
  const elsewhere = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t, u: 'https://cdn.other.net/covers/'}))).data.t;
  assert.equal((await hostImage(elsewhere, '1.jpg')).status, 403, 'not the recorded host');
  const providerAsHost = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t: data.posterBases[0], h: '1'}))).data.t;
  assert.equal((await hostImage(providerAsHost, 'p2.jpg')).status, 403, 'a provider address marked as the image host');
  const hostAsProvider = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t, h: '0'}))).data.t;
  assert.equal((await hostImage(hostAsProvider, '', {f: '1.jpg'})).status, 403, 'the image host is not a provider host');
  for (const [u, name] of [[IMAGE_HOST + '/covers/', 'host-user.jpg'], [IMAGE_HOST + '/HOST-PASSWORD/', '1.jpg'], [IMAGE_HOST + ':8443/covers/', '1.jpg'],
    ['http://img.posterhost.net/covers/', '1.jpg'], ['http://136.148.65.10/posters/', 'p1.jpg'], ['https://136.148.65.10/posters/', 'p1.jpg'], ['https://img.posterhost.net./covers/', '1.jpg']]) {
    const resealed = (await call('vod-xtream', '/test/reseal-image?' + new URLSearchParams({t, u}))).data.t;
    assert.equal((await hostImage(resealed, name)).status, 403, u + name);
  }
  assert.equal(hostCalls(), before, 'none of them reached an image host');
  assert.equal(count(call => call.blocked), blocked, 'nor any other host');
  assert.equal(count(call => call.leaked), 0, 'no cookie, referrer or authorization sent to the image host');

  // A series' cover on the host is proxied the same way, from its details.
  const details = await call('vod-xtream', '/api/player/vod/series?id=31', {session: user});
  assert.equal(details.status, 200);
  assert.equal(details.data.poster, '~0:31.jpg!' + await tagFor(details.data.posterBases[0], '31.jpg'));
  const cover = await openImage(details.data.posterBases[0]);
  assert.deepEqual([cover.u, cover.dir, cover.h], [IMAGE_HOST + '/shows/', 1, 1]);
  assert.equal((await call('vod-xtream', posterSrc(details.data.poster, details.data.posterBases), {session: user})).status, 200);

  // Diagnostics show the host, its posters and directories, and what is recorded for the line.
  const report = (await call('vod-xtream', '/api/player/diagnostics?profile=vod', {session: user, headers: owner})).data;
  assert.deepEqual(report.posters, {
    none: 0, provider: 2, tmdb: 1, catalogue_host: 61, relay_host: 0, other_host: 1, catalogue_host_origin: IMAGE_HOST, catalogue_host_dirs: 2, catalogue_host_recorded: IMAGE_HOST,
    catalogue_host_probe: {status: 200, image: 'image/jpeg', ms: report.posters.catalogue_host_probe.ms}, topOrigins: [[IMAGE_HOST, 62], ['https://tv.lumanest.tv', 2], ['https://image.tmdb.org', 1]],
  });
  assert.ok(!JSON.stringify(report).includes('covers/'), 'origins only, never a poster address');

  // The host is kept with the catalogue copy and in a small record: either one is enough. (Each isolate's own copy of
  // it is switched off here, so every request reads the location's.)
  await timing('vod-xtream', {imageHostMs: 0, imageHostNoneMs: 0});
  const forget = async what => assert.equal((await call('vod-xtream', '/test/forget?' + new URLSearchParams({user, what}))).data.deleted, true, what);
  await forget('copy');
  assert.equal((await hostImage(t, '3.jpg')).status, 200, 'the copy expired (12 hours): the record, kept as long as poster links live, says which host');
  assert.equal((await call('vod-xtream', '/api/player/vod?v=1', {session: user})).status, 200, 'built again');
  await forget('record');
  assert.equal((await hostImage(t, '4.jpg')).status, 200, 'the record evicted, or its write failed: the catalogue copy says which host');
  await forget('copy');
  const ahead = hostCalls();
  assert.equal((await hostImage(t, '5.jpg')).status, 403, 'neither: nothing is fetched');
  assert.equal(hostCalls(), ahead);
  await timing('vod-xtream', {imageHostMs: 5 * 60 * 1000, imageHostNoneMs: 30 * 1000});

  // The provider moves its posters: the next build (there is no copy now) finds no image host, and old links stop
  // working, cached or not.
  state.hostGone = true;
  const refreshed = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  state.hostGone = false;
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.movies.items[0].poster, '~0:h0.jpg');
  const after = hostCalls();
  assert.equal((await hostImage(t, '2.jpg')).status, 403, 'the host is no longer recorded for this line');
  assert.equal((await call('vod-xtream', poster, {session: user})).status, 403, 'the host is checked before the edge cache, so a cached poster stops too');
  assert.equal(hostCalls(), after);

  // Signing out stops them too.
  const signedIn = await call('vod-xtream', '/api/player/vod?v=1', {session: 'hostbreak-user#2'});
  assert.equal(signedIn.status, 200);
  const signedInPoster = posterSrc(signedIn.data.movies.items[0].poster, signedIn.data.posterBases);
  assert.equal((await call('vod-xtream', signedInPoster, {session: 'hostbreak-user#2'})).status, 200);
  assert.equal((await call('vod-xtream', '/api/player/logout', {session: 'hostbreak-user#2', body: '{}'})).status, 200);
  assert.equal((await call('vod-xtream', signedInPoster, {session: 'hostbreak-user#2'})).status, 401);
});

test('a catalogue image host that keeps failing for a line rests for a while: nothing is sent to it', async () => {
  const user = 'hostbreak-user';
  const {data} = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
  const t = data.posterBases[1];
  assert.equal((await openImage(t)).h, 1);
  await timing('vod-xtream', {imageHostFailures: 3});
  try {
    for (const name of ['down1.jpg', 'down2.jpg']) assert.equal((await hostImage(t, name, {session: user})).status, 404, name);
    assert.equal((await hostImage(t, '10.jpg', {session: user})).status, 200, 'an image in between starts the count again');
    const before = hostCalls();
    for (const name of ['down3.jpg', 'down4.jpg', 'down5.jpg']) assert.equal((await hostImage(t, name, {session: user})).status, 404, name);
    assert.equal(hostCalls(), before + 3);
    assert.equal((await hostImage(t, '11.jpg', {session: user})).status, 404, 'resting: not asked');
    assert.equal((await hostImage(t, '12.jpg', {session: user})).status, 404);
    assert.equal(hostCalls(), before + 3, 'nothing sent while it rests');
    // Posters already in the edge cache still come back, and other lines are not affected.
    assert.equal((await hostImage(t, '10.jpg', {session: user})).status, 200);
    const other = (await call('vod-xtream', '/api/player/vod?v=1', {session: 'hostbudget-user'})).data;
    assert.equal((await hostImage(other.posterBases[1], '12.jpg', {session: 'hostbudget-user'})).status, 200);
  } finally {
    await timing('vod-xtream', {imageHostFailures: 20});
  }
});

/** A title's JSON as the build first wrote it: without a catalogue image host poster (added last, with its tag). */
const titleBytes = (items) => items.reduce((sum, item) => {
  const copy = {...item};
  if (typeof copy.poster === 'string' && copy.poster.includes('!')) delete copy.poster;
  return sum + JSON.stringify(copy).length + 1;
}, 0);

test('titles come first: catalogue image host posters only use the room the titles leave', async () => {
  const user = 'hostbudget-user';
  const full = (await call('vod-xtream', '/api/player/vod?v=1', {session: user})).data;
  assert.equal(full.movies.items.filter(item => item.poster?.includes('!')).length, 60);
  const movies = titleBytes(full.movies.items), series = titleBytes(full.series.items);
  // Exactly the titles' room for movies, and 400 bytes more in all: every title stays, a few posters fit.
  await call('vod-xtream', '/test/limits?' + new URLSearchParams({moviesBytes: String(movies), catalogueBytes: String(movies + series + 400)}));
  await call('vod-xtream', '/test/logs');
  let tight;
  try {tight = await call('vod-xtream', '/api/player/vod?v=1&refresh=1', {session: user});}
  finally {await call('vod-xtream', '/test/limits?' + new URLSearchParams({catalogueBytes: String(12 * 1024 * 1024), moviesBytes: String(9 * 1024 * 1024)}));}
  assert.equal(tight.status, 200);
  assert.deepEqual([tight.data.movies.items.length, tight.data.movies.truncated, tight.data.series.items.length, tight.data.series.truncated], [full.movies.items.length, false, 1, false]);
  const placed = tight.data.movies.items.filter(item => item.poster?.includes('!')).length + tight.data.series.items.filter(item => item.poster?.includes('!')).length;
  assert.ok(placed > 0 && placed < 20, String(placed));
  const used = [...tight.data.movies.items, ...tight.data.series.items].reduce((sum, item) => sum + JSON.stringify(item).length + 1, 0);
  assert.ok(used <= movies + series + 400, `${used} > ${movies + series + 400}`);
  const log = (await call('vod-xtream', '/test/logs')).data.find(line => line.startsWith('lumanest_vod_build '));
  const built = JSON.parse(log.slice('lumanest_vod_build '.length));
  assert.deepEqual([built.truncated, built.imageHost, built.imageHostPosters, built.imageHostSkipped], [false, true, placed, 61 - placed]);
});

test('posters waiting on hosts that never qualify take no room from titles', async () => {
  const user = 'spread-user';
  const full = (await call('vod-xtream', '/api/player/vod?v=1', {session: user})).data;
  assert.equal(full.movies.items.length, 64);
  assert.ok(full.movies.items.every(item => item.poster === undefined), 'eight hosts at 12.5% each: title cards');
  const movies = titleBytes(full.movies.items);
  await call('vod-xtream', '/test/limits?' + new URLSearchParams({moviesBytes: String(movies)}));
  let tight;
  try {tight = await call('vod-xtream', '/api/player/vod?v=1&refresh=1', {session: user});}
  finally {await call('vod-xtream', '/test/limits?' + new URLSearchParams({moviesBytes: String(9 * 1024 * 1024)}));}
  assert.equal(tight.status, 200);
  assert.deepEqual([tight.data.movies.items.length, tight.data.movies.truncated], [64, false]);
  assert.equal(count(call => /spread\.net/.test(call.host || '')), 0, 'never fetched');
});

test('a relay address over https, a provider host approved for http only, and this site’s own hosts are never a catalogue image host', async () => {
  const blocked = count(call => call.blocked);
  for (const [user, origin] of [['relayhttps-user', 'https://136.148.65.10'], ['httponly-user', 'https://plain.provider.net'], ['ownhost-user', 'https://cdn.lumanest.tv']]) {
    const {status, data} = await call('vod-xtream', '/api/player/vod?v=1', {session: user});
    assert.equal(status, 200);
    assert.ok(data.movies.items.slice(0, 60).every(item => item.poster === undefined), user + ': title cards');
    assert.equal(data.posterBases.length, 1, user + ': only the provider’s directory');
    const report = (await call('vod-xtream', '/api/player/diagnostics?profile=vod', {session: user, headers: owner})).data;
    assert.deepEqual([report.posters.catalogue_host, report.posters.catalogue_host_origin, report.posters.catalogue_host_recorded], [0, null, null], user);
    assert.equal(report.posters.topOrigins[0][0], origin);
  }
  assert.equal(count(call => call.blocked), blocked, 'none of those hosts was asked for anything');
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
  assert.deepEqual(data.posters, {
    none: 1, provider: 1, tmdb: 1, catalogue_host: 0, relay_host: 2, other_host: 1, catalogue_host_origin: null, catalogue_host_dirs: 0, catalogue_host_recorded: null,
    topOrigins: data.posters.topOrigins,
  });
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
