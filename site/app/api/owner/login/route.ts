import {sameOrigin, errorResponse} from '../../../../lib/admin';
import {loginOwner, readOwnerJSON, ownerSessionCookie} from '../../../../lib/owner-auth';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const {token} = await loginOwner(req, await readOwnerJSON(req));
    return Response.json({ok: true}, {headers: {'Cache-Control': 'no-store', 'Set-Cookie': ownerSessionCookie(token)}});
  } catch (error) {return errorResponse(error);}
}
