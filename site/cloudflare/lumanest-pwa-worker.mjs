const HOSTS = new Set(['portal.lumanest.tv', 'tv.lumanest.tv']);
const ASSETS = new Set(['/sw.js', '/pwa-install.js', '/pwa-install.css', '/pwa/offline.html', '/pwa/offline.css', '/pwa/icon.svg', '/pwa/icon-180.png', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png']);
const HEAD = '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/pwa/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/pwa/icon-180.png"><meta name="theme-color" content="#141224"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="LumaNest TV"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';
const SCRIPT = '<script id="lumanest-pwa-script" src="/pwa-install.js" defer></script>';
// Same-origin resources the injected markup loads, and the CSP directives a browser consults
// for each, in fallback order. Icons are omitted: a blocked icon is only cosmetic.
const CSP_NEEDS = [
  {path: '/pwa-install.js', script: true, directives: ['script-src-elem', 'script-src', 'default-src']},
  {path: '/sw.js', script: true, directives: ['worker-src', 'child-src', 'script-src', 'default-src']},
  {path: '/pwa-install.css', script: false, directives: ['style-src-elem', 'style-src', 'default-src']},
  {path: '/manifest.webmanifest', script: false, directives: ['manifest-src', 'default-src']},
];

// Whether one (lowercased) CSP source expression matches an https URL on this portal host.
// CSP3 lets http: and http:// sources match their https upgrade.
function sourceAllows(source, hostname, path) {
  if (source === '*' || source === "'self'" || source === 'https:' || source === 'http:') return true;
  const match = /^(?:https?:\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}|\*))?(\/[^?#]*)?$/.exec(source);
  if (!match) return false;
  const [, host, port, pathname] = match;
  return (host === '*' || host === hostname || (host.startsWith('*.') && hostname.endsWith(host.slice(1)))) &&
    (!port || port === '*' || port === '443') && (!pathname || (pathname.endsWith('/') ? path.startsWith(pathname) : path === pathname));
}

// Returns the first directive that would block the injected app support, or null. The provider's
// policy is never edited: adding a nonce or hash would disable its 'unsafe-inline' allowances, and
// widening it would weaken the portal's protection. Unknown syntax counts as blocking.
export function cspBlocker(header, hostname, meta = false) {
  if (!header) return null;
  if (header.length > 16384) return 'oversized-policy';
  for (const policy of header.split(',')) {
    const directives = new Map();
    for (const part of policy.split(';')) {
      const [name, ...sources] = part.trim().toLowerCase().split(/[\t\n\f\r ]+/);
      if (name && !directives.has(name)) directives.set(name, sources);
    }
    // A meta-delivered policy cannot sandbox; a header sandbox gives the page an opaque origin.
    if (!meta && directives.has('sandbox')) return 'sandbox';
    for (const need of CSP_NEEDS) {
      const directive = need.directives.find(name => directives.has(name));
      if (!directive) continue;
      const sources = directives.get(directive);
      if ((need.script && sources.includes("'strict-dynamic'")) || !sources.some(source => sourceAllows(source, hostname, need.path))) return directive;
    }
  }
  return null;
}

function skipped(hostname, directive) {
  // Bounded diagnostic: a configured hostname and a fixed directive name, never policy text.
  console.warn(JSON.stringify({event: 'pwa_injection_skipped', host: hostname, directive}));
}

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
      // /sw.js already has the root as its default maximum scope, which the portal needs for its
      // offline navigation fallback, so no Service-Worker-Allowed header is sent or passed through.
      if (url.pathname === '/sw.js') {headers.set('Cache-Control', 'no-cache'); headers.delete('Service-Worker-Allowed');}
      return new Response(asset.body, {status: asset.status, headers});
    }
    // A Worker Route preserves the provider as origin. API, media, auth, and form
    // submissions pass through unchanged; only successful HTML gains app metadata.
    const origin = await fetch(request);
    if (request.method !== 'GET' || origin.status !== 200 || !origin.headers.get('content-type')?.toLowerCase().includes('text/html') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return origin;
    // Injected markup a provider CSP would block is left out rather than failing silently.
    let blocked = cspBlocker(origin.headers.get('content-security-policy'), url.hostname);
    if (blocked) {skipped(url.hostname, blocked); return origin;}
    const response = new Response(origin.body, origin);
    response.headers.delete('content-length'); response.headers.delete('etag');
    return new HTMLRewriter()
      .on('meta[http-equiv]', {element(element) {
        if (blocked || element.getAttribute('http-equiv').trim().toLowerCase() !== 'content-security-policy') return;
        blocked = cspBlocker(element.getAttribute('content'), url.hostname, true);
        if (blocked) skipped(url.hostname, blocked);
      }})
      // Insert at the end tags, after any meta policy in the head has been seen.
      .on('head', {element(element) {element.onEndTag(end => {if (!blocked) end.before(HEAD, {html: true});});}})
      .on('body', {element(element) {element.onEndTag(end => {if (!blocked) end.before(SCRIPT, {html: true});});}})
      .transform(response);
  }
};
