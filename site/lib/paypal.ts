import {env} from 'cloudflare:workers';
import {portalReady, renewalOffer, walletCanActivate, newLineQuote, activatedLineId} from './provider-readiness.ts';
import {settings, ServiceError, bunny} from './mybunny.ts';
import {retailPrice} from './plans.ts';
import {verifiedOrder, verifiedCapture, liveFulfillment, type PayPalOrder} from './payment-validation.ts';
import type {ProviderAccount} from './provider-readiness.ts';
import type {RenewalLine} from './renewal.ts';

export type Order = {id: string; paypal_id: string; email: string; name: string; kind: string; line_id: number | null; devices: number; months: number; amount: string; state: string; created: number; attempted: number | null; capture_id?: string | null; error?: string | null};
// Untrusted PayPal webhook payloads: only the fields read here, each validated before use.
export type PayPalEvent = {id?: string; event_type?: string; resource?: {id?: string; sale_id?: string; billing_agreement_id?: string; create_time?: string; supplementary_data?: {related_ids?: {order_id?: string}}}};
export type VerifiedPayPalEvent = PayPalEvent & {id: string; event_type: string};
export type PayPalWebhook = {id?: string; url?: string; event_types?: ({name?: unknown} | null)[]};
export const PAYPAL_REQUIRED_EVENTS = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'];

export function db() {
  if (!env.DB) throw new ServiceError(503, 'storage_unavailable', 'Order storage is unavailable.');
  return env.DB;
}

export function paypalReady() {
  const e = settings();
  return Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET && e.MYBUNNY_API_KEY && e.CUSTOMER_PORTAL_URL && e.CHECKOUT_ENABLED === 'true' && (!liveFulfillment(e.PAYPAL_MODE) || e.PAYPAL_WEBHOOK_ID));
}

