import {errorResponse, readJSON} from '../../../../lib/admin';
import {corsHeaders, startPairing} from '../../../../lib/pairing';

// Called by the TV apps, which are not browser pages on this site: allow any origin, never send cookies.
export function OPTIONS() {return new Response(null, {status: 204, headers: corsHeaders});}
export async function POST(req: Request) {
  let res: Response;
  try {res = Response.json(await startPairing(req, await readJSON(req, 512)), {headers: {'Cache-Control': 'no-store'}});}
  catch (e) {res = errorResponse(e);}
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}
