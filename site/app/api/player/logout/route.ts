import {sameOrigin,errorResponse} from '../../../../lib/admin';import {PLAYER_EXPIRED_COOKIE} from '../../../../lib/player';
export async function POST(req:Request){try{sameOrigin(req);return Response.json({signed_out:true},{headers:{'Cache-Control':'no-store','Set-Cookie':PLAYER_EXPIRED_COOKIE}})}catch(e){return errorResponse(e)}}
