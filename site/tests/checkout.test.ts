import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';

// Exercise the actual payment handlers with SQLite and fully mocked provider HTTP.
// No payment processor or reseller request can leave this test process.
const runtime = globalThis as unknown as {__checkoutEnv: Record<string, unknown>};
runtime.__checkoutEnv = {};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env = globalThis.__checkoutEnv;', shortCircuit: true};
    return next(specifier, context);
  }
});
const {createCheckout, captureCheckout, fulfill, webhook, paypalReady, setupPayPalWebhook, clearProviderSnapshot} = await import('../lib/paypal.ts');
const {bunny} = await import('../lib/mybunny.ts');
const {reconcileOrder, resolveOrder, reviewQueue} = await import('../lib/reconcile.ts');
const {cleanup} = await import('../lib/maintenance.ts');
hooks.deregister();

const nativeFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = nativeFetch; });
let sqlite: DatabaseSync;
let http: (url: string, init: RequestInit) => Promise<Response>;
let requests: {url: string; init: RequestInit}[];

test.beforeEach(() => {
  clearProviderSnapshot();
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const database = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {async all() { return {results: statement.all()}; }, bind(...args: (string | number | null)[]) {
        return {async run() { const result = statement.run(...args); return {meta: {changes: Number(result.changes)}}; }, async first() { return statement.get(...args) ?? null; }, async all() { return {results: statement.all(...args)}; }};
      }};
    }
  };
  delete runtime.__checkoutEnv.CUSTOMER_PORTAL_PRIMARY_URL;
  Object.assign(runtime.__checkoutEnv, {DB: database, PAYPAL_MODE: 'live', CHECKOUT_ENABLED: 'true', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', PAYPAL_WEBHOOK_ID: 'test-webhook', MYBUNNY_API_KEY: 'test-provider', CUSTOMER_PORTAL_URL: 'https://tv.lumanest.tv'});
  requests = [];
  http = async url => {
    if (url.endsWith('/v1/oauth2/token')) return Response.json({access_token: 'mock-token'});
    if (url.endsWith('/verify-webhook-signature')) return Response.json({verification_status: 'SUCCESS'});
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) return Response.json(payment());
    if (url.endsWith('/api/v1/lines')) return Response.json({data: {line: {id: 42}}});
    throw new Error('Unexpected mock HTTP request: ' + url);
  };
  globalThis.fetch = async (url, init) => {
    const request = {url: String(url), init: init ?? {}};
    requests.push(request);
    return http(request.url, request.init);
  };
});
test.afterEach(() => sqlite.close());

