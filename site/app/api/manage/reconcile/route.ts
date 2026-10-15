import {requireAdmin, sameOrigin, errorResponse, readJSON} from '../../../../lib/admin';
import {ServiceError} from '../../../../lib/mybunny';
import {reviewQueue, reconcileOrder, resolveOrder, reconcileSubscription} from '../../../../lib/reconcile';
import {cleanup} from '../../../../lib/maintenance';
const headers = {'Cache-Control': 'private, no-store'};
export async function GET() {
  try {
    await requireAdmin();
    // Opening the review queue also runs housekeeping; it is idempotent and cheap.
    try {await cleanup();} catch {console.error('lumanest_cleanup_failed');}
    return Response.json(await reviewQueue(), {headers});
  } catch (error) {return errorResponse(error);}
}
export async function POST(req: Request) {
  try {
    sameOrigin(req); await requireAdmin();
    const input = await readJSON(req, 4096) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError(400, 'invalid_request', 'Choose a record to review.');
    const id = typeof input.id === 'string' ? input.id : '';
    const result = input.action === 'cleanup' ? {cleaned: await cleanup()} :
      input.action === 'recheck' && input.kind === 'order' ? await reconcileOrder(id) :
      input.action === 'recheck' && input.kind === 'subscription' ? await reconcileSubscription(id) :
      input.action === 'resolve' && input.kind === 'order' ? await resolveOrder(id, input.note) : null;
    if (!result) throw new ServiceError(400, 'invalid_request', 'Choose a supported review action.');
    return Response.json(result, {headers});
  } catch (error) {return errorResponse(error);}
}
