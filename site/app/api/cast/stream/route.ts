// Fetched by Chromecast and AirPlay receivers, which send no cookies and may run on another origin.
import {errorResponse} from '../../../../lib/admin';
import {castHeaders, castMedia} from '../../../../lib/player';

export function OPTIONS() {return new Response(null, {status: 204, headers: {...castHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400'}});}
export async function GET(req: Request) {
  try {return await castMedia(req);}
  catch (e) {
    // Visible with `wrangler tail`: why a TV's request failed, without the link or the line login.
    console.warn('lumanest_cast_failed', JSON.stringify({path: new URL(req.url).pathname, code: (e as {code?: string})?.code || 'error'}));
    const res = errorResponse(e); for (const [k, v] of Object.entries(castHeaders)) res.headers.set(k, v); return res;
  }
}
// Some receivers ask for a segment's type with HEAD before playing it.
export async function HEAD(req: Request) {
  const res = await GET(req);
  await res.body?.cancel();
  return new Response(null, {status: res.status, headers: res.headers});
}
