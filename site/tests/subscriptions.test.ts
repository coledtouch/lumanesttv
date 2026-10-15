import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const runtime = globalThis as unknown as {__subscriptionEnv: Record<string, unknown>; __subscriptionHeaders: Headers};
runtime.__subscriptionEnv = {};
runtime.__subscriptionHeaders = new Headers();
const hooks = registerHooks({resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env=globalThis.__subscriptionEnv;', shortCircuit: true};
  if (specifier === 'next/headers') return {url: 'data:text/javascript,export async function headers(){return globalThis.__subscriptionHeaders;}', shortCircuit: true};
  if (specifier === 'next/navigation') return {url: 'data:text/javascript,export function redirect(){throw new Error("Unexpected redirect");}', shortCircuit: true};
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context);
  return next(specifier, context);
}});
const {POST: login} = await import('../app/api/player/renew/login/route.ts');
const {POST: checkout} = await import('../app/api/player/renew/checkout/route.ts');
const {POST: capture} = await import('../app/api/checkout/capture/route.ts');
const {GET: billing, POST: enroll} = await import('../app/api/player/renew/subscription/route.ts');
const {POST: cancel} = await import('../app/api/player/renew/subscription/cancel/route.ts');
const {POST: manageLogin} = await import('../app/api/player/renew/subscription/login/route.ts');
const {POST: activate} = await import('../app/api/player/renew/subscription/activate/route.ts');
const {GET: returned} = await import('../app/api/subscriptions/return/route.ts');
const {GET: ownerGet, POST: ownerSetup} = await import('../app/api/manage/subscriptions/route.ts');
const {POST: webhook} = await import('../app/api/paypal/webhook/route.ts');
const {setupSubscriptionCatalog} = await import('../lib/subscriptions.ts');
const {GET: reviewGet, POST: reviewPost} = await import('../app/api/manage/reconcile/route.ts');
hooks.deregister();

