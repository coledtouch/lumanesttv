// scripts/cloudflare-entry.mjs takes a media GET's native body past the framework's JavaScript body wrappers. Here the
// real entry, route handlers and lib/player.ts run in workerd behind a stand-in framework that, like Vinext, wraps every
// route response body in a JavaScript stream; /direct/… skips the entry to show what the framework alone does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';

let runtime;
const root = fileURLToPath(new URL('../', import.meta.url));

test.before(async () => {
  const framework = await build({
    stdin: {
      contents: `
        import * as castStream from './app/api/cast/stream/route.ts';
        import * as castFile from './app/api/cast/[file]/route.ts';
        import * as playerStream from './app/api/player/stream/route.ts';
        import * as playerChannels from './app/api/player/channels/route.ts';
        import * as playerCast from './app/api/player/cast/route.ts';
        import {seal} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {env} from 'cloudflare:workers';
        export const stats = {pulls: 0, seen: []};
        export const sessionCookie = async () => PLAYER_COOKIE + '=' + await seal({username: 'handoff-user', password: 'handoff-password', exp: Date.now() + 600000, sid: crypto.randomUUID()}, env.PLAYER_COOKIE_KEY, 'player-session');
        const routes = [[/^\\/api\\/cast\\/stream$/, castStream], [/^\\/api\\/cast\\/[^/]+$/, castFile], [/^\\/api\\/player\\/stream$/, playerStream], [/^\\/api\\/player\\/channels$/, playerChannels], [/^\\/api\\/player\\/cast$/, playerCast]];
        // Like Vinext's deferAppRouteHandlerCleanup: the route's body is read and re-enqueued by JavaScript, chunk by chunk.
        function wrap(response) {
          if (!response.body) return response;
          const reader = response.body.getReader();
          const body = new ReadableStream({
            async pull(controller) {stats.pulls++; const {value, done} = await reader.read(); if (done) controller.close(); else controller.enqueue(value);},
            cancel(reason) {return reader.cancel(reason);},
          }, {highWaterMark: 0});
          return new Response(body, response);
        }
        export default {async fetch(request) {
          const url = new URL(request.url);
          const handler = routes.find(([pattern]) => pattern.test(url.pathname))?.[1][request.method];
          if (!handler) return new Response('not found', {status: 404});
          const inStore = !!globalThis[Symbol.for('lumanest.mediaHandoff')]?.getStore();
          const response = await handler(request);
          stats.seen.push({method: request.method, path: url.pathname, inStore, status: response.status, body: response.body !== null, handoff: response.headers.get('X-LumaNest-Media-Handoff')});
          // A framework that answers with something else after the route returned, such as an error page.
          if (url.searchParams.has('framework-error')) return new Response('framework error page', {status: 500});
          return wrap(response);
        }};
      `,
      resolveDir: root, sourcefile: 'media-handoff-framework.ts', loader: 'ts',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name: 'mock-framework-request-context', setup(builder) {
      builder.onResolve({filter: /^next\/(headers|navigation)$/}, args => ({path: args.path, namespace: 'mock-framework'}));
      builder.onLoad({filter: /.*/, namespace: 'mock-framework'}, args => ({contents: args.path.endsWith('/headers') ? 'export async function headers(){return new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}', loader: 'js'}));
    }}],
  });
  // The main module: counts JavaScript stream work in this isolate and records whether the body the runtime gets is
  // the native stream lib/player.ts made.
  const testEntry = `
    import entry from './cloudflare-entry.mjs';
    import framework, {stats, sessionCookie} from './index.js';
    const counts = {enqueue: 0, read: 0};
    for (const [proto, name] of [[ReadableStreamDefaultController.prototype, 'enqueue'], [TransformStreamDefaultController.prototype, 'enqueue'], [ReadableStreamDefaultReader.prototype, 'read']]) {
      const original = proto[name];
      proto[name] = function (...args) {counts[name]++; return original.apply(this, args);};
    }
    const native = new WeakSet();
    const Identity = globalThis.IdentityTransformStream;
    globalThis.IdentityTransformStream = class extends Identity {constructor(...args) {super(...args); native.add(this.readable);}};
    let cookie, nativeBody = false;
    export default {async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === '/test/stats') return Response.json({...counts, pulls: stats.pulls, nativeBody});
      // What each route handed the framework since the last call.
      if (url.pathname === '/test/seen') return Response.json(stats.seen.splice(0));
      const headers = new Headers(request.headers);
      if (headers.has('test-player-session')) {headers.set('Cookie', cookie ||= await sessionCookie()); headers.delete('test-player-session');}
      if (headers.has('test-same-origin')) {headers.set('Origin', url.origin); headers.delete('test-same-origin');}
      const direct = url.pathname.startsWith('/direct/');
      const target = direct ? new URL(url.pathname.slice('/direct'.length) + url.search, url) : url;
      const forwarded = new Request(target, {method: request.method, headers, body: request.body, signal: request.signal});
      const response = await (direct ? framework : entry).fetch(forwarded, env, ctx);
      nativeBody = !!response.body && native.has(response.body);
      return response;
    }};
  `;
  const modulesRoot = fileURLToPath(new URL('../media-handoff-worker/', import.meta.url));
  runtime = new Miniflare({
    compatibilityDate: '2026-05-15', cf: false,
    workers: [{
      name: 'site', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'enable_request_signal'], modulesRoot,
      modules: [
        {type: 'ESModule', path: modulesRoot + 'test-entry.mjs', contents: testEntry},
        {type: 'ESModule', path: modulesRoot + 'cloudflare-entry.mjs', contents: await readFile(new URL('../scripts/cloudflare-entry.mjs', import.meta.url), 'utf8')},
        {type: 'ESModule', path: modulesRoot + 'index.js', contents: framework.outputFiles[0].text},
      ],
      d1Databases: {DB: 'media-handoff'},
      bindings: {PLAYER_COOKIE_KEY: 'a'.repeat(64), CUSTOMER_PORTAL_URL: 'https://tv.lumanest.tv', PLAYER_ALLOWED_HOSTS: 'tv.lumanest.tv', PLAYER_ALLOWED_HTTP_HOSTS: 'tv.lumanest.tv'},
      outboundService: 'provider',
    }, {
      name: 'provider', modules: true, compatibilityDate: '2026-05-15',
      script: `
        export default {async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/sent') return new Response(String(globalThis.sent || 0));
          if (url.pathname === '/m3u') return new Response('#EXTM3U\\n#EXTINF:-1,Endless\\nhttps://tv.lumanest.tv/live/u/p/6.ts?token=t\\n#EXTINF:-1,Finite\\nhttps://tv.lumanest.tv/live/u/p/5.ts?token=t\\n#EXTINF:-1,HLS\\nhttps://tv.lumanest.tv/live/u/p/2.m3u8?token=t\\n', {headers: {'Content-Type': 'text/plain'}});
          if (url.pathname === '/live/u/p/5.ts') return new Response('finite-ts-body', {headers: {'Content-Type': 'video/mp4'}});
          if (url.pathname === '/live/u/p/2.m3u8') return new Response('#EXTM3U\\n#EXT-X-TARGETDURATION:6\\n#EXTINF:6,\\nseg1.ts?token=t\\n', {headers: {'Content-Type': 'application/vnd.apple.mpegurl'}});
          // A live channel that never ends; /sent stops growing once nobody is connected.
          if (url.pathname === '/live/u/p/6.ts') {
            let timer;
            return new Response(new ReadableStream({start(controller) {timer = setInterval(() => {try {controller.enqueue(new TextEncoder().encode('endless-ts-chunk')); globalThis.sent = (globalThis.sent || 0) + 1;} catch {clearInterval(timer);}}, 10);}, cancel() {clearInterval(timer);}}), {headers: {'Content-Type': 'video/mp4'}});
          }
          return new Response('not found', {status: 404});
        }};
      `,
    }],
  });
  const database = await runtime.getD1Database('DB', 'site');
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8');
    await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
});
test.after(async () => {await runtime?.dispose();});

