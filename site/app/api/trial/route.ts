import {errorResponse, sameOrigin} from '../../../lib/admin';
import {requestTrial} from '../../../lib/trials';
const headers = {'Cache-Control': 'private, no-store'};
// A visitor's free 24-hour trial request (docs/trials.md). It only queues the request for the owner.
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json(await requestTrial(req), {headers});
  } catch (error) {return errorResponse(error);}
}