function row() {
  return {id: 'local-order', paypal_id: 'PAYPALORDER', email: 'test@example.com', name: 'Test', kind: 'new', line_id: null, devices: 1, months: 12, amount: '95.00', state: 'created', created: 1, attempted: null};
}
function seed() {
  const order = row();
  sqlite.prepare('INSERT INTO orders (id,paypal_id,email,name,kind,line_id,devices,months,amount,state,created,attempted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(order));
  return order;
}
function saved() { return sqlite.prepare('SELECT * FROM orders WHERE id=?').get('local-order') as Record<string, unknown>; }
function payment(status = 'COMPLETED') {
  return {id: 'PAYPALORDER', status, purchase_units: [{custom_id: 'local-order', amount: {currency_code: 'USD', value: '95.00'}, payments: {captures: [{id: 'CAPTUREID', status: 'COMPLETED', amount: {currency_code: 'USD', value: '95.00'}}]}}]};
}
function signedHeaders() {
  return new Headers({'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/test.pem', 'paypal-transmission-id': 'mock-id', 'paypal-transmission-sig': 'mock-sig', 'paypal-transmission-time': '2026-10-14T12:00:00Z'});
}
function completedEvent() { return {id: 'event-id', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {supplementary_data: {related_ids: {order_id: 'PAYPALORDER'}}}}; }
function lineWrites() { return requests.filter(r => r.url.endsWith('/api/v1/lines') && r.init.method === 'POST'); }

test('live checkout stays closed before creating orders when the webhook is missing', async () => {
  delete runtime.__checkoutEnv.PAYPAL_WEBHOOK_ID;
  assert.equal(paypalReady(), false);
  await assert.rejects(createCheckout({devices: 1, months: 12, email: 'test@example.com', name: 'Test'}, 'https://lumanest.tv'), {code: 'checkout_unavailable'});
  assert.equal(requests.length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count, 0);
});

test('unknown funds or invalid quotes prevent customer payment creation', async () => {
  for (const [balance, quote] of [[undefined, 25], ['unknown', 25], [100, 0], [100, -1], [100, null]]) {
    http = async url => {
      if (url.endsWith('/account')) return Response.json({data: {balance, site: {status: 'approved', address: 'https://tv.lumanest.tv', email_ready: true}}});
      if (url.endsWith('/prices')) return Response.json({data: {new_line: [{devices: 1, months: 12, price: quote}]}});
      throw new Error('A payment must not be created');
    };
    await assert.rejects(createCheckout({devices: 1, months: 12, email: 'test@example.com', name: 'Test'}, 'https://lumanest.tv'), {code: 'activation_unavailable'});
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count, 0);
});

test('a renewal screen change between the quoted selection and checkout prevents payment creation', async () => {
  http = async url => {
    if (url.endsWith('/account')) return Response.json({data: {balance: 213.5, site: {status: 'approved', address: 'https://tv.lumanest.tv'}}});
    if (url.endsWith('/prices')) return Response.json({data: {new_line: []}});
    if (url.endsWith('/lines/42')) return Response.json({data: {id: 42, devices: 3, prices: {renew: [{months: 3, price: 65}]}}});
    throw new Error('A payment must not be created after a plan change');
  };
  await assert.rejects(createCheckout({devices: 2, months: 3, email: 'receipt@example.test', name: '', lineId: 42}, 'https://lumanest.tv'), {code: 'renewal_plan_changed', status: 409});
  assert.equal(requests.some(request => request.url.startsWith('https://api-m.paypal.com/')), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count, 0);
});

test('a verified provider primary allows a public portal alias without changing payment return URLs', async () => {
  runtime.__checkoutEnv.CUSTOMER_PORTAL_URL = 'https://portal.lumanest.tv';
  runtime.__checkoutEnv.CUSTOMER_PORTAL_PRIMARY_URL = 'https://tv.lumanest.tv';
  http = async (url, init) => {
    if (url.endsWith('/account')) return Response.json({data: {balance: 213.5, site: {status: 'approved', address: 'https://tv.lumanest.tv', email_ready: true}}});
    if (url.endsWith('/prices')) return Response.json({data: {new_line: [{devices: 1, months: 12, price: 85}]}});
    if (url.endsWith('/v1/oauth2/token')) return Response.json({access_token: 'mock-token'});
    if (url.endsWith('/v2/checkout/orders') && init.method === 'POST') return Response.json({id: 'PAYPALORDER', links: [{rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=PAYPALORDER'}]});
    throw new Error('Unexpected mock HTTP request: ' + url);
  };
  const result = await createCheckout({devices: 1, months: 12, email: 'qa@example.com', name: 'LumaNest QA'}, 'https://lumanest.tv');
  const request = requests.find(r => r.url.endsWith('/v2/checkout/orders') && r.init.method === 'POST');
  assert.ok(request);
  const body = JSON.parse(String(request.init.body));
  assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://lumanest.tv/checkout/return?order=' + result.order_id);
  assert.equal(body.payment_source.paypal.experience_context.cancel_url, 'https://lumanest.tv/checkout/cancel');
  assert.equal(body.purchase_units[0].amount.value, '95.00');
  assert.equal(result.approval_url, 'https://www.paypal.com/checkoutnow?token=PAYPALORDER');
  assert.equal(sqlite.prepare('SELECT state FROM orders WHERE id=?').get(result.order_id)?.state, 'created');
  assert.equal(lineWrites().length, 0);
});

test('a public portal alias cannot create a payment without the verified provider primary', async () => {
  runtime.__checkoutEnv.CUSTOMER_PORTAL_URL = 'https://portal.lumanest.tv';
  http = async url => {
    if (url.endsWith('/account')) return Response.json({data: {balance: 213.5, site: {status: 'approved', address: 'https://tv.lumanest.tv', email_ready: true}}});
    if (url.endsWith('/prices')) return Response.json({data: {new_line: [{devices: 1, months: 12, price: 85}]}});
    throw new Error('A payment must not be created');
  };
  await assert.rejects(createCheckout({devices: 1, months: 12, email: 'qa@example.com', name: 'LumaNest QA'}, 'https://lumanest.tv'), {code: 'portal_not_ready'});
  assert.equal(requests.some(r => r.url.startsWith('https://api-m.paypal.com/')), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count, 0);
});

test('an approved portal alias still requires customer invitations and sufficient wallet funds', async () => {
  runtime.__checkoutEnv.CUSTOMER_PORTAL_URL = 'https://portal.lumanest.tv';
  runtime.__checkoutEnv.CUSTOMER_PORTAL_PRIMARY_URL = 'https://tv.lumanest.tv';
  for (const [emailReady, balance, code] of [[false, 213.5, 'invitations_not_ready'], [true, 1, 'activation_unavailable']] as const) {
    clearProviderSnapshot();
    http = async url => {
      if (url.endsWith('/account')) return Response.json({data: {balance, site: {status: 'approved', address: 'https://tv.lumanest.tv', email_ready: emailReady}}});
      if (url.endsWith('/prices')) return Response.json({data: {new_line: [{devices: 1, months: 12, price: 85}]}});
      throw new Error('A payment must not be created');
    };
    await assert.rejects(createCheckout({devices: 1, months: 12, email: 'qa@example.com', name: 'LumaNest QA'}, 'https://lumanest.tv'), {code});
  }
  assert.equal(requests.some(r => r.url.startsWith('https://api-m.paypal.com/')), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count, 0);
});

test('a mismatched approved order is never captured', async () => {
  seed();
  http = async url => {
    if (url.endsWith('/v1/oauth2/token')) return Response.json({access_token: 'mock-token'});
    const altered = payment('APPROVED');
    altered.purchase_units[0].amount.value = '1.00';
    return Response.json(altered);
  };
  await assert.rejects(captureCheckout('local-order', 'PAYPALORDER'));
  assert.equal(requests.some(r => r.url.endsWith('/capture')), false);
  assert.equal(lineWrites().length, 0);
  assert.equal(saved().state, 'needs_review');
});

test('concurrent fulfillment requests spend the wallet once', async () => {
  const order = seed();
  const responses = await Promise.all([fulfill(order, payment()), fulfill(order, payment()), fulfill(order, payment())]);
  assert.equal(lineWrites().length, 1);
  assert.equal(new Headers(lineWrites()[0].init.headers).get('Idempotency-Key'), 'paypal-PAYPALORDER');
  assert.equal(saved().state, 'fulfilled');
  assert.equal(saved().fulfilled_line_id, 42);
  assert.equal(responses.some(result => result.state === 'fulfilled'), true);
});

test('a late pending response cannot undo webhook fulfillment', async () => {
  const order = seed();
  const defaultHttp = http;
  let release!: (value: Response) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) { began(); return new Promise(resolve => { release = resolve; }); }
    return defaultHttp(url, init);
  };
  const capture = captureCheckout(order.id, order.paypal_id);
  await started;
  await fulfill(order, payment());
  release(Response.json(payment('CREATED')));
  assert.equal((await capture).state, 'fulfilled');
  assert.equal(saved().state, 'fulfilled');
  assert.equal(lineWrites().length, 1);
});

test('a late failed response cannot overwrite an already fulfilled payment', async () => {
  const order = seed();
  const defaultHttp = http;
  let reject!: (reason: Error) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) { began(); return new Promise((_resolve, fail) => { reject = fail; }); }
    return defaultHttp(url, init);
  };
  const capture = captureCheckout(order.id, order.paypal_id);
  await started;
  await fulfill(order, payment());
  reject(new Error('Simulated timeout'));
  assert.equal((await capture).state, 'fulfilled');
  assert.equal(saved().error, null);
});

test('a signed completed webhook recovers a capture timeout before activation', async () => {
  const order = seed();
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) throw new Error('Simulated timeout');
    return defaultHttp(url, init);
  };
  await assert.rejects(captureCheckout(order.id, order.paypal_id), {code: 'paypal_outcome_unknown'});
  // Nothing was captured yet, so the order is released for a retry rather than stranded in review.
  assert.equal(saved().state, 'created');
  assert.equal(saved().attempted, null);
  http = defaultHttp;
  await webhook(completedEvent(), signedHeaders());
  await webhook(completedEvent(), signedHeaders());
  assert.equal(saved().state, 'fulfilled');
  assert.equal(lineWrites().length, 1);
});