const session = {'test-player-session': '1'};
const site = (path, init) => runtime.dispatchFetch('https://lumanest.tv' + path, init);
const stats = async () => (await site('/test/stats')).json();
const seen = async () => (await site('/test/seen')).json();
const sent = async () => Number(await (await (await runtime.getWorker('provider')).fetch('https://tv.lumanest.tv/sent')).text());
async function providerClosed() {
  // A hang-up takes a moment to travel from this client through Miniflare to the worker.
  await new Promise(resolve => setTimeout(resolve, 300));
  const before = await sent();
  await new Promise(resolve => setTimeout(resolve, 300));
  return await sent() === before;
}
async function channels() {
  const response = await site('/api/player/channels', {headers: session});
  assert.equal(response.status, 200);
  return (await response.json()).channels;
}
async function castLink(token, receiver) {
  const response = await site('/api/player/cast', {method: 'POST', headers: {...session, 'test-same-origin': '1', 'Content-Type': 'application/json'}, body: JSON.stringify({token, receiver})});
  assert.equal(response.status, 200);
  const {url} = await response.json();
  return new URL(url).pathname + new URL(url).search;
}
// What a client sees, apart from the hosting marker the entry adds and Server-Timing's durations.
const visible = response => [...response.headers].filter(([name]) => name !== 'x-lumanest-hosting').map(([name, value]) => name + ': ' + (name === 'server-timing' ? value.replace(/dur=\d+/g, 'dur=N') : value)).sort();
// Reads `count` chunks after the first and returns the JavaScript stream work this isolate did meanwhile.
async function streamWork(reader, count = 30) {
  assert.equal((await reader.read()).done, false);
  const before = await stats();
  let text = '';
  for (let i = 0; i < count; i++) {const {value, done} = await reader.read(); assert.equal(done, false); text += new TextDecoder().decode(value);}
  const after = await stats(), idle = await stats();
  // Reading the counters costs a little work of its own; the idle pair measures it.
  const overhead = name => idle[name] - after[name];
  return {text, enqueue: after.enqueue - before.enqueue - overhead('enqueue'), read: after.read - before.read - overhead('read'), pulls: after.pulls - before.pulls};
}

