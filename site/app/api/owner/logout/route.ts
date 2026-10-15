import {sameOrigin, errorResponse} from '../../../../lib/admin';
import {logoutOwner, readOwnerJSON, OWNER_EXPIRED_COOKIE} from '../../../../lib/owner-auth';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await logoutOwner(req, await readOwnerJSON(req));
    return Response.json({ok: true}, {headers: {'Cache-Control': 'no-store', 'Set-Cookie': OWNER_EXPIRED_COOKIE}});
  } catch (error) {return errorResponse(error);}
}
