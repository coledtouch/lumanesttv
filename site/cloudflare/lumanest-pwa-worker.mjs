const HOSTS = new Set(['portal.lumanest.tv', 'tv.lumanest.tv']);
const ASSETS = new Set(['/sw.js', '/pwa-install.js', '/pwa-install.css', '/pwa/offline.html', '/pwa/offline.css', '/pwa/icon.svg', '/pwa/icon-180.png', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png']);
const HEAD = '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/pwa/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/pwa/icon-180.png"><meta name="theme-color" content="#141224"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="LumaNest TV"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';

export function portalManifest() {
  return {
    id: '/', name: 'LumaNest TV', short_name: 'LumaNest', description: 'Your channels, subscription, and TV setup in one place.',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#141224', theme_color: '#141224', lang: 'en',
    icons: [
      {src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'}
    ],
    shortcuts: [{name: 'Choose channels', url: '/channels'}, {name: 'Movies', url: '/movies'}, {name: 'Renew subscription', url: '/renew'}]
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!HOSTS.has(url.hostname)) return new Response('Not found', {status: 404});
    if (['GET', 'HEAD'].includes(request.method) && url.pathname === '/manifest.webmanifest') {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(portalManifest()), {headers: {'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'}});
    }
    if (['GET', 'HEAD'].includes(request.method) && ASSETS.has(url.pathname)) {
      // Public assets only: never forward customer cookies, credentials, or query strings.
      const asset = await fetch('https://lumanest.tv' + url.pathname, {method: request.method, redirect: 'manual'});
      const headers = new Headers(asset.headers); headers.delete('set-cookie');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (url.pathname === '/sw.js') {headers.set('Cache-Control', 'no-cache'); headers.set('Service-Worker-Allowed', '/');}
      return new Response(asset.body, {status: asset.status, headers});
    }
    // A Worker Route preserves the provider as origin. API, media, auth, and form
    // submissions pass through unchanged; only successful HTML gains app metadata.
    const origin = await fetch(request);
    if (request.method !== 'GET' || origin.status !== 200 || !origin.headers.get('content-type')?.toLowerCase().includes('text/html') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return origin;
    const response = new Response(origin.body, origin);
    response.headers.delete('content-length'); response.headers.delete('etag');
    return new HTMLRewriter()
      .on('head', {element(element) {element.append(HEAD, {html: true});}})
      .on('body', {element(element) {element.append('<script id="lumanest-pwa-script" src="/pwa-install.js" defer></script>', {html: true});}})
      .transform(response);
  }
};
