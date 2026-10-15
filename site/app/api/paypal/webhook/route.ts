import {webhook} from '../../../../lib/paypal';import {errorResponse,readJSON} from '../../../../lib/admin';
export async function POST(req:Request){try{return Response.json(await webhook(await readJSON(req,64*1024),req.headers),{headers:{'Cache-Control':'no-store'}})}catch(e){return errorResponse(e)}}
