import {sameOrigin, errorResponse} from '../../../../lib/admin';
import {requireOwner} from '../../../../lib/owner-auth';
import {readRenewalJSON} from '../../../../lib/renewal';
import {subscriptionCatalogStatus, setupSubscriptionCatalog, subscriptionQueue} from '../../../../lib/subscriptions';
export async function GET(req: Request) {
  try {
    await requireOwner();
    return Response.json(new URL(req.url).searchParams.get('view') === 'queue' ? await subscriptionQueue() : await subscriptionCatalogStatus(), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return errorResponse(error);}
}
export async function POST(req: Request) {
  try {
    sameOrigin(req); await requireOwner();
    if (Object.keys(await readRenewalJSON(req)).length) throw new Error('Billing plan setup does not accept custom prices.');
    return Response.json(await setupSubscriptionCatalog(new URL(req.url).origin), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {return errorResponse(error);}
}
