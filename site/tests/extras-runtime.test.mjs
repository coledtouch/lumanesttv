// The real /api/extras/* routes in workerd, with a real R2 bucket, a D1 database with the site's migrations and the
// Workers Rate Limiting binding as Miniflare runs them, and OpenSubtitles and TMDB replaced by an outbound double. No
// request reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';

const PLAYER_KEY = 'e'.repeat(64);
const OS_KEY = 'runtime-os-key-SECRET';
const TMDB_V3 = 'fedcba9876543210fedcba9876543210';
const SRT = '1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i> &amp; <font color="red">bye</font>\n';
let runtime;
const calls = [];

function upstream(request) {
  const url = new URL(request.url);
  calls.push({method: request.method, url, apiKey: request.headers.get('Api-Key'), agent: request.headers.get('User-Agent')});
  if (url.hostname === 'api.opensubtitles.com' && url.pathname === '/api/v1/subtitles') {
    return Response.json({data: [{attributes: {language: 'en', download_count: 10, files: [{file_id: 4486640}], feature_details: {feature_type: 'Movie', tmdb_id: 603}}}]});
  }
  if (url.hostname === 'api.opensubtitles.com' && url.pathname === '/api/v1/download' && request.method === 'POST') {
    return Response.json({link: 'https://www.opensubtitles.com/download/RUNTIME/x.srt', remaining: 41, reset_time_utc: '2026-10-21T00:00:00.000Z'});
  }
  if (url.hostname === 'www.opensubtitles.com') return new Response(SRT);
  if (url.origin === 'https://api.themoviedb.org' && url.pathname === '/3/movie/603/videos') {
    return Response.json({results: [{iso_639_1: 'en', name: 'Trailer', key: 'vKQi3bBA1y8', site: 'YouTube', type: 'Trailer', official: true, published_at: '2021-01-01T00:00:00.000Z'}]});
  }
  return new Response('unexpected', {status: 599});
}

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as subtitles from './app/api/extras/subtitles/route.ts';
        import * as file from './app/api/extras/subtitles/file/[file]/route.ts';
        import * as trailer from './app/api/extras/trailer/route.ts';
        import {env} from 'cloudflare:workers';
        export default {async fetch(request) {
          const {pathname, searchParams} = new URL(request.url);
          if (pathname === '/test/r2') {
            const object = env.BUCKET ? await env.BUCKET.get(searchParams.get('key')) : null;
            return Response.json(object ? await object.json() : null);
          }
          if (pathname === '/test/d1') {
            const {results} = await env.DB.prepare('SELECT day, client, count FROM extras_download_counts ORDER BY client').all();
            return Response.json(results);
          }
          if (pathname === '/test/r2-list') {
            const listed = env.BUCKET ? await env.BUCKET.list({prefix: ''}) : {objects: []};
            return Response.json(listed.objects.map(object => object.key));
          }
          const route = pathname === '/api/extras/subtitles' ? subtitles : pathname === '/api/extras/trailer' ? trailer : pathname.startsWith('/api/extras/subtitles/file/') ? file : null;
          if (!route) return new Response('not found', {status: 404});
          return route[request.method](request);
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'extras-runtime-worker.ts', loader: 'ts',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'],
  });
  const worker = (name, bindings, extra = {}) => ({
    name, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'enable_request_signal'], modules: true, script: bundle.outputFiles[0].text,
    scriptPath: fileURLToPath(new URL('../extras-runtime-worker.js', import.meta.url)), bindings, outboundService: upstream, ...extra,
  });
  runtime = new Miniflare({workers: [
    worker('extras', {PLAYER_COOKIE_KEY: PLAYER_KEY, OPENSUBTITLES_API_KEY: OS_KEY, TMDB_API_KEY: TMDB_V3}, {
      r2Buckets: {BUCKET: 'extras-runtime-bucket'}, d1Databases: {DB: 'extras-runtime-db'},
      ratelimits: {SUBTITLE_FILE_LIMITER: {simple: {limit: 2, period: 60}}},
    }),
    worker('extras-unset', {PLAYER_COOKIE_KEY: PLAYER_KEY}),
  ]});
  const database = await runtime.getD1Database('DB', 'extras');
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8');
    await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
});
test.after(async () => {await runtime?.dispose();});

async function call(worker, path, method = 'GET') {
  const response = await (await runtime.getWorker(worker)).fetch(new URL(path, 'https://lumanest.tv'), {method, headers: {'CF-Connecting-IP': '192.0.2.10'}});
  return {status: response.status, headers: response.headers, text: await response.text()};
}

