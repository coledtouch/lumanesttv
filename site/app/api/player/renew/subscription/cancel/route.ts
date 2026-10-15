import {sameOrigin, errorResponse} from '../../../../../../lib/admin';
import {readRenewalJSON} from '../../../../../../lib/renewal';
import {cancelSubscription} from '../../../../../../lib/subscriptions';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Object.keys(await readRenewalJSON(req)).length) throw new Error('This cancellation does not accept account identifiers.');
    return Response.json(await cancelSubscription(req), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return errorResponse(error);}
}
