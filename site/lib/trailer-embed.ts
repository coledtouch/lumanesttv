// The trailer page the Samsung and LG apps show in a full-screen iframe, so a trailer plays inside Tuner and Back
// returns to the details page (docs/extras.md, "Trailer in the app"): https://lumanest.tv/embed/trailer?v=1&k=<key>.
// YouTube refuses embeds without an https origin and Referer (errors 152 and 153), and the apps run from file:// or
// an app scheme, so the YouTube player lives on this page; public/embed/trailer-frame.js runs it and talks to the app
// with postMessage. The page names nothing of YouTube's: that script adds YouTube's IFrame API only when it is to make
// the player (framed, and not by another website), so the page opened on its own asks nothing of YouTube. Any page may
// frame it: there is deliberately no frame-ancestors directive and no X-Frame-Options (a CSP source list cannot name
// file: or null parents). The page holds only the validated 11-character key.

export const TRAILER_KEY = /^[A-Za-z0-9_-]{11}$/;

// ?v= is the first 12 hex digits of each file's SHA-256 (tests/trailer-embed.test.ts checks them), so a TV that kept
// the page for a day still asks for the files it was written for, and a changed file gets a new address.
export const FRAME_SCRIPT = '/embed/trailer-frame.js?v=75a522801528';
export const FRAME_STYLE = '/embed/trailer-frame.css?v=1fe77a878b6e';

// Only what the YouTube IFrame API needs: its loader and widget script on www.youtube.com (s.ytimg.com is its older
// host), the player frame on youtube-nocookie.com (www.youtube.com if YouTube redirects), and its thumbnails. child-src
// repeats frame-src for engines from the CSP 2 years that read frames from child-src.
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  'child-src https://www.youtube-nocookie.com https://www.youtube.com',
  'img-src https://i.ytimg.com https://s.ytimg.com',
  "style-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const FRAME_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': FRAME_CSP,
  // YouTube must see https://lumanest.tv as the embedding origin, and nothing more of the address.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'public, max-age=86400',
  'X-Robots-Tag': 'noindex',
});

export const BAD_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
});

export const BAD_REQUEST_PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Bad request</title>\n</head>\n<body>\n<p>Bad request</p>\n</body>\n</html>\n';

// The YouTube key from exactly one v=1 and exactly one valid k, or null. Other parameters are ignored.
export function trailerEmbedKey(url: URL): string | null {
  const versions = url.searchParams.getAll('v');
  const keys = url.searchParams.getAll('k');
  if (versions.length !== 1 || versions[0] !== '1' || keys.length !== 1 || !TRAILER_KEY.test(keys[0])) return null;
  return keys[0];
}

export function trailerEmbedPage(key: string): string {
  if (!TRAILER_KEY.test(key)) throw new Error('Invalid trailer key.');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Trailer</title>\n' +
    '<link rel="stylesheet" href="' + FRAME_STYLE + '">\n</head>\n<body>\n' +
    '<div id="player" data-k="' + key + '"></div>\n' +
    '<script src="' + FRAME_SCRIPT + '"></script>\n' +
    '</body>\n</html>\n';
}

// GET and HEAD of /embed/trailer: the player page, or a plain 400 that repeats nothing from the request.
export function trailerEmbedResponse(request: Request): Response {
  const head = request.method === 'HEAD';
  let key: string | null = null;
  try {key = trailerEmbedKey(new URL(request.url));} catch {}
  if (!key) return new Response(head ? null : BAD_REQUEST_PAGE, {status: 400, headers: BAD_REQUEST_HEADERS});
  return new Response(head ? null : trailerEmbedPage(key), {status: 200, headers: FRAME_HEADERS});
}
