import {errorResponse, readJSON} from '../../../../lib/admin';
import {corsHeaders, pollPairing} from '../../../../lib/pairing';

export function OPTIONS() {return new Response(null, {status: 204, headers: corsHeaders});}
export async function POST(req: Request) {
  let res: Response;
  try {res = Response.json(await pollPairing(await readJSON(req, 512)), {headers: {'Cache-Control': 'no-store'}});}
  catch (e) {res = errorResponse(e);}
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}
