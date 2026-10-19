// Posters on provider hosts for the web player (lib/player-vod.ts posterImage). Under /api/player so the player's
// session cookie is sent; a failure is a bare 404/403 and the page shows a title card instead.
import {errorResponse} from '../../../../lib/admin';
import {posterImage} from '../../../../lib/player-vod';

export async function GET(req: Request) {
  try {return await posterImage(req);}
  catch (e) {
    const response = errorResponse(e);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  }
}