test('media GETs reach the client as lib/player.ts\'s native stream, with no JavaScript per chunk and the same status and headers', {timeout: 20000}, async () => {
  const listed = await channels();
  const paths = {cast: await castLink(listed[0].token, 'lumanest'), phone: '/api/player/stream?token=' + encodeURIComponent(listed[0].token)};
  for (const [name, path] of Object.entries(paths)) {
    const headers = name === 'phone' ? session : {};
    await seen();
    const viaEntry = await site(path, {headers});
    assert.equal(viaEntry.status, 200, name);
    assert.equal((await stats()).nativeBody, true, name);
    if (name === 'cast') {
      assert.equal(viaEntry.headers.get('Access-Control-Allow-Origin'), '*');
      assert.equal(viaEntry.headers.get('Content-Type'), 'video/mp2t');
    }
    assert.equal(viaEntry.headers.get('X-LumaNest-Media-Handoff'), null);
    const reader = viaEntry.body.getReader();
    const work = await streamWork(reader);
    assert.match(work.text, /^(endless-ts-chunk)+$/);
    assert.deepEqual([work.enqueue, work.read, work.pulls], [0, 0, 0], name);
    await reader.cancel();
    assert.ok(await providerClosed(), name + ': a hang-up closes the provider connection');
    // The route gave the framework the same status and headers with no body.
    assert.deepEqual(await seen(), [{method: 'GET', path: path.split('?')[0], inStore: true, status: 200, body: false, handoff: '1'}], name);

    // The framework alone: the same response, but its wrapper runs JavaScript for every chunk.
    const direct = await site('/direct' + path, {headers});
    assert.equal(direct.status, 200, name);
    assert.equal((await stats()).nativeBody, false, name);
    assert.deepEqual(visible(viaEntry), visible(direct), name);
    const directReader = direct.body.getReader();
    const directWork = await streamWork(directReader);
    assert.ok(directWork.pulls >= 30 && directWork.read >= 30 && directWork.enqueue >= 30, JSON.stringify(directWork));
    await directReader.cancel();
    assert.ok(await providerClosed(), name);
    assert.deepEqual((await seen()).map(entry => [entry.inStore, entry.body, entry.handoff]), [[false, true, null]], name);
  }
});

