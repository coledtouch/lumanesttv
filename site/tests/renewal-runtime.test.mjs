import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {open, seal} from '../lib/player-crypto.ts';

let runtime, database, upstream;
const key = 'b'.repeat(64);
const username = 'runtime-renewal-line';
const password = 'runtime-private-line-password';
const origin = 'https://lumanest.tv';
const prefix = '/api/player/renew';
const receipt = 'receipt@example.test';

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {GET} from './app/api/player/renew/route.ts';
        import {POST as login} from './app/api/player/renew/login/route.ts';
        import {POST as checkout} from './app/api/player/renew/checkout/route.ts';
        import {POST as logout} from './app/api/player/renew/logout/route.ts';
        import {POST as capture} from './app/api/checkout/capture/route.ts';
        import {POST as webhook} from './app/api/paypal/webhook/route.ts';
        export default {async fetch(request) {
          const path = new URL(request.url).pathname;
          return path === '/api/player/renew' ? GET(request) :
            path === '/api/player/renew/login' ? login(request) :
            path === '/api/player/renew/checkout' ? checkout(request) :
            path === '/api/player/renew/logout' ? logout(request) :
            path === '/api/checkout/capture' ? capture(request) : webhook(request);
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'renewal-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name: 'mock-framework-context', setup(builder) {
      builder.onResolve({filter: /^next\/(headers|navigation)$/}, args => ({path: args.path, namespace: 'mock-framework'}));
      builder.onLoad({filter: /.*/, namespace: 'mock-framework'}, args => ({contents: args.path.endsWith('/headers') ? 'export async function headers(){return new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}', loader: 'js'}));
    }}]
  });
  runtime = new Miniflare({
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], cf: false,
    workers: [{
      name: 'renewal-runtime', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text, scriptPath: fileURLToPath(new URL('../renewal-runtime-worker.js', import.meta.url)),
      d1Databases: {DB: 'renewal-runtime'},
      bindings: {PLAYER_COOKIE_KEY: key, PAYPAL_MODE: 'live', CHECKOUT_ENABLED: 'true', PAYPAL_CLIENT_ID: 'runtime-client', PAYPAL_CLIENT_SECRET: 'runtime-payment-secret', PAYPAL_WEBHOOK_ID: 'runtime-webhook', MYBUNNY_API_KEY: 'runtime-provider-secret', CUSTOMER_PORTAL_URL: 'https://portal.lumanest.tv', CUSTOMER_PORTAL_PRIMARY_URL: 'https://tv.lumanest.tv'},
      outboundService: 'mock-renewal-upstream'
    }, {
      name: 'mock-renewal-upstream', modules: true,
      script: `
        const original = {id:42,username:'${username}',password:'${password}',devices:2,status:'expired',on_site:true,expires_at:'2026-10-01T00:00:00Z',days_left:-13,customer:{id:9,email:'provider-private-customer@example.test'},prices:{renew:[{months:3,price:43},{months:6,price:85},{months:12,price:140}]},app:{playlist_url:'https://tv.lumanest.tv/m3u?u=private&p=private'}};
        let line = {...original}, balance = 213.5, duplicate = false, providerFailure = false, renewOutcome = 'confirmed', created = 0, renewals = [], orders = new Map();
        function payment(order) {return {id:order.id,status:order.status,purchase_units:[{custom_id:order.body.purchase_units[0].custom_id,amount:order.body.purchase_units[0].amount,payments:{captures:[{id:'CAPTURE'+order.id,status:order.pending?'PENDING':'COMPLETED',amount:order.body.purchase_units[0].amount}]}}]};}
        export default {async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/control') {
            const input = await request.json();
            if(input.reset){line={...original};balance=213.5;duplicate=false;providerFailure=false;renewOutcome='confirmed';created=0;renewals=[];orders=new Map();}
            if(input.line)line={...line,...input.line};
            if(Object.hasOwn(input,'balance'))balance=input.balance;
            if(Object.hasOwn(input,'duplicate'))duplicate=input.duplicate;
            if(Object.hasOwn(input,'providerFailure'))providerFailure=input.providerFailure;
            if(input.renewOutcome)renewOutcome=input.renewOutcome;
            if(input.order)Object.assign(orders.get(input.order.id),input.order);
            return Response.json({ok:true});
          }
          if (url.pathname === '/stats') return Response.json({created,renewals});
          if (url.hostname === 'connect.turbobunny.net') {
            if(providerFailure) return Response.json({error:{code:'private_failure',message:'provider-private-customer@example.test '+line.password}},{status:503});
            if(url.pathname === '/api/v1/account')return Response.json({data:{balance,site:{status:'approved',address:'https://tv.lumanest.tv',email_ready:true}}});
            if(url.pathname === '/api/v1/prices')return Response.json({data:{new_line:[]}});
            if(url.pathname === '/api/v1/lines'){
              if(url.searchParams.get('on_site') !== 'true' || url.searchParams.get('limit') !== '2' || url.searchParams.get('offset') !== '0')return new Response('Unbounded line lookup',{status:400});
              const matches=url.searchParams.get('username')===line.username&&line.on_site?[{id:line.id,username:line.username,on_site:line.on_site}]:[];
              return Response.json({data:duplicate?[...matches,...matches]:matches,total:matches.length,limit:2,offset:0});
            }
            if(url.pathname === '/api/v1/lines/42' && request.method === 'GET')return Response.json({data:line});
            if(url.pathname === '/api/v1/lines/42/renew' && request.method === 'POST'){
              renewals.push({path:url.pathname,body:await request.json(),key:request.headers.get('Idempotency-Key')});
              return renewOutcome==='confirmed'?Response.json({data:{line:{id:42}}}):Response.json({data:{}});
            }
            return Response.json({error:{code:'not_found',message:'Private line not found'}},{status:404});
          }
          if(url.pathname === '/v1/oauth2/token')return Response.json({access_token:'runtime-payment-token'});
          if(url.pathname === '/v1/notifications/verify-webhook-signature')return Response.json({verification_status:'SUCCESS'});
          if(url.pathname === '/v2/checkout/orders' && request.method==='POST'){
            created++; const id='TESTORDER'+String(created).padStart(6,'0');
            orders.set(id,{id,body:await request.json(),status:'APPROVED'});
            return Response.json({id,links:[{rel:'payer-action',href:'https://www.paypal.com/checkoutnow?token='+id}]});
          }
          const match=url.pathname.match(/^\\/v2\\/checkout\\/orders\\/(TESTORDER[0-9]+)(\\/capture)?$/);
          if(match){const order=orders.get(match[1]);if(!order)return new Response('Unknown order',{status:404});if(match[2])order.status='COMPLETED';return Response.json(payment(order));}
          return new Response('Unmocked upstream',{status:500});
        }};
      `
    }]
  });
  database = await runtime.getD1Database('DB');
  for (const path of ['0000_mature_donald_blake.sql', '0001_tired_kid_colt.sql', '0003_short_thunderbird.sql', '0004_fat_invisible_woman.sql', '0005_modern_black_panther.sql', '0006_white_deathbird.sql']) {
    const migration = await readFile(new URL('../drizzle/' + path, import.meta.url), 'utf8');
    await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
  upstream = await runtime.getWorker('mock-renewal-upstream');
});
test.after(async () => {await runtime?.dispose();});
test.beforeEach(async () => {
  await database.batch([database.prepare('DELETE FROM orders'), database.prepare('DELETE FROM player_login_attempts')]);
  await control({reset: true});
});
async function control(input) {await upstream.fetch('https://mock/control', {method: 'POST', body: JSON.stringify(input)});}
async function stats() {return (await upstream.fetch('https://mock/stats')).json();}
async function request(path, body, cookie, headers = {}) {
  const response = await runtime.dispatchFetch(origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {...(body === undefined ? {} : {'Content-Type': 'application/json', Origin: origin}), 'cf-connecting-ip': '192.0.2.42', ...(cookie ? {Cookie: cookie} : {}), ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {response, data: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0]};
}
async function login(input = {username, password}) {return request(prefix + '/login', input);}
async function begin() {
  const signed = await login();
  assert.equal(signed.response.status, 200, JSON.stringify(signed.data));
  const result = await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, signed.cookie);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result;
}
function webhookHeaders() {return {'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/test.pem', 'paypal-transmission-id': 'runtime-id', 'paypal-transmission-sig': 'runtime-signature', 'paypal-transmission-time': '2026-10-14T12:00:00Z'};}
function completedEvent(id) {return {id: 'runtime-event', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {supplementary_data: {related_ids: {order_id: id}}}};}

