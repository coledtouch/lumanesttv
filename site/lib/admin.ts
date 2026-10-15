import {ServiceError} from './mybunny';import {requireOwner} from './owner-auth';
export async function requireAdmin(){return requireOwner()}
export function sameOrigin(req:Request){if(req.headers.get('origin')!==new URL(req.url).origin)throw new ServiceError(403,'origin_rejected','This request must come from this website.')}
export function errorResponse(e:unknown){if(e instanceof ServiceError)return Response.json({error:{code:e.code,message:e.message}},{status:e.status,headers:{'Cache-Control':'no-store',...(e.retryAfter?{'Retry-After':e.retryAfter}:{})}});return Response.json({error:{code:'invalid_request',message:e instanceof Error?e.message:'Unable to complete the request.'}},{status:400,headers:{'Cache-Control':'no-store'}})}
