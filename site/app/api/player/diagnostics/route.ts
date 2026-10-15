import {requireAdmin, errorResponse} from '../../../../lib/admin';
import {diagnostics} from '../../../../lib/player';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    return Response.json(await diagnostics(req), {headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (error) {return errorResponse(error);}
}