function paypalBase() {
  return liveFulfillment(settings().PAYPAL_MODE) ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

let cachedToken: {key: string; value: string; until: number} | undefined;
export function clearPayPalToken() {cachedToken = undefined;}
async function paypalToken() {
  const e = settings();
  if (!e.PAYPAL_CLIENT_ID || !e.PAYPAL_CLIENT_SECRET) throw new ServiceError(503, 'paypal_not_configured', 'PayPal checkout is not connected yet.');
  const key = paypalBase() + ':' + e.PAYPAL_CLIENT_ID;
  if (cachedToken?.key === key && cachedToken.until > Date.now()) return cachedToken.value;
  let response: Response;
  try {
    response = await fetch(paypalBase() + '/v1/oauth2/token', {
      method: 'POST', headers: {Authorization: 'Basic ' + btoa(e.PAYPAL_CLIENT_ID + ':' + e.PAYPAL_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'grant_type=client_credentials', redirect: 'manual', signal: AbortSignal.timeout(15000)
    });
  } catch { throw new ServiceError(503, 'paypal_auth_failed', 'PayPal could not be reached. Please try again shortly.'); }
  if (!response.ok) throw new ServiceError(503, 'paypal_auth_failed', 'PayPal authentication failed. Please contact support.');
  let token: {access_token?: string; expires_in?: number};
  try { token = await response.json(); } catch { throw new ServiceError(502, 'paypal_auth_failed', 'PayPal returned an unreadable authentication response.'); }
  if (!token?.access_token) throw new ServiceError(502, 'paypal_auth_failed', 'PayPal did not confirm the connection.');
  // Reuse the token within this isolate until shortly before PayPal expires it.
  const lifetime = Number(token.expires_in);
  if (Number.isFinite(lifetime) && lifetime > 120) cachedToken = {key, value: token.access_token, until: Date.now() + (Math.min(lifetime, 8 * 3600) - 60) * 1000};
  return token.access_token;
}

function paypalOperation(path: string) {
  const pathname = path.split('?')[0];
  if (/^\/v1\/billing\/subscriptions\/[^/]+\/transactions$/.test(pathname)) return 'subscription_transactions';
  if (/^\/v1\/billing\/subscriptions\/[^/]+\/(activate|cancel|suspend)$/.test(pathname)) return 'subscription_' + pathname.split('/').pop();
  if (/^\/v1\/billing\/subscriptions\/[^/]+$/.test(pathname)) return 'subscription_read';
  if (pathname === '/v1/billing/subscriptions') return 'subscription_create';
  if (pathname.startsWith('/v1/billing/plans')) return 'billing_plan';
  if (pathname.startsWith('/v1/notifications/')) return 'webhook_configuration';
  if (pathname.startsWith('/v2/checkout/orders')) return 'checkout_order';
  if (pathname === '/v1/catalogs/products') return 'catalog_product';
  return 'paypal_request';
}
async function logPayPalFailure(response: Response, path: string, method: string) {
  let result: {name?: unknown; debug_id?: unknown; details?: unknown} | null = null;
  try {result = await response.json();} catch {}
  const code = (value: unknown) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : null;
  const rawDebug = result?.debug_id || response.headers.get('paypal-debug-id');
  const debugID = typeof rawDebug === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rawDebug) ? rawDebug : null;
  const issues = Array.isArray(result?.details) ? [...new Set(result.details.slice(0, 10).map((detail: {issue?: unknown} | null) => code(detail?.issue)).filter(Boolean))] : [];
  // Operator diagnostics contain only bounded PayPal machine codes. Never log the
  // response body, descriptions, field values, payer data, IDs in the path, or query.
  console.error('lumanest_paypal_request_failed', JSON.stringify({operation: paypalOperation(path), method: ['GET', 'POST', 'PATCH'].includes(method) ? method : 'OTHER', http_status: response.status, name: code(result?.name), issues, debug_id: debugID}));
}

// T names the response fields a caller reads; the JSON is unverified and callers validate every value they rely on.
export async function paypal<T = unknown>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T | null> {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    const token = await paypalToken();
    try {
      response = await fetch(paypalBase() + path, {
        method, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(key ? {'PayPal-Request-Id': key} : {})},
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(25000)
      });
    } catch { throw new ServiceError(504, 'paypal_outcome_unknown', 'The payment status could not be confirmed. Check your order before paying again.'); }
    // PayPal rejects an expired or revoked token before processing the request, so one retry is safe.
    if (response.status !== 401 || attempt) break;
    clearPayPalToken();
    await response.body?.cancel();
  }
  if (!response.ok) {
    await logPayPalFailure(response, path, method);
    throw new ServiceError(502, 'paypal_error', 'PayPal could not complete this request. No activation has been confirmed.');
  }
  if (response.status === 204) return null;
  try { return await response.json() as T; } catch {
    throw new ServiceError(502, 'paypal_outcome_unknown', 'The payment status could not be confirmed. Check your order before paying again.');
  }
}

