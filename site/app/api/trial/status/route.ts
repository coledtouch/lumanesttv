import {errorResponse, sameOrigin} from '../../../../lib/admin';
import {trialStatus} from '../../../../lib/trials';
const headers = {'Cache-Control': 'private, no-store'};
// The requester's private status link: the token travels in the body, never in a URL the server sees.
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json(await trialStatus(req), {headers});
  } catch (error) {return errorResponse(error);}
}