test('expired on-site lines sign in and receive only their own retail renewal offers', async () => {
  const {response, data, cookie} = await login();
  assert.equal(response.status, 200, JSON.stringify(data));
  const {quote_token, ...publicQuote} = data;
  assert.deepEqual(publicQuote, {line: {username, devices: 2, status: 'expired', expires_at: '2026-10-01T00:00:00.000Z', days_left: -13}, offers: [{months: 3, amount: 59, currency: 'USD', available: true}, {months: 6, amount: 99, currency: 'USD', available: true}, {months: 12, amount: 159, currency: 'USD', available: true}], checkout_available: true, message: null});
  assert.equal(typeof quote_token, 'string');
  const quoteSnapshot = await open(quote_token, key);
  assert.equal(quoteSnapshot.purpose, 'lumanest-renewal-quote-v1');
  assert.equal(quoteSnapshot.lineId, 42);
  assert.deepEqual(quoteSnapshot.amounts, [59, 99, 159]);
  assert.ok(quoteSnapshot.exp > Date.now() && quoteSnapshot.exp <= Date.now() + 15 * 60 * 1000);
  assert.equal(JSON.stringify(quoteSnapshot).includes(password), false);
  const text = JSON.stringify(data);
  for (const value of [password, '213.5', 'provider-private-customer', 'playlist_url', 'lineId', '"cost"']) assert.ok(!text.includes(value), value);
  assert.match(response.headers.get('Set-Cookie'), /Path=\/api\/player\/renew; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const decoded = await open(cookie.slice(cookie.indexOf('=') + 1), key);
  assert.equal(decoded.purpose, 'lumanest-renewal-v1');
  assert.equal(decoded.lineId, 42);
  assert.equal(decoded.password, undefined);
  assert.equal(JSON.stringify(decoded).includes(password), false);
  const current = await request(prefix, undefined, cookie);
  assert.equal(current.response.status, 200);
  const {quote_token: refreshedToken, ...refreshedQuote} = current.data;
  assert.equal(typeof refreshedToken, 'string');
  assert.deepEqual(refreshedQuote, publicQuote);
});

test('wrong, unknown, disabled, off-site, and duplicate line logins cannot create payments', async () => {
  for (const input of [{username, password: 'wrong-password'}, {username: 'unknown-line', password}, {username: username.toUpperCase(), password}]) {
    assert.equal((await login(input)).response.status, 401);
  }
  await control({line: {status: 'disabled'}});
  assert.equal((await login()).response.status, 401);
  await control({line: {status: 'active', on_site: false}});
  assert.equal((await login()).response.status, 401);
  await control({line: {on_site: true}, duplicate: true});
  assert.equal((await login()).response.status, 401);
  assert.equal((await stats()).created, 0);
});

test('tampered, expired, wrong-purpose, and reset-password sessions are rejected', async () => {
  const signed = await login();
  const token = signed.cookie.slice(signed.cookie.indexOf('=') + 1);
  const decoded = await open(token, key);
  for (const value of [token + 'x', await seal({...decoded, exp: Date.now() - 1}, key), await seal({...decoded, purpose: 'lumanest-player-v1'}, key), await seal({...decoded, lineId: 99}, key)]) {
    const cookie = '__Secure-lumanest_renewal=' + value;
    assert.equal((await request(prefix, undefined, cookie)).response.status, 401);
    assert.equal((await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, cookie)).response.status, 401);
  }
  await control({line: {password: 'new-private-line-password'}});
  assert.equal((await request(prefix, undefined, signed.cookie)).response.status, 401);
  assert.equal((await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, signed.cookie)).response.status, 401);
  assert.equal((await stats()).created, 0);
});