// Short-lived per-isolate snapshot so bursts of checkouts do not each hit the provider.
let providerSnapshot: {until: number; value: Promise<unknown[]>} | undefined;
export function clearProviderSnapshot() {providerSnapshot = undefined;}
export async function createCheckout(input: {devices: number; months: number; email: string; name: string; lineId?: number}, origin: string) {
  if (!paypalReady()) throw new ServiceError(503, 'checkout_unavailable', 'Checkout is being connected. No payment has been taken.');
  if (liveFulfillment(settings().PAYPAL_MODE)) {
    if (!providerSnapshot || providerSnapshot.until < Date.now()) providerSnapshot = {until: Date.now() + 5000, value: Promise.all([bunny('/account'), bunny('/prices')])};
    const snapshot = providerSnapshot;
    const [account, prices] = await snapshot.value.catch(error => {if (providerSnapshot === snapshot) providerSnapshot = undefined; throw error;}) as [ProviderAccount, Parameters<typeof newLineQuote>[0]];
    if (!portalReady(account?.site, settings().CUSTOMER_PORTAL_URL, settings().CUSTOMER_PORTAL_PRIMARY_URL)) throw new ServiceError(503, 'portal_not_ready', 'The customer hub is being connected. Please contact support before paying.');
    if (!input.lineId && account?.site?.email_ready !== true) throw new ServiceError(503, 'invitations_not_ready', 'Customer invitations are being connected. Please contact support before paying.');
    let cost: unknown;
    if (input.lineId) {
      const line = await bunny('/lines/' + input.lineId) as RenewalLine;
      const offer = renewalOffer(line, input.months);
      if (input.devices !== offer.devices) throw new ServiceError(409, 'renewal_plan_changed', 'Your plan changed. Refresh your renewal options before continuing. No payment has been taken.');
      input.devices = offer.devices;
      cost = offer.cost;
    } else cost = newLineQuote(prices, input.devices, input.months);
    if (!walletCanActivate(account?.balance, cost)) throw new ServiceError(503, 'activation_unavailable', 'Activations are temporarily unavailable. Please contact support before paying.');
  }
  const amount = retailPrice(input.devices, input.months).toFixed(2), id = crypto.randomUUID();
  await db().prepare('INSERT INTO orders (id,email,name,kind,line_id,devices,months,amount,state,created) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, input.email, input.name, input.lineId ? 'renew' : 'new', input.lineId || null, input.devices, input.months, amount, 'creating', Date.now()).run();
  try {
    const result = await paypal<PayPalOrder>('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE', purchase_units: [{reference_id: id, custom_id: id, description: 'LumaNest TV · ' + input.devices + ' screens · ' + input.months + ' months', amount: {currency_code: 'USD', value: amount}}],
      payment_source: {paypal: {experience_context: {brand_name: 'LumaNest TV', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: origin + '/checkout/return?order=' + id, cancel_url: origin + '/checkout/cancel'}}}
    }, id);
    const approve = result?.links?.find(link => link.rel === 'payer-action' || link.rel === 'approve')?.href;
    const approvedUrl = typeof approve === 'string' ? new URL(approve) : undefined;
    const approvalHost = liveFulfillment(settings().PAYPAL_MODE) ? 'www.paypal.com' : 'www.sandbox.paypal.com';
    if (typeof result?.id !== 'string' || !/^[A-Z0-9]{1,36}$/.test(result.id) || !approvedUrl || approvedUrl.protocol !== 'https:' || approvedUrl.hostname !== approvalHost || approvedUrl.username || approvedUrl.password) {
      throw new ServiceError(502, 'paypal_response_invalid', 'PayPal did not return a valid checkout link. No payment has been taken.');
    }
    await db().prepare('UPDATE orders SET paypal_id=?,state=? WHERE id=?').bind(result.id, 'created', id).run();
    return {order_id: id, approval_url: approve};
  } catch (e) {
    await db().prepare("UPDATE orders SET state='needs_review',error=? WHERE id=? AND state='creating'").bind('PayPal order creation failed', id).run();
    throw e;
  }
}

export async function fulfill(row: Order, paypalOrder: PayPalOrder | null) {
  const captureId = verifiedCapture(row, paypalOrder);
  if (!liveFulfillment(settings().PAYPAL_MODE)) {
    await db().prepare("UPDATE orders SET state='sandbox_paid',capture_id=?,error=NULL WHERE id=? AND attempted IS NULL AND state IN ('capturing','created','pending','needs_review')").bind(captureId, row.id).run();
    return status(row.id);
  }
  // Only one return request or verified webhook can spend the provider wallet.
  // A verified capture may recover a payment timeout before any activation attempt.
  const lock = await db().prepare("UPDATE orders SET state='fulfilling',capture_id=?,attempted=?,error=NULL WHERE id=? AND attempted IS NULL AND state IN ('capturing','created','pending','needs_review')")
    .bind(captureId, Date.now(), row.id).run();
  if (lock.meta.changes !== 1) return status(row.id);
  try {
    if (row.kind === 'renew') {
      const line = await bunny('/lines/' + row.line_id) as RenewalLine;
      const offer = renewalOffer(line, row.months);
      if (activatedLineId(line, row.line_id) !== row.line_id || line.devices !== row.devices || line.on_site !== true ||
        !['active', 'expired'].includes(line.status) || offer.amount.toFixed(2) !== row.amount) {
        throw new ServiceError(409, 'renewal_line_changed', 'This line changed after checkout and needs support review.');
      }
    }
    const data = await bunny(row.kind === 'renew' ? '/lines/' + row.line_id + '/renew' : '/lines', 'POST',
      row.kind === 'renew' ? {months: row.months} : {devices: row.devices, months: row.months, customer_email: row.email, customer_name: row.name, note: 'PayPal ' + row.paypal_id, on_site: true, send_invitation: true}, 'paypal-' + row.paypal_id);
    const lineId = activatedLineId(data, row.kind === 'renew' ? row.line_id : undefined);
    await db().prepare("UPDATE orders SET state='fulfilled',fulfilled_line_id=?,error=NULL WHERE id=? AND state='fulfilling'").bind(lineId, row.id).run();
    return status(row.id);
  } catch (e) {
    await db().prepare("UPDATE orders SET state='needs_review',error=? WHERE id=? AND state='fulfilling'").bind(e instanceof ServiceError ? e.code : 'activation_not_confirmed', row.id).run();
    return {state: 'needs_review', message: 'Payment was received. Activation needs support review. Do not pay again.', order_id: row.id};
  }
}

