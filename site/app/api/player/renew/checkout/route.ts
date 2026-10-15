import {sameOrigin, errorResponse} from '../../../../../lib/admin';
import {renewalCheckout, readRenewalJSON} from '../../../../../lib/renewal';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json(await renewalCheckout(req, await readRenewalJSON(req)), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return errorResponse(error);}
}
