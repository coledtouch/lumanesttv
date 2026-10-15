import {requireAdmin, sameOrigin, errorResponse} from '../../../../lib/admin';
import {setupPayPalWebhook} from '../../../../lib/paypal';

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await requireAdmin();
    return Response.json(await setupPayPalWebhook(new URL(req.url).origin), {headers: {'Cache-Control': 'no-store'}});
  } catch (e) { return errorResponse(e); }
}
