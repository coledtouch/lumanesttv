import {media} from '../../../../lib/player';import {errorResponse} from '../../../../lib/admin';
export async function GET(req:Request){try{return await media(req)}catch(e){return errorResponse(e)}}
