// The real /embed/trailer route in workerd, as Miniflare runs it. No request leaves the worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

const KEY = 'L0fw0WzFaBM';
let runtime;
const outbound = [];

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as trailer from './app/embed/trailer/route.ts';
        export default {fetch(request) {
          if (new URL(request.url).pathname !== '/embed/trailer') return new Response('not found', {status: 404});
          const handler = trailer[request.method];
          return handler ? handler(request) : new Response('method', {status: 405});
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'trailer-embed-runtime-worker.ts', loader: 'ts',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser',
  });
  runtime = new Miniflare({
    name: 'trailer-embed', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'enable_request_signal'], modules: true,
    script: bundle.outputFiles[0].text, scriptPath: fileURLToPath(new URL('../trailer-embed-runtime-worker.js', import.meta.url)),
    outboundService: request => {outbound.push(request.url); return new Response('unexpected', {status: 599});},
  });
});
test.after(async () => {await runtime?.dispose();});

async function call(path, method = 'GET') {
  const response = await runtime.dispatchFetch(new URL(path, 'https://lumanest.tv'), {method});
  return {status: response.status, headers: response.headers, text: await response.text()};
}

test('the page in workerd: its headers, and the key only where the player reads it', async () => {
  const page = await call('/embed/trailer?v=1&k=' + KEY);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(page.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(page.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(page.headers.get('X-Frame-Options'), null);
  assert.equal(page.headers.get('Set-Cookie'), null);
  const csp = page.headers.get('Content-Security-Policy');
  assert.match(csp, /^default-src 'none'; script-src 'self' https:\/\/www\.youtube\.com https:\/\/s\.ytimg\.com; frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com;/);
  assert.doesNotMatch(csp, /frame-ancestors|sandbox|unsafe/);
  assert.ok(page.text.includes('<div id="player" data-k="' + KEY + '"></div>'));

  const head = await call('/embed/trailer?v=1&k=' + KEY, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers.get('Content-Security-Policy'), csp);
  assert.deepEqual(outbound, []);
});

test('bad parameters in workerd: 400, nothing repeated, not cached', async () => {
  for (const query of ['?v=1&k=%22%3E%3Cscript%3Ealert(1)%3C/script%3E', '?v=2&k=' + KEY, '?k=' + KEY, '?v=1&k=' + KEY.slice(1)]) {
    const page = await call('/embed/trailer' + query);
    assert.equal(page.status, 400, query);
    assert.equal(page.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(page.text, /script|alert|L0fw|fw0WzFaBM/);
  }
  assert.equal((await call('/embed/trailer?v=1&k=' + KEY, 'POST')).status, 405);
});