test('same-origin writes and bounded strict JSON prevent forged renewal requests', async () => {
  const signed = await login();
  for (const path of ['/login', '/checkout', '/logout']) {
    assert.equal((await request(prefix + path, {}, signed.cookie, {Origin: 'https://other.example'})).response.status, 403);
  }
  for (const extra of [{lineId: 99}, {devices: 1}, {amount: '1.00'}, {months: 1}]) {
    assert.equal((await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token, ...extra}, signed.cookie)).response.status, 400);
  }
  const huge = await request(prefix + '/login', {username, password, extra: 'x'.repeat(3000)});
  assert.equal(huge.response.status, 413);
  const wrongType = await request(prefix + '/login', {username, password}, undefined, {'Content-Type': 'text/plain'});
  assert.equal(wrongType.response.status, 415);
  assert.equal((await stats()).created, 0);
});

test('unavailable funds and missing line quotes block payment creation without leaking wholesale information', async () => {
  const signed = await login();
  await control({balance: 1});
  const quote = await request(prefix, undefined, signed.cookie);
  assert.equal(quote.data.checkout_available, false);
  assert.ok(quote.data.offers.every(offer => offer.available === false));
  assert.equal((await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, signed.cookie)).response.status, 503);
  await control({balance: 213.5, line: {prices: {renew: [{months: 6, price: 85}]}}});
  const partial = await request(prefix, undefined, signed.cookie);
  assert.deepEqual(partial.data.offers.map(offer => offer.available), [false, true, false]);
  assert.equal((await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, signed.cookie)).response.status, 503);
  assert.equal((await stats()).created, 0);
});

