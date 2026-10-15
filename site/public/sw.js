const CACHE = 'lumanest-pwa-static-v2';
const STATIC = ['/pwa/offline.html', '/pwa/offline.css', '/pwa/icon-192.png', '/pwa/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lumanest-pwa-static-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Authenticated pages, billing, channel lists, and streams always use the network.
  // Store only our public offline page and icons; no customer data enters Cache Storage.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.search && STATIC.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, {cacheName: CACHE}).then(cached => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match('/pwa/offline.html', {cacheName: CACHE});
    return cached || new Response('LumaNest TV needs an internet connection. Reconnect and try again.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
  }));
});
