import {z} from 'zod';
import {bunny, settings, ServiceError} from './mybunny.ts';
import {db, paypal, paypalReady, setupPayPalWebhook, PAYPAL_REQUIRED_EVENTS, type PayPalEvent, type PayPalWebhook, type VerifiedPayPalEvent} from './paypal.ts';
import {plans, periods, retailPrice} from './plans.ts';
import {liveFulfillment, verifiedOrder, type PayPalLink, type PayPalOrder} from './payment-validation.ts';
import {activatedLineId, renewalOffer, walletCanActivate, portalReady, type ProviderAccount} from './provider-readiness.ts';
import {ownLine, verifiedRenewalQuote, credentialDigest, lineExpiry, renewalWriteLimit, type RenewalLine} from './renewal.ts';

type CatalogPlan = {sku: string; paypal_plan_id: string | null; product_id: string; devices: number; months: number; amount: string; currency: string; mode: string; state: string; created: number};
export type Agreement = {id: string; paypal_id: string | null; plan_id: string; line_id: number; line_slot: number | null; credential: string; devices: number; months: number; amount: string; currency: string; email: string; name: string; state: string; mode: string; starts_at: string; next_billing_at: string | null; approval_url: string | null; cancel_requested: number; pause_requested: number; pause_confirmed: number; merchant_activation: number; activation_attempted: number | null; created: number; updated: number; error: string | null};
// Untrusted PayPal JSON: only the fields read here, and every value is validated before use.
type PayPalSubscription = {id?: string; plan_id?: string; custom_id?: string; status?: string; start_time?: string; plan_overridden?: unknown;
  billing_info?: {next_billing_time?: unknown; last_payment?: unknown; last_failed_payment?: unknown; final_payment_time?: unknown; failed_payments_count?: unknown; outstanding_balance?: {currency_code?: unknown; value?: unknown} | null; cycle_executions?: unknown} | null};
type PayPalPlan = {id?: string; product_id?: string; status?: string; quantity_supported?: unknown; taxes?: {percentage?: unknown} | null;
  payment_preferences?: {auto_bill_outstanding?: unknown; payment_failure_threshold?: unknown; setup_fee?: {value?: unknown} | null};
  billing_cycles?: ({tenure_type?: unknown; sequence?: unknown; total_cycles?: unknown; frequency?: {interval_unit?: unknown; interval_count?: unknown}; pricing_scheme?: {fixed_price?: {currency_code?: unknown; value?: unknown}; pricing_model?: unknown; tiers?: unknown}} | null)[]};