const nativeFetch = globalThis.fetch, nativeNow = Date.now;
const origin = 'https://lumanest.tv', username = 'subscription-test-line', password = 'private-line-password';
let sqlite: DatabaseSync, now: number, line: any, plans: Map<string, any>, subscriptions: Map<string, any>, transactions: Map<string, any[]>, orders: Map<string, any>, requests: {url: string; method: string; body: any; key: string | null}[], renewals: string[], suspendFail: boolean, renewalOutcome: boolean, scheduleDrift: boolean, webhookEvents: string[], createFail = false;
function plusMonths(value: string, months: number) {const date = new Date(value); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString();}
function database() {
  return {prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    function bound(values: any[] = []) {return {async run() {return {meta: {changes: Number(statement.run(...values).changes)}};}, async first() {return statement.get(...values) || null;}, async all() {return {results: statement.all(...values)};}};}
    return {...bound(), bind(...values: any[]) {return bound(values);}};
  }};
}
test.beforeEach(async () => {
  createFail = false;
  now = nativeNow(); Date.now = () => now;
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  line = {id: 42, username, password, devices: 2, status: 'expired', on_site: true, expires_at: new Date(now - 86400000).toISOString(), prices: {renew: [{months: 3, price: 43}, {months: 6, price: 85}, {months: 12, price: 140}]}};
  plans = new Map(); subscriptions = new Map(); transactions = new Map(); orders = new Map(); requests = []; renewals = []; suspendFail = false; renewalOutcome = true; scheduleDrift = false; webhookEvents = [];
  runtime.__subscriptionHeaders = new Headers();
  Object.assign(runtime.__subscriptionEnv, {DB: database(), PLAYER_COOKIE_KEY: 'b'.repeat(64), CHECKOUT_ENABLED: 'true', PAYPAL_MODE: 'live', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-paypal-secret', PAYPAL_WEBHOOK_ID: 'WEBHOOK42', MYBUNNY_API_KEY: 'test-provider-secret', CUSTOMER_PORTAL_URL: 'https://portal.lumanest.tv', CUSTOMER_PORTAL_PRIMARY_URL: 'https://tv.lumanest.tv'});
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method || 'GET', body = init.body && new Headers(init.headers).get('Content-Type') === 'application/json' ? JSON.parse(String(init.body)) : undefined;
    requests.push({url: url.href, method, body, key: new Headers(init.headers).get('PayPal-Request-Id') || new Headers(init.headers).get('Idempotency-Key')});
    if (url.pathname === '/v1/oauth2/token') return Response.json({access_token: 'test-token'});
    if (url.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({verification_status: 'SUCCESS'});
    if (url.pathname === '/v1/notifications/webhooks') return Response.json({webhooks: [{id: 'WEBHOOK42', url: origin + '/api/paypal/webhook', event_types: webhookEvents.map(name => ({name}))}]});
    if (url.pathname === '/v1/notifications/webhooks/WEBHOOK42') {
      if (method === 'PATCH') {webhookEvents = body[0].value.map((value: any) => value.name); return new Response(null, {status: 204});}
      return Response.json({id: 'WEBHOOK42', url: origin + '/api/paypal/webhook', event_types: webhookEvents.map(name => ({name}))});
    }
    if (url.pathname === '/v1/catalogs/products') return Response.json({id: 'PROD-TEST42'});
    if (url.pathname === '/v1/billing/plans' && method === 'POST') {const id = 'P-TEST' + String(plans.size + 1).padStart(6, '0'); plans.set(id, {id, ...body}); return Response.json({id});}
    if (url.pathname.startsWith('/v1/billing/plans/')) return Response.json(plans.get(url.pathname.split('/').pop()!));
    if (url.pathname === '/v1/billing/subscriptions' && method === 'POST' && createFail) return new Response('{}', {status: 500});
    if (url.pathname === '/v1/billing/subscriptions' && method === 'POST') {
      const id = 'I-TEST' + String(subscriptions.size + 1).padStart(6, '0'); subscriptions.set(id, {id, plan_id: body.plan_id, custom_id: body.custom_id, start_time: body.start_time, status: 'APPROVAL_PENDING', plan_overridden: false, billing_info: {next_billing_time: body.start_time}}); transactions.set(id, []);
      return Response.json({id, links: [{rel: 'approve', href: 'https://www.paypal.com/webapps/billing/subscriptions?ba_token=' + id}]});
    }
    const match = url.pathname.match(/^\/v1\/billing\/subscriptions\/(I-[A-Z0-9]+)(?:\/(cancel|suspend|activate|transactions))?$/);
    if (match) {
      const sub = subscriptions.get(match[1]);
      if (match[2] === 'transactions') return Response.json({transactions: transactions.get(match[1]), total_pages: 1});
      if (match[2] === 'activate') {if (sub.status !== 'APPROVED') return new Response(null, {status: 422}); sub.status = 'ACTIVE'; return new Response(null, {status: 204});}
      if (match[2] === 'cancel' || match[2] === 'suspend') {
        if (match[2] === 'suspend' && suspendFail) return new Response(null, {status: 503});
        if (!['ACTIVE', 'SUSPENDED'].includes(sub.status)) return new Response(null, {status: 422});
        sub.status = match[2] === 'cancel' ? 'CANCELLED' : 'SUSPENDED'; return new Response(null, {status: 204});
      }
      return Response.json(sub);
    }
    if (url.pathname === '/v2/checkout/orders' && method === 'POST') {const id = 'TESTORDER' + (orders.size + 1); orders.set(id, {id, status: 'CREATED', purchase_units: body.purchase_units}); return Response.json({id, links: [{rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=' + id}]});}
    if (url.pathname.startsWith('/v2/checkout/orders/')) return Response.json(orders.get(url.pathname.split('/').pop()!));
    if (url.hostname === 'connect.turbobunny.net') {
      if (url.pathname === '/api/v1/account') return Response.json({data: {balance: 1000, site: {status: 'approved', address: 'https://tv.lumanest.tv'}}});
      if (url.pathname === '/api/v1/prices') return Response.json({data: {new_line: []}});
      if (url.pathname === '/api/v1/lines') return Response.json({data: url.searchParams.get('username') === line.username && (!url.searchParams.has('on_site') || line.on_site) ? [{id: line.id, username: line.username, on_site: line.on_site}] : []});
      if (url.pathname === '/api/v1/lines/42' && method === 'GET') return Response.json({data: line});
      if (url.pathname === '/api/v1/lines/42/renew') {
        renewals.push(new Headers(init.headers).get('Idempotency-Key')!);
        if (!renewalOutcome) return Response.json({data: {}});
        const sub = Array.from(subscriptions.values())[0];
        line.expires_at = sub.billing_info.next_billing_time;
        if (scheduleDrift) line.expires_at = new Date(Date.parse(line.expires_at) - 48 * 60 * 60 * 1000).toISOString();
        line.status = 'active'; return Response.json({data: {line: {id: 42}}});
      }
    }
    throw new Error('Unmocked HTTP: ' + method + ' ' + url.href);
  };
});
test.afterEach(() => {sqlite.close(); globalThis.fetch = nativeFetch; Date.now = nativeNow;});
async function call(handler: (request: Request) => Promise<Response>, path: string, body?: any, cookie?: string, extra: Record<string, string> = {}) {
  const request = new Request(origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {...(body === undefined ? {} : {'Content-Type': 'application/json', Origin: origin}), ...(cookie ? {Cookie: cookie} : {}), ...extra}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  runtime.__subscriptionHeaders = request.headers;
  const response = await handler(request), data = await response.json() as any;
  return {response, data, cookie: response.headers.get('Set-Cookie')?.split(';')[0]};
}
async function signed() {const result = await call(login, '/api/player/renew/login', {username, password}); assert.equal(result.response.status, 200, JSON.stringify(result.data)); return result;}
async function ready() {for (let step = 0; step < 4; step++) await setupSubscriptionCatalog(origin); assert.equal(plans.size, 12);}
async function begin() {await ready(); const auth = await signed(); const result = await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie); assert.equal(result.response.status, 200, JSON.stringify(result.data)); return {...result, auth, sub: Array.from(subscriptions.values())[0]};}
function signature() {return {'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/test.pem', 'paypal-transmission-id': 'test-id', 'paypal-transmission-sig': 'test-signature', 'paypal-transmission-time': new Date(now).toISOString()};}
async function event(type: string, resource: any, id = crypto.randomUUID()) {return call(webhook, '/api/paypal/webhook', {id, event_type: type, resource}, undefined, signature());}
function pay(sub: any, id = 'SALE42') {now = Date.parse(sub.start_time) + 1000; sub.status = 'ACTIVE'; sub.billing_info.next_billing_time = plusMonths(sub.start_time, 3); const sale = {id, billing_agreement_id: sub.id, create_time: new Date(now).toISOString()}; transactions.get(sub.id)!.push({id, status: 'COMPLETED', time: sale.create_time, amount_with_breakdown: {gross_amount: {currency_code: 'USD', value: '59.00'}}}); return sale;}

test('catalog creates 12 fixed-price plans in resumable steps, expands webhook events and keeps secrets private', async () => {
  const first = await setupSubscriptionCatalog(origin); assert.equal(first.plan_count, 3); assert.equal(first.ready, false);
  for (let count = 0; count < 3; count++) await setupSubscriptionCatalog(origin);
  const result = await setupSubscriptionCatalog(origin); assert.equal(result.ready, true); assert.equal(result.plan_count, 12);
  assert.equal(requests.filter(request => request.url.endsWith('/v1/catalogs/products')).length, 1); assert.equal(plans.size, 12);
  assert.ok(webhookEvents.includes('PAYMENT.SALE.COMPLETED')); assert.ok(webhookEvents.includes('BILLING.SUBSCRIPTION.PAYMENT.FAILED'));
  for (const plan of plans.values()) {assert.equal(plan.payment_preferences.auto_bill_outstanding, false); assert.equal(plan.payment_preferences.payment_failure_threshold, 1); assert.equal(plan.payment_preferences.setup_fee, undefined);}
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('owner setup and queue require the owner session and same-origin writes', async () => {
  const token = 'a'.repeat(64), version = 'b'.repeat(32);
  sqlite.prepare('INSERT INTO owner_credentials (id,email,password_hash,recovery_hash,version,created,updated) VALUES (?,?,?,?,?,?,?)').run('owner', 'support@lumanest.tv', 'scrypt$32768$8$3$' + 'c'.repeat(32) + '$' + 'd'.repeat(128), 'e'.repeat(64), version, now, now);
  assert.equal((await call(ownerGet, '/api/manage/subscriptions')).response.status, 401);
  assert.equal((await call(ownerSetup, '/api/manage/subscriptions', {}, undefined, {Origin: 'https://other.test'})).response.status, 403);
  sqlite.prepare('INSERT INTO owner_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'owner', version, now + 100000);
  const result = await call(ownerSetup, '/api/manage/subscriptions', {}, '__Host-lumanest_owner=' + token); assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const queue = await call(ownerGet, '/api/manage/subscriptions?view=queue', undefined, '__Host-lumanest_owner=' + token); assert.deepEqual(queue.data, {subscriptions: [], payments: []});
});
test('recurring stays unavailable until webhook catalog binding is confirmed', async () => {
  await ready(); sqlite.prepare('UPDATE subscription_catalog SET webhook_id=NULL').run(); const auth = await signed();
  const result = await call(billing, '/api/player/renew/subscription', undefined, auth.cookie); assert.equal(result.data.available, false); assert.equal(result.data.pay_once_available, true);
  assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie)).response.status, 503);
  assert.equal(subscriptions.size, 0);
});
test('a rejected enrollment request releases the line for a later enrollment or renewal', async () => {
  await ready(); const auth = await signed(); createFail = true;
  assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie)).response.status, 502);
  assert.deepEqual({...sqlite.prepare('SELECT state,line_slot FROM subscriptions').get()}, {state: 'CANCELLED', line_slot: null});
  createFail = false;
  assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie)).response.status, 200);
});
test('enrollment requires explicit consent, authentic line and unchanged sealed paid-through date', async () => {
  await ready(); const auth = await signed();
  for (const body of [{consent: false}, {consent: true, lineId: 99}, {consent: true, amount: '1.00'}]) assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, ...body}, auth.cookie)).response.status, 400);
  assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie, {Origin: 'https://other.test'})).response.status, 403);
  line.expires_at = new Date(now - 2 * 86400000).toISOString(); assert.equal((await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie)).response.status, 409);
  assert.equal(subscriptions.size, 0); assert.equal(renewals.length, 0);
});
test('paid active line starts billing at exact expiry and approval return does not renew or capture', async () => {
  line.status = 'active'; line.expires_at = new Date(now + 30 * 86400000).toISOString(); const result = await begin();
  assert.equal(result.sub.start_time, line.expires_at); result.sub.status = 'ACTIVE';
  const verified = await call(returned, '/api/subscriptions/return?subscription=' + result.data.subscription_id + '&subscription_id=' + result.sub.id);
  assert.equal(verified.data.status, 'active'); assert.equal(renewals.length, 0); assert.equal(requests.some(request => request.url.includes('/capture')), false);
  assert.equal((await call(returned, '/api/subscriptions/return?subscription=' + crypto.randomUUID() + '&subscription_id=' + result.sub.id)).response.status, 404);
});
test('fresh plan verification refuses edited terms without trapping the customer line', async () => {
  await ready(); const auth = await signed(); const plan = Array.from(plans.values()).find(plan => plan.billing_cycles[0].frequency.interval_count === 3 && plan.billing_cycles[0].pricing_scheme.fixed_price.value === '59.00'); plan.payment_preferences.auto_bill_outstanding = true;
  const result = await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie); assert.equal(result.response.status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM subscriptions').get()!.count, 0);
});
test('concurrent enrollments reserve one line and block overlapping pay-once checkout', async () => {
  await ready(); const auth = await signed(), body = {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true};
  const results = await Promise.all([call(enroll, '/api/player/renew/subscription', body, auth.cookie), call(enroll, '/api/player/renew/subscription', body, auth.cookie)]);
  assert.equal(results.filter(result => result.response.status === 200).length, 1); assert.equal(subscriptions.size, 1);
  assert.equal((await call(checkout, '/api/player/renew/checkout', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token}, auth.cookie)).response.status, 409);
});
test('unapproved manual checkout is atomically abandoned and late approval never captures it', async () => {
  await ready(); const auth = await signed(); const manual = await call(checkout, '/api/player/renew/checkout', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token}, auth.cookie); assert.equal(manual.response.status, 200, JSON.stringify(manual.data));
  const result = await call(enroll, '/api/player/renew/subscription', {months: 3, email: 'receipt@example.test', quoteToken: auth.data.quote_token, consent: true}, auth.cookie); assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(sqlite.prepare('SELECT state FROM orders').get()!.state, 'abandoned');
  const order = Array.from(orders.values())[0]; order.status = 'APPROVED'; await event('CHECKOUT.ORDER.APPROVED', {id: order.id});
  const captured = await call(capture, '/api/checkout/capture', {order: manual.data.order_id, token: order.id}); assert.equal(captured.data.state, 'abandoned'); assert.equal(renewals.length, 0);
  order.status = 'COMPLETED'; order.purchase_units[0].payments = {captures: [{id: 'CAPTURE42', status: 'COMPLETED', amount: {currency_code: 'USD', value: '59.00'}}]};
  const paid = {supplementary_data: {related_ids: {order_id: order.id}}};
  await event('PAYMENT.CAPTURE.COMPLETED', paid); await event('PAYMENT.CAPTURE.COMPLETED', paid);
  assert.equal(sqlite.prepare('SELECT state FROM orders').get()!.state, 'needs_review'); assert.notEqual(sqlite.prepare('SELECT attempted FROM orders').get()!.attempted, null); assert.equal(renewals.length, 0);
});
test('a canonical completed scheduled sale renews once under concurrent duplicate events', async () => {
  const result = await begin(), sale = pay(result.sub), ids = [crypto.randomUUID(),crypto.randomUUID()];
  const events = await Promise.all(ids.map(id=>event('PAYMENT.SALE.COMPLETED',sale,id)));
  assert.ok(events.some(result=>result.response.status===200));
  assert.ok(events.every(result=>[200,503].includes(result.response.status)),JSON.stringify(events.map(result=>result.data)));
  for(const [index,delivery] of events.entries()) {
    if(delivery.response.status===503) {
      assert.equal(delivery.data.error.code,'webhook_processing');
      assert.equal(sqlite.prepare('SELECT id FROM paypal_webhook_events WHERE id=?').get(ids[index]),undefined);
      assert.equal((await event('PAYMENT.SALE.COMPLETED',sale,ids[index])).response.status,200);
    }
    assert.ok(sqlite.prepare('SELECT id FROM paypal_webhook_events WHERE id=?').get(ids[index]));
  }
  assert.deepEqual(renewals, ['paypal-sale-SALE42']);
  assert.equal(sqlite.prepare('SELECT state FROM subscription_payments').get()!.state, 'fulfilled'); assert.equal(sqlite.prepare('SELECT state FROM subscriptions').get()!.state, 'ACTIVE');
  const options = await call(billing, '/api/player/renew/subscription', undefined, result.auth.cookie); assert.equal(options.data.subscription.last_payment_status, 'fulfilled');
  for (const privateValue of [password, 'test-provider-secret', 'receipt@example.test', 'line_id', 'credential']) assert.equal(JSON.stringify(options.data).includes(privateValue), false);
});
test('different sale IDs for the same cycle serialize, retain retryable receipt and cannot double-extend', async () => {
  const result = await begin(), first = pay(result.sub), second = {...first, id: 'SALE43'};
  transactions.get(result.sub.id)!.push({...transactions.get(result.sub.id)![0], id: second.id});
  const events = await Promise.all([event('PAYMENT.SALE.COMPLETED', first), event('PAYMENT.SALE.COMPLETED', second)]);
  assert.equal(renewals.length, 1); assert.ok(events.some(result => result.response.status === 503));
  const retryID = sqlite.prepare("SELECT sale_id FROM subscription_payments WHERE state='verified'").get()!.sale_id;
  await event('PAYMENT.SALE.COMPLETED', retryID === first.id ? first : second);
  assert.equal(renewals.length, 1); assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM subscription_payments WHERE state='needs_review'").get()!.count, 1); assert.equal(result.sub.status, 'SUSPENDED');
});
test('pending payment, mismatched amount and mismatched binding never spend wallet', async () => {
  for (const mutation of ['pending', 'amount', 'binding']) {
    const result = await begin(), sale = pay(result.sub);
    if (mutation === 'pending') transactions.get(result.sub.id)![0].status = 'PENDING';
    if (mutation === 'amount') transactions.get(result.sub.id)![0].amount_with_breakdown.gross_amount.value = '1.00';
    if (mutation === 'binding') result.sub.custom_id = crypto.randomUUID();
    // Unverifiable payments are recorded for review and acknowledged, so PayPal does not keep retrying them.
    assert.equal((await event('PAYMENT.SALE.COMPLETED', sale)).response.status, 200); assert.equal(renewals.length, 0); assert.equal(sqlite.prepare('SELECT state FROM subscriptions').get()!.state, 'needs_review', mutation);
    sqlite.prepare('DELETE FROM subscriptions').run(); sqlite.prepare('DELETE FROM subscription_payments').run(); subscriptions.clear(); transactions.clear(); sqlite.prepare('DELETE FROM player_login_attempts').run();
  }
});
test('pending merchant-controlled drafts can be abandoned and old approval links cannot activate', async () => {
  const result = await begin(); const cancelled = await call(cancel, '/api/player/renew/subscription/cancel', {}, result.auth.cookie); assert.equal(cancelled.response.status, 200); assert.equal(cancelled.data.pay_once_available, true); assert.equal(cancelled.data.subscription.status, 'cancelled');
  assert.equal(requests.filter(request => request.url.endsWith('/cancel')).length, 0);
  assert.equal(requests.filter(request => new URL(request.url).pathname.endsWith('/transactions')).length, 0);
  result.sub.status = 'APPROVED'; await event('BILLING.SUBSCRIPTION.UPDATED', {id: result.sub.id}); assert.equal(sqlite.prepare('SELECT line_slot FROM subscriptions').get()!.line_slot, null); assert.equal(renewals.length, 0);
  assert.equal((await call(activate, '/api/player/renew/subscription/activate', {subscription: result.data.subscription_id, subscription_id: result.sub.id}, result.auth.cookie)).response.status, 409);
  assert.equal(requests.filter(request => request.url.endsWith('/activate')).length, 0);
});
test('draft cancellation retains reservations for stored or canonical billing activity and attempted activation', async () => {
  for (const kind of ['stored_payment', 'last_payment', 'completed_cycle', 'outstanding_balance', 'failed_payment', 'activation_attempted']) {
    const result = await begin();
    if (kind === 'stored_payment') sqlite.prepare("INSERT INTO subscription_payments (sale_id,subscription_id,amount,currency,state,paid_at,created) VALUES ('SALE42',?,'59.00','USD','verified',?,?)").run(result.data.subscription_id, new Date(now).toISOString(), now);
    if (kind === 'last_payment') result.sub.billing_info.last_payment = {amount: {currency_code: 'USD', value: '59.00'}, time: new Date(now).toISOString()};
    if (kind === 'completed_cycle') result.sub.billing_info.cycle_executions = [{cycles_completed: 1}];
    if (kind === 'outstanding_balance') result.sub.billing_info.outstanding_balance = {currency_code: 'USD', value: '59.00'};
    if (kind === 'failed_payment') result.sub.billing_info.failed_payments_count = 1;
    if (kind === 'activation_attempted') sqlite.prepare('UPDATE subscriptions SET activation_attempted=?').run(now);
    const response = await call(cancel, '/api/player/renew/subscription/cancel', {}, result.auth.cookie);
    assert.equal(response.response.status, kind === 'activation_attempted' ? 200 : 409, kind + ': ' + JSON.stringify(response.data));
    assert.equal(sqlite.prepare('SELECT line_slot FROM subscriptions').get()!.line_slot, 42, kind);
    assert.equal(requests.filter(request => new URL(request.url).pathname.endsWith('/transactions')).length, 0, kind);
    sqlite.prepare('DELETE FROM subscriptions').run(); sqlite.prepare('DELETE FROM subscription_payments').run(); subscriptions.clear(); transactions.clear(); sqlite.prepare('DELETE FROM player_login_attempts').run();
  }
});
test('completed-sale transaction ranges never extend into the future and future receipts never renew', async () => {
  const result = await begin(), sale = pay(result.sub);
  await event('PAYMENT.SALE.COMPLETED', sale);
  const reads = requests.filter(request => new URL(request.url).pathname.endsWith('/transactions'));
  assert.ok(reads.length > 0); for (const read of reads) assert.ok(Date.parse(new URL(read.url).searchParams.get('end_time')!) <= now);
  const future = {...sale, id: 'SALEFUTURE', create_time: new Date(now + 60000).toISOString()};
  transactions.get(result.sub.id)!.push({id: future.id, status: 'COMPLETED', time: future.create_time, amount_with_breakdown: {gross_amount: {currency_code: 'USD', value: '59.00'}}});
  assert.equal((await event('PAYMENT.SALE.COMPLETED', future)).response.status, 200); assert.equal(renewals.length, 1); assert.equal(sqlite.prepare('SELECT state FROM subscriptions').get()!.state, 'needs_review');
});
test('merchant activation requires same-line session plus approved PayPal binding and never renews', async () => {
  const result = await begin(), body = {subscription: result.data.subscription_id, subscription_id: result.sub.id};
  assert.equal((await call(activate, '/api/player/renew/subscription/activate', body)).response.status, 401);
  assert.equal((await call(activate, '/api/player/renew/subscription/activate', body, result.auth.cookie)).response.status, 409);
  result.sub.status = 'APPROVED'; const enabled = await call(activate, '/api/player/renew/subscription/activate', body, result.auth.cookie); assert.equal(enabled.response.status, 200, JSON.stringify(enabled.data)); assert.equal(enabled.data.status, 'active'); assert.equal(renewals.length, 0);
  assert.equal(requests.find(request => request.url.endsWith('/v1/billing/subscriptions'))!.body.application_context.user_action, 'CONTINUE');
});
test('disabled off-site customer can sign into billing management and cancel through successful204', async () => {
  const result = await begin(); result.sub.status = 'ACTIVE'; line.status = 'disabled'; line.on_site = false;
  const auth = await call(manageLogin, '/api/player/renew/subscription/login', {username, password}); assert.equal(auth.response.status, 200, JSON.stringify(auth.data)); assert.equal(auth.data.subscription.cancel_available, true);
  assert.equal((await call(cancel, '/api/player/renew/subscription/cancel', {}, auth.cookie)).data.subscription.status, 'cancelled'); assert.equal(renewals.length, 0);
});
test('provider uncertainty stays reviewed, retries pause, and does not fulfill another cycle', async () => {
  const result = await begin(), sale = pay(result.sub); renewalOutcome = false; suspendFail = true;
  await event('PAYMENT.SALE.COMPLETED', sale); assert.equal(renewals.length, 1); assert.equal(sqlite.prepare('SELECT state FROM subscription_payments').get()!.state, 'needs_review'); assert.equal(sqlite.prepare('SELECT pause_confirmed FROM subscriptions').get()!.pause_confirmed, 0);
  suspendFail = false; const options = await call(billing, '/api/player/renew/subscription', undefined, result.auth.cookie); assert.equal(options.data.subscription.status, 'needs_review'); assert.equal(result.sub.status, 'SUSPENDED');
  const second = {...sale, id: 'SALE43'}; transactions.get(result.sub.id)!.push({...transactions.get(result.sub.id)![0], id: second.id}); await event('PAYMENT.SALE.COMPLETED', second); assert.equal(renewals.length, 1); assert.equal(sqlite.prepare('SELECT state FROM subscriptions').get()!.state, 'needs_review');
});
test('a fulfilled renewal with unconfirmed calendar alignment pauses future billing without repeating it', async () => {
  const result = await begin(), sale = pay(result.sub); scheduleDrift = true; await event('PAYMENT.SALE.COMPLETED', sale);
  assert.equal(renewals.length, 1); assert.equal(sqlite.prepare('SELECT state FROM subscription_payments').get()!.state, 'fulfilled'); assert.equal(sqlite.prepare('SELECT state FROM subscriptions').get()!.state, 'needs_review'); assert.equal(result.sub.status, 'SUSPENDED');
});
test('refund without billing_agreement_id finds stored sale and pauses its agreement', async () => {
  const result = await begin(), sale = pay(result.sub); await event('PAYMENT.SALE.COMPLETED', sale); await event('PAYMENT.SALE.REFUNDED', {id: 'REFUND42', sale_id: sale.id});
  assert.equal(result.sub.status, 'SUSPENDED'); assert.equal(sqlite.prepare('SELECT state FROM subscription_payments').get()!.state, 'needs_review'); assert.equal(renewals.length, 1);
});