test('a capture timeout after the capture request needs review', async () => {
  const order = seed();
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) return Response.json(payment('APPROVED'));
    if (url.endsWith('/capture')) throw new Error('Simulated timeout');
    return defaultHttp(url, init);
  };
  await assert.rejects(captureCheckout(order.id, order.paypal_id), {code: 'paypal_outcome_unknown'});
  assert.equal(saved().state, 'needs_review');
});

test('a PayPal outage before capture leaves the approval retryable', async () => {
  const order = seed();
  const defaultHttp = http;
  let down = true;
  http = async (url, init) => {
    if (down && url.endsWith('/v2/checkout/orders/PAYPALORDER')) return new Response('{}', {status: 503});
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) return Response.json(payment(captured ? 'COMPLETED' : 'APPROVED'));
    if (url.endsWith('/capture')) {captured = true; return Response.json(payment());}
    return defaultHttp(url, init);
  };
  let captured = false;
  await assert.rejects(captureCheckout(order.id, order.paypal_id), {code: 'paypal_error'});
  assert.equal(saved().state, 'created');
  down = false;
  assert.equal((await captureCheckout(order.id, order.paypal_id)).state, 'fulfilled');
  assert.equal(lineWrites().length, 1);
});

test('an unconfirmed provider activation needs review and is never blindly retried', async () => {
  const order = seed(), defaultHttp = http;
  http = async (url, init) => url.endsWith('/api/v1/lines') ? Response.json({data: {}}) : defaultHttp(url, init);
  assert.equal((await fulfill(order, payment())).state, 'needs_review');
  assert.notEqual(saved().attempted, null);
  await webhook(completedEvent(), signedHeaders());
  assert.equal(saved().state, 'needs_review');
  assert.equal(lineWrites().length, 1);
});

