import {requireAdmin, sameOrigin, errorResponse, readJSON} from '../../../../lib/admin';
import {ServiceError, settings} from '../../../../lib/mybunny';
import {trialQueue, approveTrial, declineTrial, resolveTrial, ownerTrials, trialsReady} from '../../../../lib/trials';
import {cleanup} from '../../../../lib/maintenance';
import {trialAlertStatus} from '../../../../lib/trial-alert-send';
const headers = {'Cache-Control': 'private, no-store'};
export async function GET() {
  try {
    await requireAdmin();
    // Opening the trial queue also runs housekeeping (ending expired trials); it is idempotent and cheap.
    try {await cleanup();} catch {console.error('lumanest_cleanup_failed');}
    // ready/enabled tell the owner whether visitors can ask for a trial at all, and why not; alerts whether new
    // requests are emailed to them (lib/trial-alert-send.ts), so alerts that stopped (no binding) don't go unnoticed.
    return Response.json({...await ownerTrials(() => trialQueue()), ready: trialsReady(), enabled: settings().TRIALS_ENABLED === 'true', alerts: trialAlertStatus()}, {headers});
  } catch (error) {return errorResponse(error);}
}
export async function POST(req: Request) {
  try {
    sameOrigin(req); await requireAdmin();
    const input = await readJSON(req, 4096) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError(400, 'invalid_request', 'Choose a trial request.');
    const result = await ownerTrials(async () => input.action === 'approve' ? approveTrial(input.id, input.line_id) :
      input.action === 'decline' ? declineTrial(input.id, input.message) :
      input.action === 'resolve' ? resolveTrial(input.id, input.note) : null);
    if (!result) throw new ServiceError(400, 'invalid_request', 'Choose a supported trial action.');
    return Response.json(result, {headers});
  } catch (error) {return errorResponse(error);}
}