function ownerSession() {
  const token = 'f'.repeat(64), version = 'b'.repeat(32);
  sqlite.prepare('INSERT INTO owner_credentials (id,email,password_hash,recovery_hash,version,created,updated) VALUES (?,?,?,?,?,?,?)').run('owner', 'support@lumanest.tv', 'scrypt$32768$8$3$' + 'c'.repeat(32) + '$' + 'd'.repeat(128), 'e'.repeat(64), version, now, now);
  sqlite.prepare('INSERT INTO owner_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'owner', version, now + 100000);
  return '__Host-lumanest_owner=' + token;
}
test('owner review re-checks agreements with PayPal and releases the line only when closed', async () => {
  const result = await begin(), owner = ownerSession(), id = result.data.subscription_id;
  assert.equal((await call(reviewGet, '/api/manage/reconcile')).response.status, 401);
  assert.equal((await call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id}, owner, {Origin: 'https://other.test'})).response.status, 403);
  sqlite.prepare("UPDATE subscriptions SET state='needs_review',error='enrollment_not_confirmed'").run(); result.sub.status = 'ACTIVE';
  const queue = await call(reviewGet, '/api/manage/reconcile', undefined, owner);
  assert.equal(queue.response.status, 200); assert.equal(queue.data.subscriptions[0].id, id); assert.equal(JSON.stringify(queue.data).includes('receipt@example.test'), false);
  const open = await call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id}, owner);
  assert.equal(open.response.status, 200, JSON.stringify(open.data)); assert.equal(open.data.state, 'needs_review'); assert.equal(open.data.line_released, false); assert.equal(result.sub.status, 'SUSPENDED');
  result.sub.status = 'CANCELLED';
  const closed = await call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id}, owner);
  assert.equal(closed.data.state, 'CANCELLED'); assert.equal(closed.data.line_released, true); assert.equal(sqlite.prepare('SELECT line_slot FROM subscriptions').get()!.line_slot, null);
  assert.equal((await call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id}, owner)).data.state, 'CANCELLED');
  assert.equal(renewals.length, 0);
});
test('owner review cancels enrollments that never received a PayPal agreement once they are stale', async () => {
  const owner = ownerSession(), insert = sqlite.prepare("INSERT INTO subscriptions (id,plan_id,line_id,line_slot,credential,devices,months,amount,currency,email,name,state,mode,starts_at,created,updated) VALUES (?,'P-PLAN',?,?,'digest',2,3,'59.00','USD','r@example.test','',?,'live','2026-10-01T00:00:00.000Z',?,?)");
  const fresh = crypto.randomUUID(), stale = crypto.randomUUID(), reviewed = crypto.randomUUID();
  insert.run(fresh, 41, 41, 'creating', now, now); insert.run(stale, 42, 42, 'creating', now - 10 * 60 * 1000, now); insert.run(reviewed, 43, 43, 'needs_review', now, now);
  const recheck = (id: string) => call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id}, owner);
  assert.equal((await recheck(fresh)).data.state, 'creating');
  for (const id of [stale, reviewed]) {const result = await recheck(id); assert.equal(result.data.state, 'CANCELLED'); assert.equal(result.data.line_released, true);}
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE line_slot IS NOT NULL').get()!.count, 1);
  assert.equal(requests.filter(request => request.url.includes('/v1/billing/subscriptions')).length, 0);
  assert.equal((await call(reviewPost, '/api/manage/reconcile', {action: 'recheck', kind: 'subscription', id: 'missing'}, owner)).response.status, 404);
  assert.equal((await call(reviewPost, '/api/manage/reconcile', {action: 'explode', kind: 'subscription', id: stale}, owner)).response.status, 400);
  const cleaned = await call(reviewPost, '/api/manage/reconcile', {action: 'cleanup'}, owner);
  assert.equal(cleaned.response.status, 200); assert.equal(typeof cleaned.data.cleaned.owner_sessions, 'number');
});
test('verified subscription events are deduplicated by PayPal event id', async () => {
  const result = await begin(), sale = pay(result.sub), body = {id: 'WH-DUPLICATE-1', event_type: 'PAYMENT.SALE.COMPLETED', resource: sale};
  for (let count = 0; count < 2; count++) assert.equal((await call(webhook, '/api/paypal/webhook', body, undefined, signature())).response.status, 200);
  assert.deepEqual(renewals, ['paypal-sale-SALE42']);
  assert.equal(requests.filter(request => new URL(request.url).pathname.endsWith('/transactions')).length, 1);
});
