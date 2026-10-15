import {sameOrigin,errorResponse} from '../../../../lib/admin';import {PLAYER_EXPIRED_COOKIE,revokeSession} from '../../../../lib/player';
// Sign-out always clears the cookie; the sealed session id is also revoked so a copied cookie stops working.
export async function POST(req:Request){try{sameOrigin(req);try{await revokeSession(req)}catch{console.error('lumanest_player_revoke_failed')}return Response.json({signed_out:true},{headers:{'Cache-Control':'no-store','Set-Cookie':PLAYER_EXPIRED_COOKIE}})}catch(e){return errorResponse(e)}}
