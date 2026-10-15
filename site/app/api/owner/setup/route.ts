import {sameOrigin, errorResponse} from '../../../../lib/admin';
import {setupOwner, readOwnerJSON, ownerSessionCookie} from '../../../../lib/owner-auth';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const {token, recoveryCode} = await setupOwner(req, await readOwnerJSON(req));
    return Response.json({ok: true, recoveryCode}, {headers: {'Cache-Control': 'no-store', 'Set-Cookie': ownerSessionCookie(token)}});
  } catch (error) {return errorResponse(error);}
}
