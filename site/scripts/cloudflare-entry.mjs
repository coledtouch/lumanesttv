// Copied beside the built Vinext index by prepare-cloudflare.mjs.
import {AsyncLocalStorage} from 'node:async_hooks';
import application from './index.js';

// A live channel or cast is one response that can stay open for hours, and Workers bill the CPU time of every
// JavaScript stream layer per chunk against it. Vinext wraps each route response body in such layers, so media GETs
// run inside this store: lib/player.ts (serveMedia) leaves its native body here and returns the same status and
// headers to Vinext with no body. Routing, the proxy, sign-in, CORS and errors all still go through Vinext and the
// same route handlers; only the body skips Vinext's wrappers.
const mediaHandoffs = new AsyncLocalStorage();
globalThis[Symbol.for('lumanest.mediaHandoff')] = mediaHandoffs;
const MEDIA_HANDOFF_HEADER = 'X-LumaNest-Media-Handoff';
const MEDIA_PATH = /^\/api\/(?:player\/stream|cast\/[^/]+)$/;

const worker = {
  ...application,
  async fetch(request, env, ctx) {
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      // Only the former managed hosting gateway could vouch for these headers.
      if (name.toLowerCase().startsWith('oai-authenticated-')) headers.delete(name);
    }
    const cleanRequest = new Request(request, {headers, signal: request.signal});
    const handoff = request.method === 'GET' && MEDIA_PATH.test(new URL(request.url).pathname) ? {} : undefined;
    let response;
    try {
      response = await (handoff ? mediaHandoffs.run(handoff, () => application.fetch(cleanRequest, env, ctx)) : application.fetch(cleanRequest, env, ctx));
    } catch {
      // Never log the request URL, cookies, body, credentials or raw exception.
      console.error('lumanest_standalone_request_failed');
      response = Response.json({error: {code: 'service_unavailable', message: 'Something went wrong. Please try again.'}}, {
        status: 503,
        headers: {'Cache-Control': 'no-store'},
      });
    }
    let body = response.body;
    if (handoff?.body) {
      // Only on the response the media route built. Anything else keeps its own body, and the stream (with its
      // provider connection) is cancelled.
      if (body === null && response.status === handoff.status && response.headers.get(MEDIA_HANDOFF_HEADER) === '1') body = handoff.body;
      else handoff.body.cancel().catch(() => {});
    }
    const result = new Response(body, response);
    result.headers.delete(MEDIA_HANDOFF_HEADER);
    result.headers.set('X-LumaNest-Hosting', 'cloudflare');
    return result;
  },
};

export default worker;