test('HEAD, OPTIONS, playlists, finite streams and refusals answer exactly as the framework alone does', {timeout: 20000}, async () => {
  const listed = await channels();
  const live = await castLink(listed[0].token, 'lumanest'), finite = await castLink(listed[1].token, 'lumanest'), hls = await castLink(listed[2].token);
  // [method, path, headers, whether the route hands its body to the entry]
  const requests = [
    ['HEAD', live, {}, false], ['OPTIONS', live, {Origin: 'https://www.gstatic.com', 'Access-Control-Request-Method': 'GET'}, false],
    ['GET', finite, {}, true], ['GET', hls, {}, false], ['GET', '/api/player/stream?token=' + encodeURIComponent(listed[1].token), session, true],
    ['GET', '/api/cast/live.ts?t=forged', {}, false], ['GET', '/api/cast/stream', {}, false], ['POST', live, {}, false],
    ['GET', '/api/player/stream?token=' + encodeURIComponent(listed[0].token), {}, false], ['GET', '/api/player/stream?token=forged', session, false],
  ];
  await seen();
  for (const [method, path, headers, handedOff] of requests) {
    const label = method + ' ' + path.split('?')[0];
    const viaEntry = await site(path, {method, headers});
    const entrySeen = await seen();
    const direct = await site('/direct' + path, {method, headers});
    const directSeen = await seen();
    assert.equal(viaEntry.status, direct.status, label);
    assert.deepEqual(visible(viaEntry), visible(direct), label);
    const [entryText, directText] = [await viaEntry.text(), await direct.text()];
    // Playlists carry freshly sealed links; only their shape must match.
    const shape = text => text.replace(/\?t=[^\n]+/g, '?t=…');
    assert.equal(shape(entryText), shape(directText), label);
    assert.equal(viaEntry.headers.get('X-LumaNest-Hosting'), 'cloudflare');
    // Only a media GET runs inside the hand-off store, and only a stream it serves is handed off.
    const media = method === 'GET' && /^\/api\/(cast\/|player\/stream)/.test(path);
    assert.deepEqual(entrySeen.map(entry => [entry.inStore, entry.handoff]), entrySeen.length ? [[media, handedOff ? '1' : null]] : [], label);
    assert.deepEqual(directSeen.map(entry => [entry.inStore, entry.handoff]), directSeen.length ? [[false, null]] : [], label);
  }
  assert.equal((await site(live, {method: 'OPTIONS'})).headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');
  assert.equal((await site('/api/cast/live.ts?t=forged')).headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await site('/api/player/stream?token=' + encodeURIComponent(listed[0].token))).status, 401);
  assert.ok(await providerClosed());
  assert.deepEqual((await seen()).map(entry => entry.status), [204, 403, 401]);
  // Making cast links (a POST) never ran inside the store.
  await castLink(listed[0].token, 'lumanest');
  assert.deepEqual((await seen()).map(entry => [entry.path, entry.inStore]), [['/api/player/cast', false]]);
});

test('when the framework answers with something else, the handed-off stream and its provider connection are closed', {timeout: 10000}, async () => {
  const listed = await channels();
  const live = await castLink(listed[0].token, 'lumanest');
  await seen();
  const response = await site(live + '&framework-error=1');
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'framework error page');
  assert.equal(response.headers.get('X-LumaNest-Media-Handoff'), null);
  assert.deepEqual((await seen()).map(entry => [entry.body, entry.handoff]), [[false, '1']]);
  assert.ok(await providerClosed());
});
