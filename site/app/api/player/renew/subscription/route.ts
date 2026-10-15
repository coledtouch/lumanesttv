import {sameOrigin, errorResponse} from '../../../../../lib/admin';
import {readRenewalJSON} from '../../../../../lib/renewal';
import {subscriptionStatus, enrollSubscription} from '../../../../../lib/subscriptions';
const headers = {'Cache-Control': 'private, no-store'};
export async function GET(req: Request) {
  try {return Response.json(await subscriptionStatus(req), {headers});}
  catch (error) {return errorResponse(error);}
}
export async function POST(req: Request) {
  try {sameOrigin(req); return Response.json(await enrollSubscription(req, await readRenewalJSON(req)), {headers});}
  catch (error) {return errorResponse(error);}
}
