// Fetched by Chromecast and AirPlay receivers, which send no cookies and may run on another origin.
import {errorResponse} from '../../../../lib/admin';
import {castHeaders, castMedia} from '../../../../lib/player';

export function OPTIONS() {return new Response(null, {status: 204, headers: {...castHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400'}});}
export async function GET(req: Request) {
  try {return await castMedia(req);}
  catch (e) {const res = errorResponse(e); for (const [k, v] of Object.entries(castHeaders)) res.headers.set(k, v); return res;}
}
