// Lives under /api/player so the web player's session cookie (Path=/api/player) is sent.
import {errorResponse, readJSON, sameOrigin} from '../../../../lib/admin';
import {approvePairing, describePairing} from '../../../../lib/pairing';

export async function GET(req: Request) {
  try {return Response.json(await describePairing(req, new URL(req.url).searchParams.get('code') || ''), {headers: {'Cache-Control': 'no-store'}});}
  catch (e) {return errorResponse(e);}
}
export async function POST(req: Request) {
  try {sameOrigin(req); return Response.json(await approvePairing(req, await readJSON(req, 512)), {headers: {'Cache-Control': 'no-store'}});}
  catch (e) {return errorResponse(e);}
}