export async function status(id: string) {
  const row = await db().prepare('SELECT state,kind,error FROM orders WHERE id=?').bind(id).first<{state: string; kind: string; error: string | null}>();
  return {state: row?.state || 'not_found', message: row?.state === 'abandoned' ? row.error?.startsWith('Replaced') ? 'This unpaid checkout was replaced when you chose auto-renew. No payment was captured by this website.' : 'This checkout was not completed. No payment was captured by this website.' : row?.state === 'resolved' ? 'Support has reviewed this order. Contact support if you have questions.' : row?.state === 'sandbox_paid' ? 'Sandbox payment verified. No live line was created.' : row?.state === 'fulfilled' ? row.kind === 'renew' ? 'Your subscription has been renewed. Your existing line login stays the same. Check your customer hub.' : 'Your subscription is ready. Check your customer hub or invitation email.' : row?.state === 'needs_review' ? 'Your order needs support review. Do not pay again.' : 'Your order is processing. Please check again shortly.'};
}

export async function captureCheckout(id: string, token: string) {
  const row = await db().prepare('SELECT * FROM orders WHERE id=?').bind(id).first<Order>();
  if (!row || row.paypal_id !== token) throw new ServiceError(404, 'order_not_found', 'Order not found.');
  if (row.kind === 'renew' && row.line_id && ['created', 'pending'].includes(row.state)) await (await import('./subscriptions.ts')).assertPayOnceAllowed(row.line_id);
  const lock = await db().prepare("UPDATE orders SET state='capturing' WHERE id=? AND state IN ('created','pending')").bind(id).run();
  if (lock.meta.changes !== 1) return status(id);
  let captureSent = false;
  try {
    let result = await paypal<PayPalOrder>('/v2/checkout/orders/' + token);
    verifiedOrder(row, result);
    if (result?.status === 'APPROVED') {
      captureSent = true;
      result = await paypal<PayPalOrder>('/v2/checkout/orders/' + token + '/capture', 'POST', {}, 'capture-' + row.id);
      // Capture responses can omit purchase-unit metadata. Read the canonical
      // order before validating the stored reference and charging the wallet.
      if (!result?.purchase_units?.[0]?.custom_id || !result.purchase_units[0].amount) result = await paypal<PayPalOrder>('/v2/checkout/orders/' + token);
      verifiedOrder(row, result);
    }
    if (result?.status !== 'COMPLETED' || result.purchase_units?.[0]?.payments?.captures?.some(capture => capture?.status === 'PENDING')) {
      await db().prepare("UPDATE orders SET state='pending' WHERE id=? AND state='capturing'").bind(id).run();
      return status(id);
    }
    return await fulfill(row, result);
  } catch (e) {
    // PayPal was unavailable before any capture request: release the lock so the
    // return page or approval webhook can retry instead of stranding the approval.
    if (!captureSent && e instanceof ServiceError && e.code.startsWith('paypal_')) {
      const released = await db().prepare("UPDATE orders SET state=? WHERE id=? AND state='capturing'").bind(row.state, id).run();
      if (released.meta.changes !== 1) return status(id);
      throw e;
    }
    const changed = await db().prepare("UPDATE orders SET state='needs_review',error=? WHERE id=? AND state='capturing'").bind(e instanceof ServiceError ? e.code : 'capture_not_verified', id).run();
    if (changed.meta.changes !== 1) return status(id);
    throw e;
  }
}

