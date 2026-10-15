import {sameOrigin, errorResponse} from '../../../../../../lib/admin';
import {readRenewalJSON} from '../../../../../../lib/renewal';
import {activateSubscription} from '../../../../../../lib/subscriptions';
export async function POST(req: Request) {
  try {sameOrigin(req); return Response.json(await activateSubscription(req, await readRenewalJSON(req)), {headers: {'Cache-Control': 'private, no-store'}});}
  catch (error) {return errorResponse(error);}
}
