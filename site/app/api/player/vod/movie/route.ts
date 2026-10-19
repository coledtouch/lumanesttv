// One movie's details for the web player (lib/player-vod.ts).
import {errorResponse} from '../../../../../lib/admin';
import {ServiceError} from '../../../../../lib/mybunny';
import {PLAYER_EXPIRED_COOKIE} from '../../../../../lib/player';
import {vodMovie} from '../../../../../lib/player-vod';

export async function GET(req: Request) {
  try {return await vodMovie(req);}
  catch (e) {
    const response = errorResponse(e);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (e instanceof ServiceError && e.status === 401 && e.code.startsWith('player_')) response.headers.set('Set-Cookie', PLAYER_EXPIRED_COOKIE);
    return response;
  }
}
