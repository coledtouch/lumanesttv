import {ServiceError} from './mybunny.ts';
import {db, paypal, status, captureCheckout, fulfill, type Order} from './paypal.ts';
import {verifiedOrder, verifiedCapture, type PayPalOrder, type PayPalPurchaseUnit} from './payment-validation.ts';
import {assertPayOnceAllowed, refreshAgreement, type Agreement} from './subscriptions.ts';

const reference = /^[A-Za-z0-9-]{1,64}$/;
const closed = ['CANCELLED', 'EXPIRED'];
function notFound() {return new ServiceError(404, 'review_not_found', 'This record was not found.');}
async function current(id: string, extra: Record<string, unknown> = {}) {return {id, ...await status(id), ...extra};}
const attemptedMessage = 'Provider activation was already attempted. Check the line and wallet transactions, then mark this order resolved with a note. It is never retried automatically.';

export async function reviewQueue() {
  const orders = await db().prepare("SELECT id,paypal_id,kind,line_id,devices,months,amount,state,attempted,capture_id,error,created FROM orders WHERE state='needs_review' ORDER BY created DESC LIMIT 100").all<Record<string, unknown>>();
  const subscriptions = await db().prepare("SELECT id,paypal_id,line_id,line_slot,devices,months,amount,state,mode,error,created,updated FROM subscriptions WHERE state IN ('needs_review','creating') ORDER BY created DESC LIMIT 100").all<Record<string, unknown>>();
  return {orders: (orders.results || []).map(row => ({...row, attempted: row.attempted !== null, resolve_required: row.attempted !== null})), subscriptions: subscriptions.results || []};
}

// Re-reads PayPal for an order in review. Every transition is a conditional UPDATE from needs_review,
// and an order whose provider activation was attempted is never charged against the wallet again.
export async function reconcileOrder(id: string) {
  if (!reference.test(id)) throw notFound();
  const row = await db().prepare('SELECT * FROM orders WHERE id=?').bind(id).first<Order>();
  if (!row) throw notFound();
  if (row.state !== 'needs_review') return current(id);
  if (row.attempted !== null) return current(id, {resolve_required: true, message: attemptedMessage});
  if (!row.paypal_id) {
    // PayPal never returned a checkout link, so the customer had nothing to approve or pay.
    await db().prepare("UPDATE orders SET state='abandoned',error='checkout_not_created' WHERE id=? AND state='needs_review' AND paypal_id IS NULL AND attempted IS NULL AND capture_id IS NULL").bind(id).run();
    return current(id);
  }
  const remote = await paypal<PayPalOrder>('/v2/checkout/orders/' + row.paypal_id);
  let unit: PayPalPurchaseUnit;
  try {unit = verifiedOrder(row, remote);}
  catch {throw new ServiceError(409, 'review_order_mismatch', 'PayPal returned order details that do not match this checkout. Review it in PayPal, then mark it resolved.');}
  const captured = Array.isArray(unit.payments?.captures) && unit.payments.captures.length > 0;
  if (remote?.status === 'APPROVED' && !captured && !row.capture_id) {
    if (row.kind === 'renew' && row.line_id) await assertPayOnceAllowed(row.line_id);
    const reset = await db().prepare("UPDATE orders SET state='created',error=NULL WHERE id=? AND state='needs_review' AND attempted IS NULL AND capture_id IS NULL").bind(id).run();
    if (reset.meta.changes !== 1) return current(id);
    try {return {id, ...await captureCheckout(id, row.paypal_id)};}
    catch (error) {
      await db().prepare("UPDATE orders SET state='needs_review',error=? WHERE id=? AND state='created' AND attempted IS NULL").bind(error instanceof ServiceError ? error.code : 'capture_not_verified', id).run();
      throw error;
    }
  }
  if (remote?.status === 'COMPLETED') {
    try {verifiedCapture(row, remote);}
    catch {return current(id, {message: 'PayPal has not confirmed a completed capture for the full amount yet. Check again later or review it in PayPal.'});}
    if (row.kind === 'renew' && row.line_id) await assertPayOnceAllowed(row.line_id);
    return {id, ...await fulfill(row, remote)};
  }
  if (['CREATED', 'PAYER_ACTION_REQUIRED'].includes(remote?.status ?? '') && !captured && !row.capture_id) {
    // Not yet approved by the customer: return it to the normal checkout flow.
    await db().prepare("UPDATE orders SET state='created',error=NULL WHERE id=? AND state='needs_review' AND attempted IS NULL AND capture_id IS NULL").bind(id).run();
    return current(id);
  }
  if (remote?.status === 'VOIDED' && !captured && !row.capture_id) {
    await db().prepare("UPDATE orders SET state='abandoned',error='paypal_order_voided' WHERE id=? AND state='needs_review' AND attempted IS NULL AND capture_id IS NULL").bind(id).run();
    return current(id);
  }
  return current(id, {message: 'PayPal reports this order as ' + String(remote?.status).slice(0, 40).replace(/[^A-Z_]/g, '') + '. Nothing was changed.'});
}

export async function resolveOrder(id: string, note: unknown) {
  if (!reference.test(id)) throw notFound();
  if (typeof note !== 'string' || note.trim().length < 3 || note.length > 500 || /[\x00-\x08\x0b-\x1f\x7f]/.test(note)) throw new ServiceError(400, 'resolution_note_required', 'Describe how this order was resolved (3–500 characters).');
  const result = await db().prepare("UPDATE orders SET state='resolved',resolution=?,resolved=? WHERE id=? AND state='needs_review'").bind(note.trim(), Date.now(), id).run();
  if (result.meta.changes !== 1 && !await db().prepare('SELECT id FROM orders WHERE id=?').bind(id).first()) throw notFound();
  return current(id);
}

export async function reconcileSubscription(id: string) {
  if (!reference.test(id)) throw notFound();
  const row = await db().prepare('SELECT * FROM subscriptions WHERE id=?').bind(id).first<Agreement>();
  if (!row) throw notFound();
  if (!row.paypal_id) {
    if (!['creating', 'needs_review'].includes(row.state)) return {id, state: row.state, line_released: row.line_slot === null};
    // A recent enrollment may still be waiting for PayPal; anything older never received an agreement.
    if (row.state === 'creating' && row.created > Date.now() - 5 * 60 * 1000) return {id, state: row.state, line_released: false, message: 'This enrollment started moments ago. Check again in a few minutes.'};
    await db().prepare("UPDATE subscriptions SET state='CANCELLED',line_slot=NULL,error=COALESCE(error,'enrollment_not_created'),updated=? WHERE id=? AND paypal_id IS NULL AND state IN ('creating','needs_review')").bind(Date.now(), id).run();
  } else await refreshAgreement(row);
  const saved = await db().prepare('SELECT state,line_slot FROM subscriptions WHERE id=?').bind(id).first<{state: string; line_slot: number | null}>();
  return {id, state: saved?.state || 'not_found', line_released: saved?.line_slot === null, message: saved && closed.includes(saved.state) ? 'The agreement is closed and the line is released.' : saved?.state === 'needs_review' ? 'PayPal still has this agreement open. It stays in review; billing is paused where PayPal allows it.' : null};
}
