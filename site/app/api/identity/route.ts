import {getOwner} from '../../../lib/owner-auth';
import {errorResponse} from '../../../lib/admin';
export async function GET(){try{const user=await getOwner();return Response.json(user?{id:user.userId,email:user.email}:{error:'Sign in required'},{status:user?200:401,headers:{'Cache-Control':'no-store'}})}catch(error){return errorResponse(error)}}