const validEvent = (event: PayPalEvent | null): event is VerifiedPayPalEvent => typeof event?.id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(event.id) && typeof event?.event_type === 'string' && /^[A-Z0-9_.]{1,100}$/.test(event.event_type);
export async function webhook(input: unknown, headers: Headers) {
  const event = input as PayPalEvent | null;
  const webhookId = settings().PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new ServiceError(503, 'webhook_not_configured', 'Webhook is not configured.');
  if (!validEvent(event) || ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'].some(header => !headers.get(header))) {
    throw new ServiceError(403, 'invalid_webhook', 'Webhook verification failed.');
  }
  const verified = await paypal<{verification_status?: string}>('/v1/notifications/verify-webhook-signature', 'POST', {
    auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'), transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'), transmission_time: headers.get('paypal-transmission-time'), webhook_id: webhookId, webhook_event: event
  });
  if (verified?.verification_status !== 'SUCCESS') throw new ServiceError(403, 'invalid_webhook', 'Webhook verification failed.');
  // PayPal redelivers events; each verified event id is processed once. A transient failure releases the claim so the retry runs.
  const claim = await db().prepare('INSERT OR IGNORE INTO paypal_webhook_events (id,type,received) VALUES (?,?,?)').bind(event.id, event.event_type, Date.now()).run();
  if (claim.meta.changes !== 1) return {received: true};
  try {return await processWebhook(event);}
  catch (error) {
    // Business conflicts are recorded for owner review and acknowledged so PayPal does not retry them for days.
    if (businessConflict(error)) {
      const code = error instanceof ServiceError ? error.code : 'payment_not_verified';
      try {
        await reviewWebhookConflict(event, code);
        console.error('lumanest_paypal_webhook_review', JSON.stringify({type: event.event_type, code}));
        return {received: true};
      } catch {}
    }
    await db().prepare('DELETE FROM paypal_webhook_events WHERE id=?').bind(event.id).run().catch(() => {});
    throw error;
  }
}
function businessConflict(error: unknown) {
  if (error instanceof ServiceError) return error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status);
  return error instanceof Error && error.constructor === Error && !/D1_|SQLITE/i.test(error.message);
}
function webhookOrderId(event: PayPalEvent) {
  const id = event.event_type === 'CHECKOUT.ORDER.APPROVED' ? event.resource?.id : event.resource?.supplementary_data?.related_ids?.order_id;
  return typeof id === 'string' && /^[A-Z0-9]{1,36}$/.test(id) ? id : null;
}
async function reviewWebhookConflict(event: VerifiedPayPalEvent, code: string) {
  if (event.event_type.startsWith('BILLING.SUBSCRIPTION.') || event.event_type.startsWith('PAYMENT.SALE.')) return (await import('./subscriptions.ts')).reviewSubscriptionEvent(event, code);
  const id = webhookOrderId(event);
  if (!id) return;
  await db().prepare("UPDATE orders SET state='needs_review',error=? WHERE paypal_id=? AND attempted IS NULL AND state IN ('created','pending')").bind(code, id).run();
  // A replaced checkout that reports a capture must never be fulfilled automatically.
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') await db().prepare("UPDATE orders SET state='needs_review',attempted=?,error=? WHERE paypal_id=? AND state='abandoned'").bind(Date.now(), code, id).run();
}
async function processWebhook(event: VerifiedPayPalEvent) {
  if (event.event_type.startsWith('BILLING.SUBSCRIPTION.') || event.event_type.startsWith('PAYMENT.SALE.')) {
    await (await import('./subscriptions.ts')).subscriptionWebhook(event);
    return {received: true};
  }
  const id = webhookOrderId(event);
  if (id) {
    const row = await db().prepare('SELECT * FROM orders WHERE paypal_id=?').bind(id).first<Order>();
    if (row && event.event_type === 'CHECKOUT.ORDER.APPROVED') await captureCheckout(row.id, id);
    if (row && event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && row.state === 'abandoned') {
      const captureId = verifiedCapture(row, await paypal<PayPalOrder>('/v2/checkout/orders/' + id));
      await db().prepare("UPDATE orders SET state='needs_review',capture_id=?,attempted=?,error='A replaced checkout received payment; review before renewal' WHERE id=? AND state='abandoned'").bind(captureId, Date.now(), row.id).run();
      if (row.line_id) await (await import('./subscriptions.ts')).reviewConflictingManualPayment(row.line_id);
    }
    if (row && event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && row.attempted === null && ['created', 'pending', 'capturing', 'needs_review'].includes(row.state)) {
      await fulfill(row, await paypal<PayPalOrder>('/v2/checkout/orders/' + id));
    }
  }
  return {received: true};
}

