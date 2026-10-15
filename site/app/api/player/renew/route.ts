import {errorResponse} from '../../../../lib/admin';
import {renewalQuote} from '../../../../lib/renewal';

export async function GET(req: Request) {
  try {return Response.json(await renewalQuote(req), {headers: {'Cache-Control': 'private, no-store'}});}
  catch (error) {return errorResponse(error);}
}
