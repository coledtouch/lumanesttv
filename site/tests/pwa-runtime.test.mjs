import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {portalManifest} from '../cloudflare/lumanest-pwa-worker.mjs';

const publicOrigin = 'https://lumanest.tv';
const customerOrigin = 'https://portal.lumanest.tv';
const staticCache = 'lumanest-pwa-static-v1';
let runtime, upstream;

test.before(async () => {
  const script = await readFile(new URL('../cloudflare/lumanest-pwa-worker.mjs', import.meta.url), 'utf8');
  runtime = new Miniflare({
    compatibilityDate: '2026-05-15', cf: false,
    workers: [{name: 'pwa-edge-runtime', modules: true, script, outboundService: 'pwa-origin'}, {
      name: 'pwa-origin', modules: true,
      script: `
        let calls = [], response = {status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html><head><title>Customer hub</title></head><body><main>Private customer content</main></body></html>', headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': 'private-session=fixture; HttpOnly; Secure', 'ETag': 'fixture-etag'}};
        export default {async fetch(request) {
          const url = new URL(request.url);
          if(url.hostname === 'mock.test' && url.pathname === '/control') {response = {...response,...await request.json()}; calls = []; return Response.json({ok:true});}
          if(url.hostname === 'mock.test' && url.pathname === '/stats') return Response.json({calls});
          calls.push({url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: ['GET','HEAD'].includes(request.method) ? '' : await request.text()});
          if(url.hostname === 'lumanest.tv') return new Response(request.method === 'HEAD' ? null : 'public-asset-fixture', {headers: {'Content-Type': url.pathname === '/sw.js' ? 'application/javascript' : 'image/png', 'Cache-Control': 'public, max-age=600', 'Set-Cookie': 'asset-cookie=fixture', 'ETag': 'asset-etag'}});
          return new Response(request.method === 'HEAD' ? null : response.body, {status: response.status, headers: {'Content-Type': response.type, ...response.headers}});
        }};
      `
    }]
  });
  upstream = await runtime.getWorker('pwa-origin');
});
test.after(async () => {await runtime?.dispose();});

async function control(response) {
  await upstream.fetch('https://mock.test/control', {method: 'POST', body: JSON.stringify(response)});
}
async function calls() {return (await (await upstream.fetch('https://mock.test/stats')).json()).calls;}