export async function verifyPayPalConnection() {
  await paypalToken();
  return {connected: true, mode: liveFulfillment(settings().PAYPAL_MODE) ? 'live' : 'sandbox'};
}

export async function setupPayPalWebhook(origin: string) {
  const address = new URL('/api/paypal/webhook', origin);
  if (address.protocol !== 'https:') throw new ServiceError(400, 'webhook_url_invalid', 'PayPal webhooks require an HTTPS website.');
  const required = PAYPAL_REQUIRED_EVENTS;
  const listing = await paypal<{webhooks?: unknown}>('/v1/notifications/webhooks');
  if (!Array.isArray(listing?.webhooks)) throw new ServiceError(502, 'paypal_response_invalid', 'PayPal did not return the webhook list.');
  const matches = (listing.webhooks as (PayPalWebhook | null)[]).filter((entry): entry is PayPalWebhook => entry?.url === address.href);
  let result: PayPalWebhook | null | undefined = matches.find(entry => entry.id === settings().PAYPAL_WEBHOOK_ID) ?? matches[0];
  let action = 'reused';
  if (!result) {
    result = await paypal<PayPalWebhook>('/v1/notifications/webhooks', 'POST', {url: address.href, event_types: required.map(name => ({name}))});
    action = 'created';
  } else {
    if (typeof result.id !== 'string' || !result.id || !Array.isArray(result.event_types)) throw new ServiceError(502, 'paypal_response_invalid', 'PayPal did not return complete webhook details.');
    const subscribed = result.event_types.map(event => event?.name).filter((name: unknown): name is string => typeof name === 'string');
    if (!subscribed.includes('*') && required.some(name => !subscribed.includes(name))) {
      const names = [...new Set([...subscribed, ...required])];
      result = await paypal<PayPalWebhook>('/v1/notifications/webhooks/' + encodeURIComponent(result.id), 'PATCH', [{op: 'replace', path: '/event_types', value: names.map(name => ({name}))}]);
      if (!result) result = await paypal<PayPalWebhook>('/v1/notifications/webhooks/' + encodeURIComponent(String(matches.find(entry => entry.id === settings().PAYPAL_WEBHOOK_ID)?.id ?? matches[0].id)));
      action = 'updated';
    }
  }
  const events = Array.isArray(result?.event_types) ? result.event_types.map(event => event?.name) : [];
  if (typeof result?.id !== 'string' || !result.id || result.url !== address.href || (!events.includes('*') && required.some(name => !events.includes(name)))) {
    throw new ServiceError(502, 'paypal_response_invalid', 'PayPal did not confirm the webhook subscription.');
  }
  return {id: result.id as string, url: address.href, event_types: events as string[], action, mode: liveFulfillment(settings().PAYPAL_MODE) ? 'live' : 'sandbox'};
}
