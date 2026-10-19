import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

// The real route in workerd, with the real Workers Cache API and TMDB replaced by an outbound double.
const V3 = '0123456789abcdef0123456789abcdef';
const NONE = '{"v":1,"source":"none","movie":{},"tv":{},"genres":{}}';
let runtime;
const tmdbCalls = [];
const DETAILS = /^\/3\/movie\/(\d+)$/;
const listCalls = () => tmdbCalls.filter(url => !DETAILS.test(url.pathname)).length;
const detailCalls = () => tmdbCalls.filter(url => DETAILS.test(url.pathname)).length;

function tmdb(request) {
  const url = new URL(request.url);
  tmdbCalls.push(url);
  if (url.origin !== 'https://api.themoviedb.org' || url.searchParams.get('api_key') !== V3) return new Response('{}', {status: 401});
  if (url.pathname.startsWith('/3/genre/')) return Response.json({genres: [{id: 28, name: 'Action'}]});
  const detail = DETAILS.exec(url.pathname);
  if (detail) return Response.json({id: Number(detail[1]), origin_country: ['US'], production_countries: [{iso_3166_1: 'US'}]});
  const page = Number(url.searchParams.get('page')), tv = url.pathname.includes('/tv');
  const results = Array.from({length: 20}, (_, i) => {
    const id = page * 100 + i + 1;
    // TMDB sends poster_path (and backdrop_path, which the endpoint leaves out); every fifth one is not a plain file name.
    const art = {poster_path: i % 5 === 4 ? 'https://evil.example/p.jpg' : '/p' + id + 'Xy_-z.jpg', backdrop_path: '/b' + id + '.jpg'};
    return tv ? {id, name: 'Series ' + id, original_name: 'Series ' + id, first_air_date: '2024-02-03', origin_country: ['US'], original_language: 'en', genre_ids: [18], popularity: 50, ...art}
      : {id, title: 'Movie ' + id, original_title: 'Movie ' + id, release_date: '2025-07-04', original_language: 'en', genre_ids: [28], popularity: 50, ...art};
  });
  return Response.json({page, total_pages: 9, results});
}

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {GET, HEAD, OPTIONS} from './app/api/catalog/rows/route.ts';
        export default {async fetch(request) {
          const {pathname} = new URL(request.url);
          if (pathname === '/test/cached') {
            const cached = await caches.default.match('https://lumanest.tv/__lumanest-cache/catalog-rows-v1');
            return Response.json(cached ? {cacheControl: cached.headers.get('Cache-Control'), freshUntil: Number(cached.headers.get('X-Catalog-Fresh-Until')), source: (await cached.json()).source} : null);
          }
          if (request.method === 'HEAD') return HEAD(request);
          if (request.method === 'OPTIONS') return OPTIONS();
          return GET(request);
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'catalog-runtime-worker.ts', loader: 'ts',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'],
  });
  const worker = (name, bindings) => ({name, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text,
    scriptPath: fileURLToPath(new URL('../catalog-runtime-worker.js', import.meta.url)), bindings, outboundService: tmdb});
  runtime = new Miniflare({workers: [
    worker('catalog-none', {}), worker('catalog-tmdb', {TMDB_API_KEY: V3}),
    // A key TMDB refuses: the refresh fails and there is no copy to serve.
    worker('catalog-refused', {TMDB_API_KEY: 'f'.repeat(32)}),
  ]});
});
test.after(async () => {await runtime?.dispose();});

async function call(worker, path, method = 'GET', origin = 'https://lumanest.tv') {
  const response = await (await runtime.getWorker(worker)).fetch(new URL(path, origin), {method});
  return {status: response.status, headers: response.headers, text: await response.text()};
}

test('without TMDB_API_KEY the endpoint answers "none" publicly, with the documented headers', async () => {
  const response = await call('catalog-none', '/api/catalog/rows?v=1');
  assert.equal(response.status, 200);
  assert.equal(response.text, NONE);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Content-Type'), /^application\/json/);
  assert.equal(response.headers.get('Set-Cookie'), null);

  const head = await call('catalog-none', '/api/catalog/rows?v=1', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal((await call('catalog-none', '/api/catalog/rows?v=1', 'OPTIONS')).status, 204);
  assert.equal((await call('catalog-none', '/api/catalog/rows')).text, NONE);
  const unsupported = await call('catalog-none', '/api/catalog/rows?v=2');
  assert.equal(unsupported.status, 400);
  assert.equal(JSON.parse(unsupported.text).error.code, 'unsupported_version');
  assert.equal(tmdbCalls.length, 0);
});

test('with a key the rows come from TMDB once and are kept in the Workers Cache API', async () => {
  const first = await call('catalog-tmdb', '/api/catalog/rows?v=1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=3600');
  const rows = JSON.parse(first.text);
  assert.equal(rows.source, 'tmdb');
  assert.equal(rows.movie.popular.length, 100);
  assert.equal(rows.tv.services.peacock.length, 100);
  assert.deepEqual(rows.tv.featured[0], {id: 101, title: 'Series 101', original_title: 'Series 101', year: '2024', origin: ['US'], lang: 'en', genres: [18], popularity: 50, poster: '/p101Xy_-z.jpg'});
  // Movie list results carry no countries; they come from each movie's details, looked up once per title.
  assert.deepEqual(rows.movie.popular[0], {id: 101, title: 'Movie 101', original_title: 'Movie 101', year: '2025', origin: ['US'], lang: 'en', genres: [28], popularity: 50, poster: '/p101Xy_-z.jpg'});
  // The poster path only when it is a plain file name, and never the backdrop.
  assert.equal(rows.movie.popular[4].poster, undefined);
  assert.ok(!first.text.includes('backdrop') && !first.text.includes('evil.example') && !first.text.includes('/b101.jpg'));
  assert.deepEqual(rows.genres, {movie: [{id: 28, name: 'Action'}], tv: [{id: 28, name: 'Action'}]});
  assert.equal(listCalls(), 112);
  assert.equal(detailCalls(), 100);

  const cached = JSON.parse((await call('catalog-tmdb', '/test/cached')).text);
  assert.equal(cached.source, 'tmdb');
  assert.equal(cached.cacheControl, 'public, max-age=604800');
  assert.ok(Math.abs(cached.freshUntil - (Date.now() + 12 * 3600 * 1000)) < 60000);

  assert.equal((await call('catalog-tmdb', '/api/catalog/rows?v=1')).text, first.text);
  assert.equal((await call('catalog-tmdb', '/api/catalog/rows?v=1', 'HEAD')).status, 200);
  assert.equal(tmdbCalls.length, 212);
});

test('when TMDB fails and there is no copy, the answer is a 503 that nothing keeps', async () => {
  const before = tmdbCalls.length;
  const origin = 'https://refused.lumanest.tv';
  const response = await call('catalog-refused', '/api/catalog/rows?v=1', 'GET', origin);
  assert.equal(response.status, 503);
  assert.equal(response.text, NONE);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Retry-After'), '300');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(tmdbCalls.length > before && tmdbCalls.length <= before + 5, 'the refused key stops the refresh');
  // TMDB is left alone for five minutes; the answer stays a 503 rather than turning into a cached "none".
  const again = await call('catalog-refused', '/api/catalog/rows?v=1', 'HEAD', origin);
  assert.equal(again.status, 503);
  assert.equal(again.headers.get('Cache-Control'), 'no-store');
  assert.ok(tmdbCalls.length <= before + 5);
});
