import {requireAdmin, errorResponse} from '../../../../lib/admin';
import {diagnostics} from '../../../../lib/player';
import {vodDiagnostics} from '../../../../lib/player-vod';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    // profile=vod reports the web player's Movies & Series sources (lib/player-vod.ts); the others test one stream.
    const report = new URL(req.url).searchParams.get('profile') === 'vod' ? await vodDiagnostics(req) : await diagnostics(req);
    return Response.json(report, {headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (error) {return errorResponse(error);}
}
