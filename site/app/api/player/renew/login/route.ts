import {sameOrigin, errorResponse} from '../../../../../lib/admin';
import {loginRenewal, readRenewalJSON} from '../../../../../lib/renewal';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const result = await loginRenewal(req, await readRenewalJSON(req));
    return Response.json(result.quote, {headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': result.cookie}});
  } catch (error) {return errorResponse(error);}
}
