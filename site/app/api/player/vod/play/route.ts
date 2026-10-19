// A stream token for one movie or episode (lib/player-vod.ts). The address is built on the server; the browser only
// names the title.
import {errorResponse, readJSON, sameOrigin} from '../../../../../lib/admin';
import {ServiceError} from '../../../../../lib/mybunny';
import {PLAYER_EXPIRED_COOKIE} from '../../../../../lib/player';
import {vodPlay} from '../../../../../lib/player-vod';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json(await vodPlay(req, await readJSON(req, 512)), {headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (e) {
    const response = errorResponse(e);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (e instanceof ServiceError && e.status === 401 && e.code.startsWith('player_')) response.headers.set('Set-Cookie', PLAYER_EXPIRED_COOKIE);
    return response;
  }
}
