// Under /api/player so the web player's session cookie is sent; returns a cookie-free link a TV can play.
import {errorResponse, readJSON, sameOrigin} from '../../../../lib/admin';
import {createCast} from '../../../../lib/player';

export async function POST(req: Request) {
  try {sameOrigin(req); return Response.json(await createCast(req, await readJSON(req, 8192)), {headers: {'Cache-Control': 'no-store'}});}
  catch (e) {return errorResponse(e);}
}
