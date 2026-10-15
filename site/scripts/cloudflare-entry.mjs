// Copied beside the built Vinext index by prepare-cloudflare.mjs.
import application from './index.js';

const worker = {
  ...application,
  async fetch(request, env, ctx) {
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      // Only the former managed hosting gateway could vouch for these headers.
      if (name.toLowerCase().startsWith('oai-authenticated-')) headers.delete(name);
    }
    const cleanRequest = new Request(request, {headers, signal: request.signal});
    let response;
    try {
      response = await application.fetch(cleanRequest, env, ctx);
    } catch {
      // Never log the request URL, cookies, body, credentials or raw exception.
      console.error('lumanest_standalone_request_failed');
      response = Response.json({error: {code: 'service_unavailable', message: 'Something went wrong. Please try again.'}}, {
        status: 503,
        headers: {'Cache-Control': 'no-store'},
      });
    }
    const result = new Response(response.body, response);
    result.headers.set('X-LumaNest-Hosting', 'cloudflare');
    return result;
  },
};

export default worker;