test('sandbox captures never spend the live wallet', async () => {
  const order = seed();
  runtime.__checkoutEnv.PAYPAL_MODE = 'sandbox';
  assert.equal((await fulfill(order, payment())).state, 'sandbox_paid');
  assert.equal((await fulfill(order, payment())).state, 'sandbox_paid');
  assert.equal(requests.length, 0);
  assert.equal(saved().attempted, null);
});

test('a signed approval webhook captures and activates once without a return-page visit', async () => {
  seed();
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) return Response.json(payment('APPROVED'));
    if (url.endsWith('/capture')) return Response.json(payment());
    return defaultHttp(url, init);
  };
  const event = {id: 'approval-event', event_type: 'CHECKOUT.ORDER.APPROVED', resource: {id: 'PAYPALORDER'}};
  await webhook(event, signedHeaders());
  await webhook(event, signedHeaders());
  assert.equal(requests.filter(r => r.url.endsWith('/capture')).length, 1);
  assert.equal(lineWrites().length, 1);
  assert.equal(saved().state, 'fulfilled');
});

test('sparse capture responses use canonical order details before activation', async () => {
  const order = seed(), defaultHttp = http;
  let captured = false;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) return Response.json(payment(captured ? 'COMPLETED' : 'APPROVED'));
    if (url.endsWith('/capture')) {
      captured = true;
      return Response.json({id: 'PAYPALORDER', status: 'COMPLETED', purchase_units: [{reference_id: order.id, payments: payment().purchase_units[0].payments}]});
    }
    return defaultHttp(url, init);
  };
  assert.equal((await captureCheckout(order.id, order.paypal_id)).state, 'fulfilled');
  assert.equal(requests.filter(r => r.url.endsWith('/v2/checkout/orders/PAYPALORDER')).length, 2);
  assert.equal(lineWrites().length, 1);
});

