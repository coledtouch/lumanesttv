import {sameOrigin, errorResponse} from '../../../../lib/admin';
import {rotateRecoveryCode, readOwnerJSON} from '../../../../lib/owner-auth';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const {recoveryCode} = await rotateRecoveryCode(req, await readOwnerJSON(req));
    return Response.json({ok: true, recoveryCode}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return errorResponse(error);}
}