test('provider errors return a safe unavailable message and never expose provider fields', async () => {
  await control({providerFailure: true});
  const failed = await login();
  assert.equal(failed.response.status, 503);
  assert.equal(failed.data.error.code, 'renewal_unavailable');
  assert.equal(JSON.stringify(failed.data).includes(password), false);
  assert.equal(JSON.stringify(failed.data).includes('provider-private-customer'), false);
});

test('successful logins do not use the per-username failure budget', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await request(prefix + '/login', {username, password}, undefined, {'cf-connecting-ip': '198.51.100.' + (i + 1)})).response.status, 200);
  for (let i = 0; i < 12; i++) assert.equal((await request(prefix + '/login', {username, password: 'incorrect'}, undefined, {'cf-connecting-ip': '203.0.113.' + (i + 1)})).response.status, 401);
  assert.equal((await request(prefix + '/login', {username, password}, undefined, {'cf-connecting-ip': '203.0.113.200'})).response.status, 429);
});

test('login throttling uses purpose hashes and stops repeated guesses', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await login({username, password: 'incorrect'})).response.status, 401);
  const limited = await login({username, password});
  assert.equal(limited.response.status, 429);
  assert.equal(limited.response.headers.get('Retry-After'), '900');
  const rows = (await database.prepare('SELECT id FROM player_login_attempts').all()).results;
  for (const row of rows) assert.match(row.id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(rows).includes(username), false);
});

test('checkout derives the authenticated line, real screen count and retail price', async () => {
  const result = await begin();
  assert.match(result.data.approval_url, /^https:\/\/www\.paypal\.com\/checkoutnow\?token=TESTORDER/);
  const row = await database.prepare('SELECT kind,line_id,devices,months,amount,email,name,state FROM orders WHERE id=?').bind(result.data.order_id).first();
  assert.deepEqual(row, {kind: 'renew', line_id: 42, devices: 2, months: 3, amount: '59.00', email: receipt, name: '', state: 'created'});
  assert.deepEqual((await stats()).renewals, []);
});

test('missing, tampered, expired, wrong-purpose, wrong-line, and changed-price quote snapshots create no payment', async () => {
  const signed = await login(), quote = await open(signed.data.quote_token, key);
  const changed = [undefined, signed.data.quote_token + 'x', await seal({...quote, exp: Date.now() - 1}, key),
    await seal({...quote, purpose: 'lumanest-renewal-v1'}, key), await seal({...quote, lineId: 99}, key),
    await seal({...quote, credential: 'invalid-credential-binding'}, key), await seal({...quote, amounts: [1, 99, 159]}, key)];
  for (const quoteToken of changed) {
    const result = await request(prefix + '/checkout', {months: 3, email: receipt, ...(quoteToken === undefined ? {} : {quoteToken})}, signed.cookie);
    assert.equal(result.response.status, 409, JSON.stringify(result.data));
    assert.equal(result.data.error.code, 'renewal_quote_changed');
  }
  assert.equal((await stats()).created, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM orders').first()).count, 0);
});

test('a stale tab cannot pay its old displayed quote after the line changes before authentication refresh', async () => {
  const signed = await login();
  assert.equal(signed.data.line.devices, 2);
  assert.equal(signed.data.offers[0].amount, 59);
  await control({line: {devices: 3}});
  const stale = await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: signed.data.quote_token}, signed.cookie);
  assert.equal(stale.response.status, 409, JSON.stringify(stale.data));
  assert.equal(stale.data.error.code, 'renewal_quote_changed');
  assert.equal((await stats()).created, 0);
  const refreshed = await request(prefix, undefined, signed.cookie);
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.data.line.devices, 3);
  assert.equal(refreshed.data.offers[0].amount, 79);
  const reviewed = await request(prefix + '/checkout', {months: 3, email: receipt, quoteToken: refreshed.data.quote_token}, signed.cookie);
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.data));
  const row = await database.prepare('SELECT devices,amount FROM orders WHERE id=?').bind(reviewed.data.order_id).first();
  assert.deepEqual(row, {devices: 3, amount: '79.00'});
});