test('pending captures keep processing without spending the reseller wallet', async () => {
  const order = seed(), defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) {
      const details = payment();
      details.purchase_units[0].payments.captures[0].status = 'PENDING';
      return Response.json(details);
    }
    return defaultHttp(url, init);
  };
  assert.equal((await captureCheckout(order.id, order.paypal_id)).state, 'pending');
  assert.equal(saved().state, 'pending');
  assert.equal(lineWrites().length, 0);
});

test('unsigned webhook calls are rejected before upstream calls', async () => {
  seed();
  await assert.rejects(webhook(completedEvent(), new Headers()), {code: 'invalid_webhook'});
  assert.equal(requests.length, 0);
  assert.equal(saved().state, 'created');
});

test('malformed provider responses report an unknown outcome instead of success', async () => {
  http = async () => new Response('<html>Bad gateway</html>', {status: 200});
  await assert.rejects(bunny('/lines', 'POST', {devices: 1, months: 12}, 'mock-idempotency'), {code: 'outcome_unknown', status: 502});
});

test('webhook setup creates the fixed HTTPS subscription and returns no credentials', async () => {
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v1/notifications/webhooks')) {
      if (init.method === 'GET') return Response.json({webhooks: []});
      const body = JSON.parse(String(init.body));
      return Response.json({id: 'WEBHOOK42', ...body});
    }
    return defaultHttp(url, init);
  };
  const result = await setupPayPalWebhook('https://lumanest.tv');
  assert.equal(result.id, 'WEBHOOK42');
  assert.equal(result.url, 'https://lumanest.tv/api/paypal/webhook');
  assert.equal(result.action, 'created');
  assert.equal(result.mode, 'live');
  for (const type of ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.SALE.COMPLETED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'BILLING.SUBSCRIPTION.CANCELLED']) assert.ok(result.event_types.includes(type));
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
  assert.equal(requests.filter(r => r.url.endsWith('/webhooks') && r.init.method === 'POST').length, 1);
});

test('webhook setup reuses complete subscriptions and preserves existing events when adding missing events', async () => {
  const defaultHttp = http, url = 'https://lumanest.tv/api/paypal/webhook';
  let subscription = {id: 'WEBHOOK42', url, event_types: [{name: 'PAYMENT.CAPTURE.COMPLETED'}, {name: 'PAYMENT.CAPTURE.REFUNDED'}]};
  http = async (requestUrl, init) => {
    if (requestUrl.endsWith('/v1/notifications/webhooks')) return Response.json({webhooks: [subscription]});
    if (requestUrl.endsWith('/v1/notifications/webhooks/WEBHOOK42')) {
      const patch = JSON.parse(String(init.body));
      assert.equal(patch[0].op, 'replace');
      assert.equal(patch[0].path, '/event_types');
      subscription = {...subscription, event_types: patch[0].value};
      return Response.json(subscription);
    }
    return defaultHttp(requestUrl, init);
  };
  assert.equal((await setupPayPalWebhook('https://lumanest.tv')).action, 'updated');
  assert.equal(subscription.event_types.some(event => event.name === 'PAYMENT.CAPTURE.REFUNDED'), true);
  assert.equal((await setupPayPalWebhook('https://lumanest.tv')).action, 'reused');
  assert.equal(requests.filter(r => r.init.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.url.endsWith('/webhooks') && r.init.method === 'POST').length, 0);
});

