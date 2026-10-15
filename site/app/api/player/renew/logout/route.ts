import {sameOrigin, errorResponse} from '../../../../../lib/admin';
import {RENEWAL_EXPIRED_COOKIE} from '../../../../../lib/renewal';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json({signed_out: true}, {headers: {'Cache-Control': 'private, no-store', 'Set-Cookie': RENEWAL_EXPIRED_COOKIE}});
  } catch (error) {return errorResponse(error);}
}