test('verified payment return and duplicate webhooks extend the same line once', async () => {
  const result = await begin(), token = new URL(result.data.approval_url).searchParams.get('token');
  const captured = await request('/api/checkout/capture', {order: result.data.order_id, token});
  assert.equal(captured.response.status, 200, JSON.stringify(captured.data));
  assert.equal(captured.data.state, 'fulfilled');
  assert.equal(captured.data.message, 'Your subscription has been renewed. Your existing line login stays the same. Check your customer hub.');
  await Promise.all([request('/api/paypal/webhook', completedEvent(token), undefined, webhookHeaders()), request('/api/checkout/capture', {order: result.data.order_id, token}), request('/api/paypal/webhook', completedEvent(token), undefined, webhookHeaders())]);
  assert.deepEqual((await stats()).renewals, [{path: '/api/v1/lines/42/renew', body: {months: 3}, key: 'paypal-' + token}]);
});

test('changed screen counts, disabled status, off-site state, and missing renewal quotes stop paid fulfillment', async () => {
  for (const change of [{devices: 3}, {status: 'disabled'}, {on_site: false}, {prices: {renew: []}}]) {
    await database.batch([database.prepare('DELETE FROM orders'), database.prepare('DELETE FROM player_login_attempts')]);
    await control({reset: true});
    const result = await begin(), token = new URL(result.data.approval_url).searchParams.get('token');
    await control({line: change});
    const captured = await request('/api/checkout/capture', {order: result.data.order_id, token});
    assert.equal(captured.response.status, 200);
    assert.equal(captured.data.state, 'needs_review');
    await request('/api/paypal/webhook', completedEvent(token), undefined, webhookHeaders());
    const row = await database.prepare('SELECT state,attempted FROM orders WHERE id=?').bind(result.data.order_id).first();
    assert.equal(row.state, 'needs_review');
    assert.ok(row.attempted > 0);
    assert.deepEqual((await stats()).renewals, []);
  }
});

test('verified sessions are throttled by their line even when request IP changes', async () => {
  const signed = await login();
  // Existing buckets include the login subjects and shared reads, but no quote IP or session-line bucket yet.
  await request(prefix, undefined, signed.cookie);
  await database.prepare('UPDATE player_login_attempts SET count=30').run();
  const result = await request(prefix, undefined, signed.cookie, {'cf-connecting-ip': '192.0.2.99'});
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get('Retry-After'), '900');
});

test('pending and unsigned payment notifications never extend a line', async () => {
  const result = await begin(), token = new URL(result.data.approval_url).searchParams.get('token');
  await control({order: {id: token, status: 'COMPLETED', pending: true}});
  const capture = await request('/api/checkout/capture', {order: result.data.order_id, token});
  assert.equal(capture.data.state, 'pending');
  const unsigned = await request('/api/paypal/webhook', completedEvent(token));
  assert.equal(unsigned.response.status, 403);
  assert.deepEqual((await stats()).renewals, []);
});

test('unknown provider renewal outcome stays under review without a second wallet attempt', async () => {
  const result = await begin(), token = new URL(result.data.approval_url).searchParams.get('token');
  await control({renewOutcome: 'unknown'});
  const captured = await request('/api/checkout/capture', {order: result.data.order_id, token});
  assert.equal(captured.data.state, 'needs_review');
  await request('/api/paypal/webhook', completedEvent(token), undefined, webhookHeaders());
  await request('/api/checkout/capture', {order: result.data.order_id, token});
  assert.equal((await stats()).renewals.length, 1);
  assert.equal((await database.prepare('SELECT state FROM orders WHERE id=?').bind(result.data.order_id).first()).state, 'needs_review');
});

test('logout clears only the scoped renewal session and rejects cross-site requests', async () => {
  const result = await request(prefix + '/logout', {});
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, {signed_out: true});
  assert.match(result.response.headers.get('Set-Cookie'), /^__Secure-lumanest_renewal=; Path=\/api\/player\/renew; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
});