test('without the secrets: "not_configured" answers, no upstream request', async () => {
  const before = calls.length;
  const subtitles = await call('extras-unset', '/api/extras/subtitles?v=1&type=movie&tmdb=603');
  assert.equal(subtitles.status, 200);
  assert.equal(subtitles.headers.get('Cache-Control'), 'public, max-age=600');
  assert.deepEqual(JSON.parse(subtitles.text), {v: 1, status: 'not_configured', tmdb: 603, tracks: [], credit: 'Subtitles provided by OpenSubtitles.com'});
  const trailer = await call('extras-unset', '/api/extras/trailer?v=1&type=movie&tmdb=603');
  assert.deepEqual(JSON.parse(trailer.text), {v: 1, status: 'not_configured', tmdb: 603, trailer: null});
  assert.equal((await call('extras-unset', '/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt')).status, 503);
  const options = await call('extras-unset', '/api/extras/subtitles', 'OPTIONS');
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(calls.length, before);
});

test('a lookup, its file and a trailer in workerd, with only metadata in R2', async () => {
  const lookup = await call('extras', '/api/extras/subtitles?v=1&type=movie&tmdb=603');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(lookup.headers.get('Set-Cookie'), null);
  const body = JSON.parse(lookup.text);
  assert.equal(body.status, 'ok');
  assert.equal(body.tracks.length, 1);
  const track = body.tracks[0];
  assert.match(track.id, /^4486640-[A-Za-z0-9_-]{22}$/);
  assert.equal(track.vtt, 'https://lumanest.tv/api/extras/subtitles/file/' + track.id + '.vtt');
  assert.equal(track.label, 'English (OpenSubtitles)');
  const search = calls.find(c => c.url.pathname === '/api/v1/subtitles');
  assert.equal(search.apiKey, OS_KEY);
  assert.equal(search.agent, 'LumaNest TV v1.0');
  const stored = JSON.parse((await call('extras', '/test/r2?key=' + encodeURIComponent('extras/v1/subtitles/movie/603/en.json'))).text);
  assert.deepEqual(stored.files, [{file_id: 4486640, hi: false, label: 'English (OpenSubtitles)'}]);

  const vtt = await call('extras', new URL(track.vtt).pathname);
  assert.equal(vtt.status, 200);
  assert.equal(vtt.text, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi &amp; bye\n');
  assert.equal(vtt.headers.get('Content-Type'), 'text/vtt; charset=utf-8');
  assert.equal(vtt.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'");
  assert.equal(vtt.headers.get('Cache-Control'), 'private, max-age=604800');
  const srt = await call('extras', new URL(track.srt).pathname);
  assert.equal(srt.text, '1\n00:00:01,000 --> 00:00:02,000\nHi & bye\n');
  // Both downloads were counted in D1 for today: every client together, and this client under a keyed hash.
  const today = new Date().toISOString().slice(0, 10);
  const counts = JSON.parse((await call('extras', '/test/d1')).text);
  assert.equal(counts.length, 2);
  assert.deepEqual(counts[0], {day: today, client: '*', count: 2});
  assert.match(counts[1].client, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual({...counts[1], client: 'hash'}, {day: today, client: 'hash', count: 2});
  assert.ok(!JSON.stringify(counts).includes('192.0.2'), 'no address in D1');
  const downloads = calls.filter(c => c.url.pathname === '/api/v1/download').length;
  const head = await call('extras', new URL(track.vtt).pathname, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(calls.filter(c => c.url.pathname === '/api/v1/download').length, downloads, 'HEAD downloads nothing');
  // The file limiter binding (2 a minute here): the third file request this minute is refused.
  const limited = await call('extras', new URL(track.vtt).pathname);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  assert.equal((await call('extras', '/api/extras/subtitles/file/4486640-AAAAAAAAAAAAAAAAAAAAAA.vtt', 'HEAD')).status, 404);

  const trailer = await call('extras', '/api/extras/trailer?v=1&type=movie&tmdb=603');
  const answer = JSON.parse(trailer.text);
  assert.equal(answer.trailer.key, 'vKQi3bBA1y8');
  assert.equal(answer.trailer.short, 'youtu.be/vKQi3bBA1y8');
  assert.ok(answer.trailer.qr.length >= 21 && answer.trailer.qr.every(row => /^[01]+$/.test(row) && row.length === answer.trailer.qr.length));
  const videos = calls.find(c => c.url.pathname === '/3/movie/603/videos');
  assert.equal(videos.url.searchParams.get('api_key'), TMDB_V3);
  for (const text of [lookup.text, vtt.text, srt.text, trailer.text]) for (const secret of [OS_KEY, TMDB_V3, PLAYER_KEY, 'opensubtitles.com/download']) assert.ok(!text.includes(secret));

  // Nothing but metadata under extras/v1/: no subtitle file was stored.
  const keys = JSON.parse((await call('extras', '/test/r2-list')).text);
  assert.deepEqual(keys.sort(), ['extras/v1/subtitles/movie/603/en.json', 'extras/v1/trailers/movie/603.json']);
});