test('webhook setup refuses insecure or unconfirmed subscriptions', async () => {
  await assert.rejects(setupPayPalWebhook('http://localhost'), {code: 'webhook_url_invalid'});
  assert.equal(requests.length, 0);
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v1/notifications/webhooks')) return init.method === 'GET' ? Response.json({webhooks: []}) : Response.json({id: 'WEBHOOK42', url: 'https://wrong.example/api/paypal/webhook', event_types: []});
    return defaultHttp(url, init);
  };
  await assert.rejects(setupPayPalWebhook('https://lumanest.tv'), {code: 'paypal_response_invalid'});
});

test('PayPal access tokens are reused until expiry and refreshed after a rejection', async () => {
  const {paypal, clearPayPalToken} = await import('../lib/paypal.ts');
  clearPayPalToken();
  let tokens = 0, rejectNext = false;
  http = async url => {
    if (url.endsWith('/v1/oauth2/token')) return Response.json({access_token: 'token-' + ++tokens, expires_in: 32400});
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) {
      if (rejectNext) {rejectNext = false; return new Response('{}', {status: 401});}
      return Response.json(payment());
    }
    throw new Error('Unexpected mock HTTP request: ' + url);
  };
  await paypal('/v2/checkout/orders/PAYPALORDER');
  await paypal('/v2/checkout/orders/PAYPALORDER');
  assert.equal(tokens, 1);
  rejectNext = true;
  assert.equal((await paypal('/v2/checkout/orders/PAYPALORDER')).id, 'PAYPALORDER');
  assert.equal(tokens, 2);
  clearPayPalToken();
});

function review(state = 'needs_review', changes: Record<string, unknown> = {}) {
  const order = seed();
  sqlite.prepare("UPDATE orders SET state=?,error='capture_not_verified' WHERE id=?").run(state, order.id);
  for (const [key, value] of Object.entries(changes)) sqlite.prepare(`UPDATE orders SET ${key}=? WHERE id=?`).run(value as string | number | null, order.id);
  return {...order, state, ...changes};
}
function orderReads() { return requests.filter(r => r.url.endsWith('/v2/checkout/orders/PAYPALORDER')); }

test('verified webhook events are processed once per PayPal event id', async () => {
  seed();
  await webhook(completedEvent(), signedHeaders());
  const reads = orderReads().length;
  assert.deepEqual(await webhook(completedEvent(), signedHeaders()), {received: true});
  assert.equal(orderReads().length, reads);
  assert.equal(lineWrites().length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM paypal_webhook_events').get()?.count, 1);
  await assert.rejects(webhook({...completedEvent(), id: 'bad id with spaces'}, signedHeaders()), {code: 'invalid_webhook'});
});

test('a transient webhook failure releases the event claim so the PayPal retry is processed', async () => {
  seed();
  const defaultHttp = http;
  http = async (url, init) => url.endsWith('/v2/checkout/orders/PAYPALORDER') ? new Response('{}', {status: 503}) : defaultHttp(url, init);
  await assert.rejects(webhook(completedEvent(), signedHeaders()), {code: 'paypal_error', status: 502});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM paypal_webhook_events').get()?.count, 0);
  http = defaultHttp;
  await webhook(completedEvent(), signedHeaders());
  assert.equal(saved().state, 'fulfilled');
  assert.equal(lineWrites().length, 1);
});

test('business conflicts in webhooks are recorded for review and acknowledged without retries', async () => {
  sqlite.prepare("INSERT INTO orders (id,paypal_id,email,name,kind,line_id,devices,months,amount,state,created) VALUES ('renew-order','RENEWORDER','test@example.com','Test','renew',42,1,12,'95.00','created',1)").run();
  sqlite.prepare("INSERT INTO subscriptions (id,paypal_id,plan_id,line_id,line_slot,credential,devices,months,amount,currency,email,name,state,mode,starts_at,created,updated) VALUES ('agreement','I-AGREEMENT','P-PLAN',42,42,'digest',1,12,'95.00','USD','test@example.com','Test','ACTIVE','live','2026-10-01T00:00:00.000Z',1,1)").run();
  assert.deepEqual(await webhook({id: 'approval-conflict', event_type: 'CHECKOUT.ORDER.APPROVED', resource: {id: 'RENEWORDER'}}, signedHeaders()), {received: true});
  assert.deepEqual({...sqlite.prepare("SELECT state,error,attempted FROM orders WHERE id='renew-order'").get()}, {state: 'needs_review', error: 'recurring_agreement_open', attempted: null});
  assert.equal(requests.some(r => r.url.endsWith('/capture')), false);
  seed();
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) {const altered = payment(); altered.purchase_units[0].payments.captures[0].amount.value = '1.00'; return Response.json(altered);}
    return defaultHttp(url, init);
  };
  assert.deepEqual(await webhook(completedEvent(), signedHeaders()), {received: true});
  assert.equal(saved().state, 'needs_review');
  assert.equal(saved().error, 'payment_not_verified');
  assert.equal(lineWrites().length, 0);
});

