// The signed-in line's movies and series for the web player's browsing (lib/player-vod.ts). Under /api/player so the
// player's session cookie is sent.
import {errorResponse} from '../../../../lib/admin';
import {ServiceError} from '../../../../lib/mybunny';
import {PLAYER_EXPIRED_COOKIE} from '../../../../lib/player';
import {vodCatalogue} from '../../../../lib/player-vod';

export async function GET(req: Request) {
  try {return await vodCatalogue(req);}
  catch (e) {
    const response = errorResponse(e);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Only a missing or expired player session signs the browser out; a provider refusal does not.
    if (e instanceof ServiceError && e.status === 401 && e.code.startsWith('player_')) response.headers.set('Set-Cookie', PLAYER_EXPIRED_COOKIE);
    return response;
  }
}
