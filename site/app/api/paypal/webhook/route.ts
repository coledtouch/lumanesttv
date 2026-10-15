import {webhook} from '../../../../lib/paypal';import {errorResponse} from '../../../../lib/admin';
export async function POST(req:Request){try{return Response.json(await webhook(await req.json(),req.headers))}catch(e){return errorResponse(e)}}