type PayPalTransaction = {id?: string; status?: string; time?: string; amount_with_breakdown?: {gross_amount?: {currency_code?: unknown; value?: unknown}}};
const subscriptionID = /^I-[A-Z0-9]{1,40}$/;
const planID = /^P-[A-Z0-9]{1,50}$/;
const paymentID = /^[A-Z0-9]{1,40}$/;
const references = z.string().uuid();
const enrollment = z.object({months: z.number().refine(value => periods.includes(value as 3 | 6 | 12)), email: z.string().trim().email().max(254), name: z.string().trim().max(100).regex(/^[^\x00-\x1f\x7f]*$/).default(''), quoteToken: z.string().min(1).max(2048), consent: z.literal(true)}).strict();
const closed = ['CANCELLED', 'EXPIRED'];
function mode() {return liveFulfillment(settings().PAYPAL_MODE) ? 'live' : 'sandbox';}
function unavailable() {return new ServiceError(503, 'recurring_unavailable', 'Auto-renew is temporarily unavailable. You can still use one-time renewal when no billing agreement is open.');}
function invalidPayment() {return new ServiceError(409, 'recurring_payment_unverified', 'This payment requires support review. No renewal was attempted.');}
function iso(value: unknown) {return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;}
function sku(devices: number, months: number) {return `lumanest-${mode()}-${devices}-${months}-${retailPrice(devices, months)}-v1`;}
function money(value: unknown, expected: string) {return typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value).toFixed(2) === expected;}
function noBillingActivity(remote: PayPalSubscription) {
  const billing = remote?.billing_info;
  if (billing === undefined || billing === null) return true;
  if (typeof billing !== 'object' || Array.isArray(billing) || billing.last_payment || billing.last_failed_payment || billing.final_payment_time) return false;
  if (billing.failed_payments_count !== undefined && billing.failed_payments_count !== 0) return false;
  if (billing.outstanding_balance !== undefined && (!billing.outstanding_balance || billing.outstanding_balance.currency_code !== 'USD' || !money(billing.outstanding_balance.value, '0.00'))) return false;
  if (billing.cycle_executions !== undefined && (!Array.isArray(billing.cycle_executions) || billing.cycle_executions.some((cycle: {cycles_completed?: unknown} | null) => !cycle || cycle.cycles_completed !== 0))) return false;
  return true;
}
function planValid(input: unknown, row: CatalogPlan) {
  const value = input as PayPalPlan | null;
  const cycle = value?.billing_cycles;
  return value?.id === row.paypal_plan_id && value.product_id === row.product_id && value.status === 'ACTIVE' &&
    Array.isArray(cycle) && cycle.length === 1 && cycle[0]?.tenure_type === 'REGULAR' && cycle[0].sequence === 1 && cycle[0].total_cycles === 0 &&
    cycle[0].frequency?.interval_unit === 'MONTH' && cycle[0].frequency.interval_count === row.months &&
    cycle[0].pricing_scheme?.fixed_price?.currency_code === 'USD' && money(cycle[0].pricing_scheme.fixed_price.value, row.amount) &&
    value.payment_preferences?.auto_bill_outstanding === false && value.payment_preferences?.payment_failure_threshold === 1 &&
    (!value.payment_preferences.setup_fee || Number(value.payment_preferences.setup_fee.value) === 0) &&
    (!value.taxes || (typeof value.taxes.percentage === 'string' && /^0(?:\.0+)?$/.test(value.taxes.percentage))) && value.quantity_supported !== true && !cycle[0].pricing_scheme.pricing_model && !cycle[0].pricing_scheme.tiers;
}
async function availablePlans() {
  const connection = await db().prepare('SELECT webhook_id FROM subscription_catalog WHERE mode=?').bind(mode()).first<{webhook_id: string | null}>();
  if (!settings().PAYPAL_WEBHOOK_ID || connection?.webhook_id !== settings().PAYPAL_WEBHOOK_ID) return [];
  const result = await db().prepare("SELECT * FROM subscription_plans WHERE mode=? AND state='ready'").bind(mode()).all<CatalogPlan>();
  return (result.results || []).filter(row => row.sku === sku(row.devices, row.months) && row.currency === 'USD' && row.amount === retailPrice(row.devices, row.months).toFixed(2) && planID.test(row.paypal_plan_id || ''));
}
async function lineAgreement(lineId: number) {
  return db().prepare('SELECT * FROM subscriptions WHERE line_id=? ORDER BY (line_slot IS NOT NULL) DESC,created DESC LIMIT 1').bind(lineId).first<Agreement>();
}
async function abandonUnpaidManualOrders(lineId: number) {
  const result = await db().prepare("SELECT id,paypal_id,amount,state,attempted,capture_id FROM orders WHERE kind='renew' AND line_id=? AND state IN ('creating','created','capturing','pending','fulfilling','needs_review') LIMIT 10").bind(lineId).all<{id: string; paypal_id: string | null; amount: string; state: string; attempted: number | null; capture_id: string | null}>();
  for (const row of result.results || []) {
    if (row.state !== 'created' || row.attempted !== null || row.capture_id !== null || !paymentID.test(row.paypal_id || '')) throw new ServiceError(409, 'recurring_manual_order_open', 'An earlier one-time renewal is still processing or needs review. Contact support before enabling auto-renew.');
    const remote = await paypal<PayPalOrder>('/v2/checkout/orders/' + row.paypal_id);
    const unit = verifiedOrder({...row, paypal_id: row.paypal_id!}, remote);
    if (!['CREATED', 'PAYER_ACTION_REQUIRED'].includes(remote?.status ?? '') || unit.payments?.captures?.length || unit.payments?.authorizations?.length) throw new ServiceError(409, 'recurring_manual_order_open', 'An earlier approved or paid one-time renewal must be completed before enabling auto-renew.');
    // The capture path must claim 'created' first. This atomic state change wins or fails that race.
    const changed = await db().prepare("UPDATE orders SET state='abandoned',error='Replaced by customer-approved auto-renew enrollment' WHERE id=? AND state='created' AND attempted IS NULL AND capture_id IS NULL").bind(row.id).run();
    if (changed.meta.changes !== 1) throw new ServiceError(409, 'recurring_manual_order_open', 'Your earlier checkout changed while enrolling. Refresh and check its status.');
  }
}
export async function assertPayOnceAllowed(lineId: number) {
  if (await db().prepare('SELECT id FROM subscriptions WHERE line_slot=? LIMIT 1').bind(lineId).first()) {
    throw new ServiceError(409, 'recurring_agreement_open', 'This line has an open auto-renew agreement. Cancel it and wait for cancellation confirmation before making a separate renewal.');
  }
}
export async function withBillingLineLock<T>(lineId: number, operation: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID(), now = Date.now();
  const acquired = await db().prepare('INSERT INTO billing_line_locks (line_id,token,expires) VALUES (?,?,?) ON CONFLICT(line_id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE expires<?').bind(lineId, token, now + 5 * 60 * 1000, now).run();
  if (acquired.meta.changes !== 1) throw new ServiceError(409, 'recurring_billing_busy', 'Another billing request for this line is processing. Please wait and refresh.');
  try {return await operation();}
  finally {await db().prepare('DELETE FROM billing_line_locks WHERE line_id=? AND token=?').bind(lineId, token).run();}
}
function publicState(row: Agreement) {
  if (row.state === 'needs_review') return 'needs_review';
  return ({ACTIVE: 'active', SUSPENDED: 'suspended', CANCELLED: 'cancelled', EXPIRED: 'expired'} as Record<string, string>)[row.state] || 'approval_pending';
}
async function statusForLine(line: RenewalLine) {
  const [catalog, row] = await Promise.all([availablePlans(), lineAgreement(line.id)]);
  const eligible = line.on_site === true && ['active', 'expired'].includes(line.status);
  let account: ProviderAccount = null;
  if (eligible && paypalReady() && catalog.some(plan => plan.devices === line.devices)) {
    try {account = await bunny('/account') as ProviderAccount;} catch {account = null;}
  }
  const ready = eligible && paypalReady() && catalog.length === 12 && portalReady(account?.site, settings().CUSTOMER_PORTAL_URL, settings().CUSTOMER_PORTAL_PRIMARY_URL);
  const locked = Boolean(row?.line_slot);
  const offers = periods.map(months => {
    const plan = catalog.find(plan => plan.devices === line.devices && plan.months === months);
    let funded = false;
    try {funded = walletCanActivate(account?.balance, renewalOffer(line, months).cost);} catch {}
    return {months, amount: retailPrice(line.devices, months), currency: 'USD' as const, available: Boolean(ready && plan && funded && !locked)};
  });
  const expiry = lineExpiry(line), starts = line.status === 'active' && expiry && Date.parse(expiry) > Date.now() ? expiry : null;
  const activationEligible = Boolean(row && eligible && await credentialDigest(line.username, line.password) === row.credential && (line.status !== 'active' || expiry === iso(row.starts_at)));
  const payment = row ? await db().prepare('SELECT state FROM subscription_payments WHERE subscription_id=? ORDER BY created DESC LIMIT 1').bind(row.id).first<{state: string}>() : null;
  const subscription = row ? {status: publicState(row), months: row.months, amount: Number(row.amount), currency: 'USD' as const, starts_at: iso(row.starts_at), next_billing_at: iso(row.next_billing_at), last_payment_status: payment?.state === 'fulfilled' ? 'fulfilled' as const : payment?.state === 'needs_review' ? 'needs_review' as const : null,
    activation_available: Boolean(activationEligible && row.line_slot && row.merchant_activation && row.state === 'APPROVED' && row.activation_attempted === null && !row.cancel_requested && !row.pause_requested),
    cancel_available: Boolean(row.line_slot && row.paypal_id && !row.cancel_requested),
    message: row.cancel_requested && row.line_slot ? 'Cancellation is queued. PayPal has not activated this agreement yet; it will be cancelled immediately if activated. Do not approve its old link. Manage payments in PayPal if needed.' : row.state === 'needs_review' || payment?.state === 'needs_review' ? row.pause_requested && !row.pause_confirmed ? 'Auto-renew needs support review. PayPal has not confirmed the billing pause; manage automatic payments in PayPal now. Do not pay again for the same renewal.' : 'Auto-renew is paused and needs support review. Do not pay again for the same renewal.' : null} : null;
  return {available: offers.some(offer => offer.available), pay_once_available: !locked && eligible, offers, starts_at: starts, subscription,
    message: locked ? 'Manage or cancel your current auto-renew agreement below.' : offers.some(offer => offer.available) ? null : 'Auto-renew is not currently available for this line. One-time renewal remains available where supported.'};
}
export async function subscriptionStatus(req: Request) {
  const line = await ownLine(req, true), row = await lineAgreement(line.id);
  if (row?.paypal_id && row.line_slot) await refreshAgreement(row);
  return statusForLine(line);
}
export async function subscriptionLogin(req: Request, body: Record<string, unknown>) {
  const {loginRenewal} = await import('./renewal.ts');
  const login = await loginRenewal(req, body, true);
  const signed = new Request(req.url, {headers: {cookie: login.cookie.split(';')[0]}});
  return {status: await subscriptionStatus(signed), cookie: login.cookie};
}
function approvedURL(value: unknown) {
  try {const url = new URL(String(value)); return url.protocol === 'https:' && url.hostname === (mode() === 'live' ? 'www.paypal.com' : 'www.sandbox.paypal.com') && !url.username && !url.password ? url.href : null;} catch {return null;}
}
function canonical(input: unknown, row: Agreement) {
  const value = input as PayPalSubscription | null;
  if (!value || value.id !== row.paypal_id || value.plan_id !== row.plan_id || value.custom_id !== row.id || typeof value.status !== 'string' || !['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(value.status) ||
    typeof value.start_time !== 'string' || !iso(value.start_time) || Math.abs(Date.parse(value.start_time) - Date.parse(row.starts_at)) > 1000 || value.plan_overridden === true) throw invalidPayment();
  return value as PayPalSubscription & {status: string};
}
export async function refreshAgreement(row: Agreement) {
  if (!subscriptionID.test(row.paypal_id || '')) throw unavailable();
  const remote = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
  // Retired merchant-controlled drafts can never be activated by a later old approval link.
  if (!row.line_slot && row.cancel_requested && row.merchant_activation && row.activation_attempted === null && ['APPROVAL_PENDING', 'APPROVED'].includes(remote.status)) return {...row, state: 'CANCELLED'};
  if (row.cancel_requested && ['ACTIVE', 'SUSPENDED'].includes(remote.status)) {
    await paypal('/v1/billing/subscriptions/' + row.paypal_id + '/cancel', 'POST', {reason: 'Customer requested cancellation.'}, 'ln-cancel-' + row.id);
    const cancelled = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
    if (!closed.includes(cancelled.status)) throw new ServiceError(503, 'recurring_cancel_pending', 'PayPal has not confirmed cancellation yet. Please refresh before paying again.');
    remote.status = cancelled.status;
  }
  if ((row.pause_requested || row.state === 'needs_review') && !row.cancel_requested && remote.status === 'ACTIVE') {
    try {
      await paypal('/v1/billing/subscriptions/' + row.paypal_id + '/suspend', 'POST', {reason: 'Billing requires support review.'}, 'ln-pause-' + row.id);
      const paused = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
      remote.status = paused.status;
    } catch {}
  }
  if (row.pause_requested) await db().prepare('UPDATE subscriptions SET pause_confirmed=? WHERE id=?').bind(['SUSPENDED', ...closed].includes(remote.status) ? 1 : 0, row.id).run();
  const state = row.state === 'needs_review' && !closed.includes(remote.status) ? 'needs_review' : remote.status;
  await db().prepare("UPDATE subscriptions SET state=CASE WHEN state='needs_review' AND ? NOT IN ('CANCELLED','EXPIRED') THEN state ELSE ? END,next_billing_at=?,line_slot=?,updated=? WHERE id=?").bind(remote.status, state, iso(remote.billing_info?.next_billing_time), closed.includes(remote.status) ? null : row.line_id, Date.now(), row.id).run();
  return {...row, state, next_billing_at: iso(remote.billing_info?.next_billing_time), line_slot: closed.includes(remote.status) ? null : row.line_id};
}
export async function enrollSubscription(req: Request, body: Record<string, unknown>) {
  const parsed = enrollment.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, 'recurring_consent_required', 'Review the billing period and receipt email, then explicitly choose auto-renew.');
  const input = parsed.data, line = await verifiedRenewalQuote(req, input.quoteToken);
  await renewalWriteLimit(req, line.id);
  const options = await statusForLine(line);
  if (!options.offers.find(offer => offer.months === input.months)?.available) {
    await assertPayOnceAllowed(line.id);
    throw unavailable();
  }
  const catalog = (await availablePlans()).find(plan => plan.devices === line.devices && plan.months === input.months);
  if (!catalog?.paypal_plan_id) throw unavailable();
  if (!planValid(await paypal('/v1/billing/plans/' + catalog.paypal_plan_id), catalog)) throw unavailable();
  const connection = await paypal<PayPalWebhook>('/v1/notifications/webhooks/' + encodeURIComponent(settings().PAYPAL_WEBHOOK_ID));
  const events = connection?.event_types?.map(event => event?.name);
  if (connection?.id !== settings().PAYPAL_WEBHOOK_ID || connection.url !== new URL('/api/paypal/webhook', req.url).href || !Array.isArray(events) || (!events.includes('*') && PAYPAL_REQUIRED_EVENTS.some(event => !events.includes(event)))) throw unavailable();
  const id = crypto.randomUUID(), amount = retailPrice(line.devices, input.months).toFixed(2), expiry = lineExpiry(line);
  if (line.status === 'active' && (!expiry || Date.parse(expiry) <= Date.now() + 30000)) throw new ServiceError(409, 'renewal_quote_changed', 'Your paid-through date changed or is too close. Refresh your renewal options.');
  const startsAt = line.status === 'active' ? expiry! : new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await withBillingLineLock(line.id, async () => {
    await assertPayOnceAllowed(line.id);
    await abandonUnpaidManualOrders(line.id);
    const manual = await db().prepare("SELECT id FROM orders WHERE kind='renew' AND line_id=? AND state IN ('creating','created','capturing','pending','fulfilling','needs_review') LIMIT 1").bind(line.id).first();
    if (manual) throw new ServiceError(409, 'recurring_manual_order_open', 'An earlier one-time renewal is still open. Complete it or contact support before enabling auto-renew.');
    await db().prepare("INSERT INTO subscriptions (id,plan_id,line_id,line_slot,credential,devices,months,amount,currency,email,name,state,mode,starts_at,created,updated,merchant_activation) VALUES (?,?,?,?,?,?,?,?,?,?,?,'creating',?,?,?,?,1)")
      .bind(id, catalog.paypal_plan_id, line.id, line.id, await credentialDigest(line.username, line.password), line.devices, input.months, amount, 'USD', input.email, input.name, mode(), startsAt, Date.now(), Date.now()).run();
  });
  let created = false;
  try {
    const origin = new URL(req.url).origin;
    const result = await paypal<{id?: unknown; links?: PayPalLink[]}>('/v1/billing/subscriptions', 'POST', {plan_id: catalog.paypal_plan_id, custom_id: id, start_time: startsAt,
      subscriber: {email_address: input.email}, application_context: {brand_name: 'LumaNest TV', shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE', return_url: origin + '/renew/return?subscription=' + id, cancel_url: origin + '/renew/cancel'}}, 'ln-sub-' + id);
    const approval = approvedURL(result?.links?.find(link => link?.rel === 'approve')?.href);
    if (typeof result?.id !== 'string' || !subscriptionID.test(result.id) || !approval) throw new ServiceError(502, 'recurring_response_invalid', 'PayPal did not confirm an enrollment link. Contact support before trying again.');
    await db().prepare("UPDATE subscriptions SET paypal_id=?,approval_url=?,state='APPROVAL_PENDING',updated=? WHERE id=? AND state='creating'").bind(result.id, approval, Date.now(), id).run();
    created = true;
    const row = await db().prepare('SELECT * FROM subscriptions WHERE id=?').bind(id).first<Agreement>();
    if (!row) throw unavailable();
    await refreshAgreement(row);
    return {approval_url: approval, subscription_id: id, starts_at: startsAt, amount: Number(amount), currency: 'USD', months: input.months};
  } catch (error) {
    // A stored agreement stays cancellable. A rejected create request made nothing to approve,
    // so release the line instead of blocking every later renewal on support review.
    if (created) {}
    else if (error instanceof ServiceError && ['paypal_error', 'paypal_auth_failed', 'paypal_not_configured'].includes(error.code)) await db().prepare("UPDATE subscriptions SET state='CANCELLED',line_slot=NULL,error='enrollment_not_created',updated=? WHERE id=? AND state='creating'").bind(Date.now(), id).run();
    else await db().prepare("UPDATE subscriptions SET state='needs_review',error='enrollment_not_confirmed',updated=? WHERE id=? AND line_slot IS NOT NULL").bind(Date.now(), id).run();
    if (error instanceof ServiceError) throw error;
    throw unavailable();
  }
}
export async function cancelSubscription(req: Request) {
  const line = await ownLine(req, true);
  await renewalWriteLimit(req, line.id);
  await withBillingLineLock(line.id, async () => {
    const row = await lineAgreement(line.id);
    if (!row?.line_slot) return;
    if (!row.paypal_id) throw new ServiceError(503, 'recurring_review_required', 'Enrollment status needs support review. You can also manage automatic payments directly in PayPal.');
    const remote = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
    if (row.merchant_activation && row.activation_attempted === null && ['APPROVAL_PENDING', 'APPROVED'].includes(remote.status)) {
      const receipt = await db().prepare('SELECT sale_id FROM subscription_payments WHERE subscription_id=? LIMIT 1').bind(row.id).first();
      const plan = await db().prepare('SELECT * FROM subscription_plans WHERE paypal_plan_id=? AND mode=?').bind(row.plan_id, row.mode).first<CatalogPlan>();
      // CONTINUE drafts are activated only by our server. Canonical never-active
      // status plus our durable activation/payment records is sufficient proof;
      // the transactions endpoint is not needed for an unactivated draft.
      if (receipt || !noBillingActivity(remote) || !plan || !planValid(await paypal('/v1/billing/plans/' + row.plan_id), plan)) throw new ServiceError(409, 'recurring_review_required', 'This draft has billing activity or unconfirmed terms. Contact support before paying again.');
      await db().prepare("UPDATE subscriptions SET cancel_requested=1,state='CANCELLED',line_slot=NULL,updated=? WHERE id=? AND activation_attempted IS NULL AND merchant_activation=1").bind(Date.now(), row.id).run();
      return;
    }
    await db().prepare('UPDATE subscriptions SET cancel_requested=1,updated=? WHERE id=?').bind(Date.now(), row.id).run();
    await refreshAgreement({...row, cancel_requested: 1});
  });
  return statusForLine(line);
}
export async function activateSubscription(req: Request, body: Record<string, unknown>) {
  const parsed = z.union([z.object({subscription: references, subscription_id: z.string().regex(subscriptionID)}).strict(), z.object({}).strict()]).safeParse(body);
  if (!parsed.success) throw new ServiceError(400, 'recurring_activation_invalid', 'Return from your own PayPal approval to complete enrollment.');
  const line = await ownLine(req);
  await renewalWriteLimit(req, line.id);
  let localID = '', paypalID = '';
  await withBillingLineLock(line.id, async () => {
    const input = parsed.data as {subscription?: string; subscription_id?: string};
    const row = input.subscription ? await db().prepare('SELECT * FROM subscriptions WHERE id=? AND paypal_id=? AND line_id=? AND mode=?').bind(input.subscription, input.subscription_id, line.id, mode()).first<Agreement>() : await lineAgreement(line.id);
    if (!row || row.cancel_requested || !row.line_slot || row.pause_requested || row.state === 'needs_review' || !row.merchant_activation) throw new ServiceError(409, 'recurring_activation_closed', 'This enrollment was cancelled or needs review. Start with your current billing options.');
    localID = row.id; paypalID = row.paypal_id || '';
    const remote = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
    if (remote.status === 'ACTIVE') return;
    if (remote.status !== 'APPROVED') throw new ServiceError(409, 'recurring_approval_pending', 'PayPal has not confirmed your approval yet. Please check again shortly.');
    if (row.activation_attempted !== null) throw new ServiceError(409, 'recurring_review_required', 'An activation attempt needs support review before continuing.');
    let fresh: RenewalLine;
    try {fresh = await bunny('/lines/' + row.line_id) as RenewalLine;} catch {throw unavailable();}
    if (fresh.id !== row.line_id || fresh.devices !== row.devices || fresh.on_site !== true || !['active', 'expired'].includes(fresh.status) ||
      await credentialDigest(fresh.username, fresh.password) !== row.credential || (fresh.status === 'active' && lineExpiry(fresh) !== iso(row.starts_at))) throw new ServiceError(409, 'renewal_quote_changed', 'Your line or paid-through date changed after approval. Cancel this draft and review your current options.');
    const plan = await db().prepare('SELECT * FROM subscription_plans WHERE paypal_plan_id=? AND mode=?').bind(row.plan_id, mode()).first<CatalogPlan>();
    if (!plan || !planValid(await paypal('/v1/billing/plans/' + row.plan_id), plan)) throw unavailable();
    await db().prepare('UPDATE subscriptions SET activation_attempted=?,updated=? WHERE id=? AND activation_attempted IS NULL AND cancel_requested=0').bind(Date.now(), Date.now(), row.id).run();
    try {
      await paypal('/v1/billing/subscriptions/' + row.paypal_id + '/activate', 'POST', {reason: 'Customer approved the displayed auto-renew terms.'}, 'ln-activate-' + row.id);
      const active = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
      if (active.status !== 'ACTIVE') throw unavailable();
      await db().prepare("UPDATE subscriptions SET state='ACTIVE',next_billing_at=?,updated=? WHERE id=? AND cancel_requested=0 AND pause_requested=0").bind(iso(active.billing_info?.next_billing_time), Date.now(), row.id).run();
    } catch (error) {await pause({...row, activation_attempted: Date.now()}, 'activation_not_confirmed'); throw error;}
  });
  return subscriptionReturn(localID, paypalID);
}
export async function subscriptionReturn(localID: string, paypalID: string) {
  if (!references.safeParse(localID).success || !subscriptionID.test(paypalID)) throw new ServiceError(404, 'subscription_not_found', 'Enrollment was not found.');
  const row = await db().prepare('SELECT * FROM subscriptions WHERE id=? AND paypal_id=?').bind(localID, paypalID).first<Agreement>();
  if (!row || row.mode !== mode()) throw new ServiceError(404, 'subscription_not_found', 'Enrollment was not found.');
  const current = await refreshAgreement(row);
  const localDraft = current.cancel_requested && current.merchant_activation && current.activation_attempted === null;
  return {status: closed.includes(current.state) ? 'cancelled' : current.state === 'ACTIVE' ? 'active' : current.state === 'needs_review' ? 'needs_review' : 'pending', activation_available: current.state === 'APPROVED' && !current.cancel_requested && !current.pause_requested && current.activation_attempted === null && Boolean(current.line_slot),
    message: closed.includes(current.state) ? localDraft ? 'LumaNest cancelled this enrollment before activation. No automatic payments are enabled by this enrollment.' : 'PayPal confirmed that this billing agreement is closed. Your already paid viewing time remains available.' : current.state === 'ACTIVE' ? 'PayPal confirmed auto-renew enrollment. Your line extends only after a completed scheduled payment is verified.' : current.state === 'APPROVED' ? 'PayPal confirmed your approval. Complete enrollment while signed into your line to enable auto-renew.' : 'PayPal enrollment is awaiting confirmation. No line renewal has been confirmed.'};
}
async function pause(row: Agreement, reason: string) {
  await db().prepare("UPDATE subscriptions SET state='needs_review',pause_requested=1,pause_confirmed=0,error=?,updated=? WHERE id=?").bind(reason, Date.now(), row.id).run();
  try {await refreshAgreement({...row, state: 'needs_review', pause_requested: 1});} catch {}
}
export async function reviewConflictingManualPayment(lineId: number) {
  const row = await db().prepare('SELECT * FROM subscriptions WHERE line_slot=?').bind(lineId).first<Agreement>();
  if (row) await pause(row, 'separate_payment_requires_review');
}
async function completedSale(row: Agreement, sale: PayPalEvent['resource']) {
  if (!sale || !paymentID.test(sale.id || '') || typeof sale.create_time !== 'string' || !iso(sale.create_time) || Date.parse(sale.create_time) > Date.now()) throw invalidPayment();
  canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
  const plan = await db().prepare('SELECT * FROM subscription_plans WHERE paypal_plan_id=? AND mode=?').bind(row.plan_id, row.mode).first<CatalogPlan>();
  if (!plan || !planValid(await paypal('/v1/billing/plans/' + row.plan_id), plan)) throw invalidPayment();
  const windowStart = new Date(Date.parse(sale.create_time) - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(Math.min(Date.parse(sale.create_time) + 24 * 60 * 60 * 1000, Date.now())).toISOString();
  const result = await paypal<{transactions?: (PayPalTransaction | null)[]; total_pages?: unknown; links?: (PayPalLink | null)[]}>('/v1/billing/subscriptions/' + row.paypal_id + '/transactions?' + new URLSearchParams({start_time: windowStart, end_time: windowEnd}));
  // Do not accept an incomplete transaction page or a webhook's amount as a payment receipt.
  if (!Array.isArray(result?.transactions) || Number(result.total_pages || 1) > 1 || result.links?.some(link => link?.rel === 'next')) throw invalidPayment();
  const matches = result.transactions.filter((transaction): transaction is PayPalTransaction => transaction?.id === sale.id);
  if (matches.length !== 1 || matches[0].status !== 'COMPLETED' || typeof matches[0].time !== 'string' || !iso(matches[0].time) ||
    matches[0].amount_with_breakdown?.gross_amount?.currency_code !== 'USD' || !money(matches[0].amount_with_breakdown.gross_amount.value, row.amount) ||
    Date.parse(matches[0].time) < Date.parse(row.starts_at) - 60000 || Date.parse(matches[0].time) > Date.now()) throw invalidPayment();
  const paidAt = new Date(matches[0].time).toISOString();
  await db().prepare("INSERT OR IGNORE INTO subscription_payments (sale_id,subscription_id,amount,currency,state,paid_at,created) VALUES (?,?,?,'USD','verified',?,?)").bind(sale.id, row.id, row.amount, paidAt, Date.now()).run();
  const saved = await db().prepare('SELECT subscription_id,amount,currency FROM subscription_payments WHERE sale_id=?').bind(sale.id).first<{subscription_id: string; amount: string; currency: string}>();
  if (!saved || saved.subscription_id !== row.id || saved.amount !== row.amount || saved.currency !== 'USD') throw invalidPayment();
  const existing = await db().prepare('SELECT state FROM subscription_payments WHERE sale_id=?').bind(sale.id).first<{state: string}>();
  if (existing?.state !== 'verified') return;
  try {await withBillingLineLock(row.line_id, async () => {
  const currentRow = await db().prepare('SELECT * FROM subscriptions WHERE id=?').bind(row.id).first<Agreement>();
  if (!currentRow) throw invalidPayment();
  row = currentRow;
  const claim = await db().prepare("UPDATE subscription_payments SET state='fulfilling',attempted=? WHERE sale_id=? AND subscription_id=? AND state='verified' AND attempted IS NULL").bind(Date.now(), sale.id, row.id).run();
  if (claim.meta.changes !== 1) return;
  try {
    if (row.cancel_requested) throw new ServiceError(409, 'cancelled_agreement_payment', 'A cancelled enrollment received a payment and needs support review.');
    if (row.pause_requested || row.state === 'needs_review') throw new ServiceError(409, 'recurring_review_pending', 'A prior billing problem must be resolved before another renewal.');
    if (!liveFulfillment(settings().PAYPAL_MODE)) {
      await db().prepare("UPDATE subscription_payments SET state='sandbox_paid' WHERE sale_id=?").bind(sale.id).run();
      return;
    }
    const [line, account] = await Promise.all([bunny('/lines/' + row.line_id), bunny('/account')]) as [RenewalLine, ProviderAccount];
    const offer = renewalOffer(line, row.months);
    if (line?.id !== row.line_id || line.devices !== row.devices || line.on_site !== true || !['active', 'expired'].includes(line.status) ||
      offer.amount.toFixed(2) !== row.amount || await credentialDigest(line.username, line.password) !== row.credential ||
      !portalReady(account?.site, settings().CUSTOMER_PORTAL_URL, settings().CUSTOMER_PORTAL_PRIMARY_URL) || !walletCanActivate(account?.balance, offer.cost)) throw new ServiceError(409, 'recurring_line_changed', 'This payment needs support review before renewal.');
    // A separate owner/manual extension changes the paid-through schedule. Pause instead of creating overlapping charges.
    const expiry = lineExpiry(line);
    if (expiry && Date.parse(expiry) > Date.parse(paidAt) + 24 * 60 * 60 * 1000) throw new ServiceError(409, 'recurring_schedule_changed', 'The viewing paid-through date changed and billing needs review.');
    const renewed = await bunny('/lines/' + row.line_id + '/renew', 'POST', {months: row.months}, 'paypal-sale-' + sale.id);
    activatedLineId(renewed, row.line_id);
    await db().prepare("UPDATE subscription_payments SET state='fulfilled',fulfilled=?,error=NULL WHERE sale_id=? AND state='fulfilling'").bind(Date.now(), sale.id).run();
    const after = await bunny('/lines/' + row.line_id) as RenewalLine;
    const updatedRemote = canonical(await paypal('/v1/billing/subscriptions/' + row.paypal_id), row);
    const next = iso(updatedRemote.billing_info?.next_billing_time), viewingExpiry = lineExpiry(after);
    if (!next || !viewingExpiry || Date.parse(next) <= Date.parse(paidAt) || after.id !== row.line_id || Math.abs(Date.parse(next) - Date.parse(viewingExpiry)) > 6 * 60 * 60 * 1000) throw new ServiceError(409, 'recurring_schedule_alignment_unconfirmed', 'Renewal succeeded, but future billing dates need support review.');
    await db().prepare("UPDATE subscriptions SET state=?,next_billing_at=?,updated=?,error=NULL WHERE id=? AND pause_requested=0 AND cancel_requested=0 AND state!='needs_review'").bind(updatedRemote.status, next, Date.now(), row.id).run();
  } catch (error) {
    const reason = error instanceof ServiceError ? error.code : 'renewal_not_confirmed';
    await db().prepare("UPDATE subscription_payments SET state='needs_review',error=? WHERE sale_id=? AND state='fulfilling'").bind(reason, sale.id).run();
    await pause(row, reason);
  }
  });} catch (error) {
    if (error instanceof ServiceError && error.code === 'recurring_billing_busy') {
      const latest = await db().prepare('SELECT state FROM subscription_payments WHERE sale_id=?').bind(sale.id).first<{state: string}>();
      if (latest && latest.state !== 'verified') return;
      throw new ServiceError(503, 'recurring_sale_busy', 'Another renewal is processing. PayPal should retry this payment notification shortly.', '5');
    }
    throw error;
  }
}
async function webhookAgreement(event: VerifiedPayPalEvent) {
  const paypalID = event.event_type?.startsWith('PAYMENT.SALE.') ? event.resource?.billing_agreement_id : event.resource?.id;
  let row = subscriptionID.test(paypalID || '') ? await db().prepare('SELECT * FROM subscriptions WHERE paypal_id=? AND mode=?').bind(paypalID, mode()).first<Agreement>() : null;
  if (!row && ['PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'].includes(event.event_type)) {
    const original = event.resource?.sale_id || event.resource?.id;
    if (paymentID.test(original || '')) row = await db().prepare('SELECT s.* FROM subscriptions s JOIN subscription_payments p ON p.subscription_id=s.id WHERE p.sale_id=? AND s.mode=?').bind(original, mode()).first<Agreement>();
  }
  return row;
}
export async function reviewSubscriptionEvent(event: VerifiedPayPalEvent, reason: string) {
  const row = await webhookAgreement(event);
  if (row && row.state !== 'needs_review') await pause(row, reason);
}
export async function subscriptionWebhook(event: VerifiedPayPalEvent) {
  const row = await webhookAgreement(event);
  if (!row) return;
  if (event.event_type === 'PAYMENT.SALE.COMPLETED') {
    try {
      if (row.cancel_requested) await refreshAgreement(row);
      await completedSale(row, event.resource);
    }
    catch (error) {if (!(error instanceof ServiceError && error.code === 'recurring_sale_busy')) await pause(row, 'payment_not_verified'); throw error;}
  } else if (['BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'].includes(event.event_type)) {
    await refreshAgreement(row);
    if (event.event_type !== 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      const original = event.resource?.sale_id || event.resource?.id;
      if (paymentID.test(original || '')) await db().prepare("UPDATE subscription_payments SET state='needs_review',error='payment_reversed' WHERE sale_id=? AND subscription_id=?").bind(original, row.id).run();
    }
    await pause(row, event.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' ? 'scheduled_payment_failed' : 'payment_reversed');
  } else await refreshAgreement(row);
}
export async function subscriptionCatalogStatus() {
  const catalog = await availablePlans();
  const attention = await db().prepare("SELECT COUNT(*) AS count FROM subscriptions s WHERE mode=? AND (state='needs_review' OR EXISTS(SELECT 1 FROM subscription_payments p WHERE p.subscription_id=s.id AND p.state='needs_review'))").bind(mode()).first<{count: number}>();
  return {ready: paypalReady() && catalog.length === 12, mode: mode(), plan_count: catalog.length, required_plan_count: 12, attention_count: attention?.count || 0,
    message: catalog.length === 12 ? null : 'Set up the fixed-price PayPal billing plans to offer customer-approved auto-renew.'};
}
export async function subscriptionQueue() {
  const agreements = await db().prepare('SELECT id,state,devices,months,amount,starts_at,next_billing_at,error FROM subscriptions WHERE mode=? ORDER BY created DESC LIMIT 50').bind(mode()).all<{id: string; state: string; devices: number; months: number; amount: string; starts_at: string; next_billing_at: string | null; error: string | null}>();
  const payments = await db().prepare('SELECT p.sale_id,p.subscription_id,p.state,p.amount,p.created,p.error FROM subscription_payments p JOIN subscriptions s ON s.id=p.subscription_id WHERE s.mode=? ORDER BY p.created DESC LIMIT 50').bind(mode()).all<{sale_id: string; subscription_id: string; state: string; amount: string; created: number; error: string | null}>();
  return {subscriptions: (agreements.results || []).map(row => ({id: row.id, status: row.state, devices: row.devices, months: row.months, amount: Number(row.amount), currency: 'USD', starts_at: row.starts_at, next_billing_at: row.next_billing_at, reason: row.error})),
    payments: (payments.results || []).map(row => ({payment_id: row.sale_id, subscription_id: row.subscription_id, state: row.state, amount: Number(row.amount), currency: 'USD', created: row.created, reason: row.error}))};
}
export async function setupSubscriptionCatalog(origin: string) {
  if (!paypalReady()) throw unavailable();
  const currentMode = mode(), now = Date.now();
  await db().prepare("INSERT OR IGNORE INTO subscription_catalog (mode,state,created) VALUES (?,'new',?)").bind(currentMode, now).run();
  const claim = await db().prepare('UPDATE subscription_catalog SET locked_at=? WHERE mode=? AND (locked_at IS NULL OR locked_at<?)').bind(now, currentMode, now - 5 * 60 * 1000).run();
  if (claim.meta.changes !== 1) throw new ServiceError(409, 'recurring_setup_busy', 'Auto-renew setup is already processing. Please wait and refresh.');
  try {
    const webhook = await setupPayPalWebhook(origin);
    if (webhook.id !== settings().PAYPAL_WEBHOOK_ID) throw new ServiceError(409, 'recurring_webhook_not_bound', 'Save the confirmed PayPal webhook connection before completing auto-renew setup.');
    await db().prepare('UPDATE subscription_catalog SET webhook_id=? WHERE mode=?').bind(webhook.id, currentMode).run();
    let catalog = await db().prepare('SELECT * FROM subscription_catalog WHERE mode=?').bind(currentMode).first<{product_id: string | null; state: string; created: number}>();
    if (!catalog) throw unavailable();
    if (!catalog.product_id) {
      if (catalog.state !== 'new' && Date.now() - catalog.created > 72 * 60 * 60 * 1000) throw new ServiceError(409, 'recurring_setup_review', 'A previous PayPal setup attempt needs reconciliation before creating another product.');
      await db().prepare("UPDATE subscription_catalog SET state='creating' WHERE mode=?").bind(currentMode).run();
      const product = await paypal<{id?: unknown}>('/v1/catalogs/products', 'POST', {name: 'LumaNest TV subscription', description: 'Customer-approved viewing subscription renewals.', type: 'SERVICE', category: 'SOFTWARE'}, 'ln-product-' + currentMode + '-v1');
      if (typeof product?.id !== 'string' || !/^[A-Z0-9-]{1,80}$/.test(product.id)) throw unavailable();
      await db().prepare("UPDATE subscription_catalog SET product_id=?,state='ready' WHERE mode=?").bind(product.id, currentMode).run();
      catalog = {...catalog, product_id: product.id};
    }
    let completed = 0;
    for (const plan of plans) for (const months of periods) {
      const id = sku(plan.devices, months);
      let row = await db().prepare('SELECT * FROM subscription_plans WHERE sku=?').bind(id).first<CatalogPlan>();
      if (row?.state === 'ready') continue;
      if (completed >= 3) return subscriptionCatalogStatus();
      if (!row) {
        await db().prepare("INSERT INTO subscription_plans (sku,product_id,devices,months,amount,currency,mode,state,created) VALUES (?,?,?,?,?,'USD',?,'new',?)").bind(id, catalog.product_id, plan.devices, months, retailPrice(plan.devices, months).toFixed(2), currentMode, Date.now()).run();
        row = await db().prepare('SELECT * FROM subscription_plans WHERE sku=?').bind(id).first<CatalogPlan>();
      }
      if (!row) throw unavailable();
      if (!row.paypal_plan_id) {
        if (row.state !== 'new' && Date.now() - row.created > 72 * 60 * 60 * 1000) throw new ServiceError(409, 'recurring_setup_review', 'An earlier plan creation needs reconciliation before retrying.');
        await db().prepare("UPDATE subscription_plans SET state='creating' WHERE sku=?").bind(id).run();
        const result = await paypal<{id?: unknown}>('/v1/billing/plans', 'POST', {product_id: catalog.product_id, name: `LumaNest TV ${plan.name} every ${months} months`, status: 'ACTIVE', billing_cycles: [{frequency: {interval_unit: 'MONTH', interval_count: months}, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: {fixed_price: {value: row.amount, currency_code: 'USD'}}}], payment_preferences: {auto_bill_outstanding: false, payment_failure_threshold: 1}}, 'ln-plan-' + currentMode + '-' + plan.devices + '-' + months + '-' + row.amount.replace('.', '') + '-v1');
        if (typeof result?.id !== 'string' || !planID.test(result.id)) throw unavailable();
        await db().prepare('UPDATE subscription_plans SET paypal_plan_id=? WHERE sku=?').bind(result.id, id).run();
        row = {...row, paypal_plan_id: result.id};
      }
      if (!planValid(await paypal('/v1/billing/plans/' + row.paypal_plan_id), row)) throw new ServiceError(409, 'recurring_plan_unverified', 'PayPal billing plan terms do not match the displayed renewal price.');
      await db().prepare("UPDATE subscription_plans SET state='ready' WHERE sku=?").bind(id).run();
      completed++;
    }
    return subscriptionCatalogStatus();
  } finally {await db().prepare('UPDATE subscription_catalog SET locked_at=NULL WHERE mode=? AND locked_at=?').bind(currentMode, now).run();}
}