test('re-checking an approved order in review captures and activates it exactly once', async () => {
  review();
  const defaultHttp = http;
  let captured = false;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) {const details = payment(captured ? 'COMPLETED' : 'APPROVED'); if (!captured) delete (details.purchase_units[0] as any).payments; return Response.json(details);}
    if (url.endsWith('/capture')) {captured = true; return Response.json(payment());}
    return defaultHttp(url, init);
  };
  const results = await Promise.all([reconcileOrder('local-order'), reconcileOrder('local-order')]);
  assert.ok(results.some(result => result.state === 'fulfilled'));
  assert.equal(requests.filter(r => r.url.endsWith('/capture')).length, 1);
  assert.equal(lineWrites().length, 1);
  assert.equal((await reconcileOrder('local-order')).state, 'fulfilled');
  assert.equal(lineWrites().length, 1);
});

test('re-checking a completed capture in review fulfils only when activation was never attempted', async () => {
  review();
  assert.equal((await reconcileOrder('local-order')).state, 'fulfilled');
  assert.equal(saved().capture_id, 'CAPTUREID');
  assert.equal(lineWrites().length, 1);
  sqlite.prepare('DELETE FROM orders').run();
  review('needs_review', {attempted: 5});
  const before = requests.length;
  const result = await reconcileOrder('local-order') as {state: string; resolve_required?: boolean};
  assert.equal(result.state, 'needs_review');
  assert.equal(result.resolve_required, true);
  assert.equal(requests.length, before);
  assert.equal(lineWrites().length, 1);
  assert.equal((await reviewQueue()).orders[0].resolve_required, true);
  await assert.rejects(resolveOrder('local-order', ' '), {code: 'resolution_note_required'});
  assert.equal((await resolveOrder('local-order', 'Line 42 renewed manually; checked wallet')).state, 'resolved');
  assert.deepEqual({...sqlite.prepare('SELECT state,resolution,error FROM orders').get()}, {state: 'resolved', resolution: 'Line 42 renewed manually; checked wallet', error: 'capture_not_verified'});
  assert.equal((await resolveOrder('local-order', 'Second note')).state, 'resolved');
  assert.equal(sqlite.prepare('SELECT resolution FROM orders').get()?.resolution, 'Line 42 renewed manually; checked wallet');
  await assert.rejects(resolveOrder('missing-order', 'note'), {code: 'review_not_found'});
});

