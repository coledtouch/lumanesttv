import {sameOrigin, errorResponse} from '../../../../../../lib/admin';
import {readRenewalJSON} from '../../../../../../lib/renewal';
import {subscriptionLogin} from '../../../../../../lib/subscriptions';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const result = await subscriptionLogin(req, await readRenewalJSON(req));
    return Response.json(result.status, {headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': result.cookie}});
  } catch (error) {return errorResponse(error);}
}
