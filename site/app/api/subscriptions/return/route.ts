import {errorResponse} from '../../../../lib/admin';
import {subscriptionReturn} from '../../../../lib/subscriptions';
export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    return Response.json(await subscriptionReturn(query.get('subscription') || '', query.get('subscription_id') || ''), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return errorResponse(error);}
}