test('re-checking never spends the wallet for mismatched, uncreated or conflicting orders', async () => {
  review('needs_review', {paypal_id: null});
  assert.equal((await reconcileOrder('local-order')).state, 'abandoned');
  assert.equal(requests.length, 0);
  sqlite.prepare('DELETE FROM orders').run();
  review();
  const defaultHttp = http;
  http = async (url, init) => {
    if (url.endsWith('/v2/checkout/orders/PAYPALORDER')) {const altered = payment(); altered.purchase_units[0].amount.value = '1.00'; return Response.json(altered);}
    return defaultHttp(url, init);
  };
  await assert.rejects(reconcileOrder('local-order'), {code: 'review_order_mismatch'});
  assert.equal(saved().state, 'needs_review');
  http = defaultHttp;
  sqlite.prepare("UPDATE orders SET kind='renew',line_id=42").run();
  sqlite.prepare("INSERT INTO subscriptions (id,paypal_id,plan_id,line_id,line_slot,credential,devices,months,amount,currency,email,name,state,mode,starts_at,created,updated) VALUES ('agreement','I-AGREEMENT','P-PLAN',42,42,'digest',1,12,'95.00','USD','test@example.com','Test','ACTIVE','live','2026-10-01T00:00:00.000Z',1,1)").run();
  await assert.rejects(reconcileOrder('local-order'), {code: 'recurring_agreement_open'});
  assert.equal(saved().state, 'needs_review');
  assert.equal(lineWrites().length, 0);
});

test('cleanup purges expired rows and closes stale never-created checkouts idempotently', async () => {
  const now = Date.now(), old = now - 2 * 60 * 60 * 1000;
  sqlite.prepare("INSERT INTO owner_credentials (id,email,password_hash,recovery_hash,version,created,updated) VALUES ('owner','support@lumanest.tv','x','y','v',1,1)").run();
  sqlite.prepare("INSERT INTO owner_sessions VALUES ('expired','owner','v',?),('live','owner','v',?)").run(now - 1, now + 60000);
  sqlite.prepare("INSERT INTO owner_auth_attempts VALUES ('expired',1,?)").run(now - 1);
  sqlite.prepare("INSERT INTO player_login_attempts VALUES ('expired',1,?),('live',1,?)").run(now - 1, now + 60000);
  sqlite.prepare("INSERT INTO player_revoked_sessions VALUES ('expired',?)").run(now - 1);
  sqlite.prepare("INSERT INTO billing_line_locks VALUES (7,'token',?)").run(now - 1);
  sqlite.prepare("INSERT INTO paypal_webhook_events VALUES ('old','X',?),('recent','X',?)").run(now - 31 * 24 * 60 * 60 * 1000, now);
  sqlite.prepare("INSERT INTO orders (id,email,name,kind,devices,months,amount,state,created) VALUES ('stale','a@b.test','','new',1,12,'95.00','creating',?),('fresh','a@b.test','','new',1,12,'95.00','creating',?)").run(old, now);
  sqlite.prepare("INSERT INTO subscriptions (id,plan_id,line_id,line_slot,credential,devices,months,amount,currency,email,name,state,mode,starts_at,created,updated) VALUES ('stale-sub','P-PLAN',42,42,'digest',1,12,'95.00','USD','a@b.test','','creating','live','2026-10-01T00:00:00.000Z',?,?)").run(old, old);
  assert.deepEqual(await cleanup(now), {owner_sessions: 1, owner_auth_attempts: 1, player_login_attempts: 1, player_revoked_sessions: 1, billing_line_locks: 1, paypal_webhook_events: 1, abandoned_orders: 1, cancelled_enrollments: 1});
  assert.deepEqual({...sqlite.prepare("SELECT state,error FROM orders WHERE id='stale'").get()}, {state: 'abandoned', error: 'checkout_not_created'});
  assert.equal(sqlite.prepare("SELECT state FROM orders WHERE id='fresh'").get()?.state, 'creating');
  assert.deepEqual({...sqlite.prepare('SELECT state,line_slot,error FROM subscriptions').get()}, {state: 'CANCELLED', line_slot: null, error: 'enrollment_not_created'});
  assert.ok(Object.values(await cleanup(now)).every(count => count === 0));
  assert.equal((await import('../lib/paypal.ts').then(m => m.status('stale'))).message, 'This checkout was not completed. No payment was captured by this website.');
});