test('manifests use matching install identities, correct icon sizes, and credential-free shortcuts', async () => {
  const main = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  for (const manifest of [main, portalManifest()]) {
    assert.equal(manifest.id, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.name, 'LumaNest TV');
    assert.equal(manifest.start_url.startsWith('/'), true);
    assert.equal(manifest.start_url.includes('?'), false);
    const anySizes = manifest.icons.filter(icon => icon.purpose === 'any').map(icon => icon.sizes);
    assert.ok(anySizes.includes('192x192'));
    assert.ok(anySizes.includes('512x512'));
    assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
    for (const icon of manifest.icons) {
      const file = await readFile(new URL('../public' + icon.src, import.meta.url));
      assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(file.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
      assert.equal(file.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
      assert.equal(icon.type, 'image/png');
    }
    for (const shortcut of manifest.shortcuts) {
      const url = new URL(shortcut.url, customerOrigin);
      assert.equal(url.origin, customerOrigin);
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      assert.equal(url.username, '');
      assert.equal(url.password, '');
    }
  }
  assert.ok(main.shortcuts.some(shortcut => shortcut.url === '/watch'));
  assert.ok(portalManifest().shortcuts.some(shortcut => shortcut.url === '/channels'));
});

test('edge worker rejects unconfigured domains without reaching an origin', async () => {
  await control({});
  const response = await runtime.dispatchFetch('https://unrelated.example/manifest.webmanifest');
  assert.equal(response.status, 404);
  assert.deepEqual(await calls(), []);
});

test('both customer origins return their own manifest without forwarding customer headers', async () => {
  for (const origin of [customerOrigin, 'https://tv.lumanest.tv']) {
    await control({});
    const response = await runtime.dispatchFetch(origin + '/manifest.webmanifest?customer=fixture', {headers: {Cookie: 'customer-session=private-fixture', Authorization: 'Bearer private-fixture'}});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /^application\/manifest\+json/);
    assert.deepEqual(await response.json(), portalManifest());
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(await calls(), []);
    const head = await runtime.dispatchFetch(origin + '/manifest.webmanifest', {method: 'HEAD'});
    assert.equal(await head.text(), '');
  }
});

test('public asset fetches cannot leak a customer cookie, authorization, referer, or query to the marketing origin', async () => {
  for (const pathname of ['/sw.js', '/pwa-install.js', '/pwa-install.css', '/pwa/offline.html', '/pwa/offline.css', '/pwa/icon.svg', '/pwa/icon-180.png', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png']) {
    await control({});
    const response = await runtime.dispatchFetch(customerOrigin + pathname + '?username=private-fixture&password=private-fixture', {headers: {Cookie: 'customer-session=private-fixture', Authorization: 'Bearer private-fixture', Referer: customerOrigin + '/watch?token=private-fixture'}});
    assert.equal(await response.text(), 'public-asset-fixture');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const requests = await calls();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, publicOrigin + pathname);
    for (const name of ['cookie', 'authorization', 'referer']) assert.equal(requests[0].headers[name], undefined, name);
    if (pathname === '/sw.js') {
      assert.equal(response.headers.get('Service-Worker-Allowed'), '/');
      assert.equal(response.headers.get('Cache-Control'), 'no-cache');
    }
  }
});

test('customer HTML gains app metadata while retaining private response and login cookies', async () => {
  await control({status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html><head><title>Channels</title></head><body><main>Private channel selection</main></body></html>', headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': 'private-session=fixture; HttpOnly; Secure', ETag: 'fixture-etag', 'Content-Security-Policy': "default-src 'self'"}});
  const response = await runtime.dispatchFetch(customerOrigin + '/channels?region=fixture', {headers: {Cookie: 'customer-session=fixture'}});
  const body = await response.text();
  assert.ok(body.includes('Private channel selection'));
  assert.ok(body.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(body.includes('src="/pwa-install.js" defer'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Set-Cookie'), 'private-session=fixture; HttpOnly; Secure');
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'self'");
  assert.equal(response.headers.get('ETag'), null);
  const requests = await calls();
  assert.equal(requests[0].url, customerOrigin + '/channels?region=fixture');
  assert.equal(requests[0].headers.cookie, 'customer-session=fixture');
});

test('API, streams, redirects, errors, and form submissions pass through without rewriting', async () => {
  const samples = [
    {path: '/api/customer', type: 'text/html', body: '<html><head></head><body>API fixture</body></html>', status: 200, method: 'GET'},
    {path: '/cdn-cgi/challenge', type: 'text/html', body: '<html><head></head><body>Challenge fixture</body></html>', status: 200, method: 'GET'},
    {path: '/live/customer/stream.ts', type: 'video/mp2t', body: 'stream-fixture', status: 200, method: 'GET'},
    {path: '/live/customer/playlist.m3u8', type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\nhttps://media.example/segment.ts', status: 200, method: 'GET'},
    {path: '/channels', type: 'text/html', body: '<html><head></head><body>Form fixture</body></html>', status: 200, method: 'POST'},
    {path: '/manifest.webmanifest', type: 'text/plain', body: 'POST manifest fixture', status: 200, method: 'POST'},
    {path: '/sw.js', type: 'text/plain', body: 'POST service worker fixture', status: 200, method: 'POST'},
    {path: '/watch', type: 'text/html', body: '<html><head></head><body>Error fixture</body></html>', status: 401, method: 'GET'},
    {path: '/login', type: 'text/html', body: '', status: 302, method: 'GET'}
  ];
  for (const sample of samples) {
    await control({...sample, headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': 'private-session=fixture', 'ETag': 'origin-etag', ...(sample.status === 302 ? {Location: '/login'} : {})}});
    const form = sample.method === 'POST' ? 'selected=private-fixture&password=private-fixture' : undefined;
    const response = await runtime.dispatchFetch(customerOrigin + sample.path, {method: sample.method, redirect: 'manual', headers: {Cookie: 'customer-session=fixture', ...(form ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})}, ...(form ? {body: form} : {})});
    assert.equal(response.status, sample.status, sample.path);
    assert.equal(await response.text(), sample.body, sample.path);
    assert.equal(response.headers.get('ETag'), 'origin-etag', sample.path);
    assert.equal(response.headers.get('Set-Cookie'), 'private-session=fixture', sample.path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', sample.path);
    const requests = await calls();
    assert.equal(requests.length, 1, sample.path);
    assert.equal(requests[0].url, customerOrigin + sample.path, sample.path);
    assert.equal(requests[0].body, form || '', sample.path);
  }
});

async function serviceWorker({offline = false, fallback = new Response('public offline fixture'), cacheKeys = [], cachedAssets} = {}) {
  const handlers = new Map(), cacheWrites = [], cacheReads = [], deleted = [], network = [];
  let skipWaiting = 0, claimed = 0;
  const context = vm.createContext({
    URL, Response,
    self: {location: {origin: customerOrigin}, addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => {skipWaiting++;}, clients: {claim: async () => {claimed++;}}},
    caches: {open: async name => ({addAll: async paths => {cacheWrites.push({name, paths: Array.from(paths)});}}), keys: async () => cacheKeys, delete: async name => {deleted.push(name); return true;}, match: async (path, options) => {cacheReads.push({path, options}); return (cachedAssets ? cachedAssets.get(path) : fallback)?.clone();}},
    fetch: async request => {network.push(request); if (offline) throw new TypeError('Offline fixture'); return new Response('private network response', {headers: {'Cache-Control': 'private, no-store'}});}
  });
  vm.runInContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  async function run(name, request) {
    let response, pending;
    handlers.get(name)({request, waitUntil: promise => {pending = promise;}, respondWith: promise => {response = promise;}});
    await pending;
    return response ? await response : undefined;
  }
  return {run, cacheWrites, cacheReads, deleted, network, counters: () => ({skipWaiting, claimed})};
}

test('service worker pre-caches only public offline assets and only removes its own older static caches', async () => {
  const worker = await serviceWorker({cacheKeys: ['lumanest-pwa-static-v0', staticCache, 'other-app-cache', 'customer-data-cache']});
  await worker.run('install');
  assert.deepEqual(worker.cacheWrites, [{name: staticCache, paths: ['/pwa/offline.html', '/pwa/offline.css', '/pwa/icon-192.png', '/pwa/icon-512.png']}]);
  await worker.run('activate');
  assert.deepEqual(worker.deleted, ['lumanest-pwa-static-v0']);
  assert.deepEqual(worker.counters(), {skipWaiting: 1, claimed: 1});
  assert.deepEqual(worker.cacheReads, []);
  const offline = await readFile(new URL('../public/pwa/offline.html', import.meta.url), 'utf8');
  assert.match(offline, /internet connection/);
  assert.doesNotMatch(offline, /<script|<style|\sstyle=|<form|password|customer-session|playlist_url/i);
  assert.match(offline, /<link rel="stylesheet" href="\/pwa\/offline.css">/);
  const install = await readFile(new URL('../public/pwa-install.js', import.meta.url), 'utf8');
  assert.doesNotMatch(install, /createElement\(['"]style['"]\)|\.style\.|\.style\s*=|eval\(|new Function\(/);
  assert.match(install, /style\.href = '\/pwa-install.css'/);
});

test('offline public stylesheet and icon requests use their exact static cache entries without the network', async () => {
  const paths = ['/pwa/offline.html', '/pwa/offline.css', '/pwa/icon-192.png', '/pwa/icon-512.png'];
  const cachedAssets = new Map(paths.map(path => [path, new Response('cached public fixture for ' + path)]));
  const worker = await serviceWorker({offline: true, cachedAssets});
  for (const path of paths) {
    const response = await worker.run('fetch', {url: customerOrigin + path, method: 'GET', mode: 'same-origin'});
    assert.equal(await response.text(), 'cached public fixture for ' + path);
  }
  assert.deepEqual(worker.network, []);
  assert.deepEqual(worker.cacheWrites, []);
  assert.deepEqual(worker.cacheReads.map(lookup => lookup.path), paths);
  for (const path of paths) assert.equal(await worker.run('fetch', {url: customerOrigin + path + '?private=fixture', method: 'GET', mode: 'same-origin'}), undefined);
  assert.equal(worker.cacheReads.length, paths.length);
});

test('service worker never intercepts background API, stream, cross-origin, or POST requests', async () => {
  const worker = await serviceWorker({offline: true});
  for (const request of [
    {url: customerOrigin + '/api/customer?token=private-fixture', method: 'GET', mode: 'same-origin'},
    {url: customerOrigin + '/live/customer/playlist.m3u8?password=private-fixture', method: 'GET', mode: 'cors'},
    {url: customerOrigin + '/live/customer/stream.ts', method: 'GET', mode: 'no-cors'},
    {url: customerOrigin + '/channels', method: 'POST', mode: 'navigate'},
    {url: 'https://media.example/stream.ts', method: 'GET', mode: 'navigate'}
  ]) assert.equal(await worker.run('fetch', request), undefined, request.url);
  assert.deepEqual(worker.cacheWrites, []);
  assert.deepEqual(worker.cacheReads, []);
  assert.deepEqual(worker.network, []);
});

test('authenticated navigation always uses the original network request and never caches its response', async () => {
  const worker = await serviceWorker();
  for (const path of ['/channels', '/watch?token=private-fixture', '/renew', '/manage', '/api/customer']) {
    const request = {url: customerOrigin + path, method: 'GET', mode: 'navigate', headers: {Cookie: 'customer-session=private-fixture'}};
    const response = await worker.run('fetch', request);
    assert.equal(await response.text(), 'private network response');
    assert.equal(worker.network.at(-1), request);
  }
  assert.deepEqual(worker.cacheWrites, []);
  assert.deepEqual(worker.cacheReads, []);
});

test('offline navigation returns a generic public page rather than saved account or billing data', async () => {
  const worker = await serviceWorker({offline: true});
  for (const path of ['/channels', '/watch?password=private-fixture', '/renew', '/login']) {
    const response = await worker.run('fetch', {url: customerOrigin + path, method: 'GET', mode: 'navigate'});
    assert.equal(await response.text(), 'public offline fixture');
  }
  assert.deepEqual(worker.cacheWrites, []);
  assert.equal(worker.cacheReads.length, 4);
  for (const lookup of worker.cacheReads) {
    assert.equal(lookup.path, '/pwa/offline.html');
    assert.equal(lookup.options.cacheName, staticCache);
  }
  const missing = await serviceWorker({offline: true, fallback: null});
  const response = await missing.run('fetch', {url: customerOrigin + '/channels', method: 'GET', mode: 'navigate'});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(await response.text(), /internet connection/);
});

async function installUI({hostname = 'portal.lumanest.tv', pathname = '/channels', secure = true, standalone = false, ios = false} = {}) {
  const nodes = [], registrations = [], windowListeners = new Map(), documentListeners = new Map();
  let focused;
  function element(tagName) {
    const events = new Map();
    const node = {tagName, children: [], hidden: false, disabled: false, attributes: {}, append(...children) {this.children.push(...children);}, prepend(child) {this.children.unshift(child);}, appendChild(child) {this.children.push(child); return child;}, setAttribute(name, value) {this.attributes[name] = value;}, addEventListener(name, callback) {events.set(name, callback);}, focus() {focused = node;}, async dispatch(name, event = {}) {await events.get(name)?.(event);}};
    nodes.push(node);
    return node;
  }
  const document = {head: element('head'), body: element('body'), fullscreenElement: null, querySelector: () => null, getElementById: id => nodes.find(node => node.id === id), createElement: element, addEventListener: (name, callback) => documentListeners.set(name, callback)};
  const context = vm.createContext({
    document,
    location: {hostname, pathname},
    window: {isSecureContext: secure, matchMedia: () => ({matches: standalone}), addEventListener: (name, callback) => windowListeners.set(name, callback)},
    navigator: {standalone, userAgent: ios ? 'iPhone' : 'test-browser', platform: ios ? 'iPhone' : 'test-platform', maxTouchPoints: ios ? 1 : 0, serviceWorker: {register: async (url, options) => {registrations.push({url, scope: options.scope});}}}
  });
  vm.runInContext(await readFile(new URL('../public/pwa-install.js', import.meta.url), 'utf8'), context);
  return {document, registrations, find: id => document.getElementById(id), focus: () => focused, emitWindow: async (name, event) => {await windowListeners.get(name)?.(event);}, emitDocument: async (name, event) => {await documentListeners.get(name)?.(event);}};
}

test('install support stays on configured secure customer pages and hides in installed app windows', async () => {
  for (const settings of [{secure: false}, {hostname: 'unrelated.example'}, {pathname: '/manage'}, {pathname: '/manage/security'}, {pathname: '/api/customer'}]) {
    const ui = await installUI(settings);
    assert.equal(ui.find('lumanest-install'), undefined);
    assert.deepEqual(ui.registrations, []);
  }
  const installed = await installUI({standalone: true});
  assert.equal(installed.find('lumanest-install'), undefined);
  assert.deepEqual(installed.registrations, [{url: '/sw.js', scope: '/'}]);
  for (const hostname of ['lumanest.tv', 'portal.lumanest.tv', 'tv.lumanest.tv']) {
    const ui = await installUI({hostname});
    assert.ok(ui.find('lumanest-install'));
    assert.deepEqual(ui.registrations, [{url: '/sw.js', scope: '/'}]);
    assert.ok(ui.document.head.children.some(node => node.tagName === 'link' && node.href === '/pwa-install.css' && node.rel === 'stylesheet'));
  }
});

test('browser installation requires a customer click and remains hidden after installation and fullscreen exit', async () => {
  const ui = await installUI();
  const widget = ui.find('lumanest-install');
  const button = widget.children[1];
  let offered = 0, prevented = 0;
  await ui.emitWindow('beforeinstallprompt', {preventDefault: () => {prevented++;}, prompt: async () => {offered++;}, userChoice: Promise.resolve({outcome: 'accepted'})});
  assert.equal(prevented, 1);
  assert.equal(offered, 0);
  await button.dispatch('click');
  assert.equal(offered, 1);
  assert.equal(widget.hidden, true);
  assert.equal(button.disabled, false);
  await ui.emitWindow('appinstalled');
  ui.document.fullscreenElement = {};
  await ui.emitDocument('fullscreenchange');
  assert.equal(widget.hidden, true);
  ui.document.fullscreenElement = null;
  await ui.emitDocument('fullscreenchange');
  assert.equal(widget.hidden, true);
});

test('manual Safari installation help is accessible and viewing fullscreen hides the install overlay', async () => {
  const ui = await installUI({ios: true, pathname: '/watch'});
  const widget = ui.find('lumanest-install');
  const panel = widget.children[0], button = widget.children[1];
  assert.equal(panel.hidden, true);
  await button.dispatch('click');
  assert.equal(panel.hidden, false);
  assert.equal(button.attributes['aria-expanded'], 'true');
  assert.match(panel.children[1].textContent, /Safari.*Share.*Add to Home Screen/);
  assert.equal(ui.focus(), panel.children[2]);
  await widget.dispatch('keydown', {key: 'Escape'});
  assert.equal(panel.hidden, true);
  assert.equal(button.attributes['aria-expanded'], 'false');
  assert.equal(ui.focus(), button);
  ui.document.fullscreenElement = {};
  await ui.emitDocument('fullscreenchange');
  assert.equal(widget.hidden, true);
  ui.document.fullscreenElement = null;
  await ui.emitDocument('fullscreenchange');
  assert.equal(widget.hidden, false);
});
