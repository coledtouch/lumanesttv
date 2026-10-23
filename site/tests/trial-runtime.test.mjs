// Free 24-hour trial requests (docs/trials.md) in workerd: the public request and status routes, the owner's queue,
// approval against a mocked provider, clean-up, and the owner's email alert for each new request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

let runtime, database;
const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const origin = 'https://lumanest.tv';
const ownerToken = 'f'.repeat(64), ownerCookie = '__Host-lumanest_owner=' + ownerToken;
const provider = {calls: [], account: null, lines: {}, customer: 'ok'};
// What the TRIAL_ALERT_EMAIL binding was given (the Mailbox worker below), and what workerd logged.
// While hold is a pending promise, the binding's send doesn't finish, as if Email Routing were slow.
const mailbox = {sent: [], fail: false, hold: null};
const logs = [];
const alertWorkers = ['trial-alerts', 'trial-alerts-no-to', 'trial-alerts-bad-to', 'trial-alerts-no-binding', 'trial-alerts-bad-from'];

function resetProvider() {
  provider.calls = [];
  provider.account = {balance: 10, currency: 'USD', site: {status: 'approved', address: 'https://tv.lumanest.tv', email_ready: true}};
  provider.lines = {};
  provider.customer = 'ok';
}
function trialLine(id, extra = {}) {
  return {id, username: 'trial-line-' + id, password: 'provider-private-password', devices: 1, status: 'active', on_site: false, expires_at: new Date(Date.now() + 23 * HOUR).toISOString(), ...extra};
}
// The provider (connect.turbobunny.net): records every request with its body and Idempotency-Key.
async function upstream(request) {
  const url = new URL(request.url), text = request.method === 'GET' ? '' : await request.text();
  provider.calls.push({method: request.method, path: url.pathname, key: request.headers.get('Idempotency-Key'), body: text ? JSON.parse(text) : undefined});
  if (url.hostname !== 'connect.turbobunny.net') return new Response('unexpected', {status: 599});
  if (url.pathname === '/api/v1/account') return Response.json({data: provider.account});
  const line = url.pathname.match(/^\/api\/v1\/lines\/(\d+)$/), found = line && provider.lines[line[1]];
  if (line && !found) return Response.json({error: {code: 'not_found', message: 'Line not found'}}, {status: 404});
  if (line && request.method === 'GET') return Response.json({data: found});
  if (line && request.method === 'PATCH') return Response.json({data: {...found, ...JSON.parse(text)}});
  if (url.pathname === '/api/v1/customers' && request.method === 'POST') {
    if (provider.customer === 'fail') return Response.json({error: {code: 'server_error', message: 'provider-private failure text'}}, {status: 503});
    if (provider.customer === 'empty') return Response.json({data: {}});
    return Response.json({data: {customer: {id: 501, email: JSON.parse(text).email}}});
  }
  return Response.json({error: {code: 'not_found', message: 'Unmocked'}}, {status: 404});
}

// The mail binding's recorder: the Mailbox worker posts each message here once Miniflare's send_email simulator accepted it.
async function mailboxOutbound(request) {
  if (new URL(request.url).hostname !== 'mailbox.test') return new Response('unexpected', {status: 599});
  if (mailbox.hold) await mailbox.hold;
  if (mailbox.fail) return new Response('refused', {status: 503});
  mailbox.sent.push(await request.json());
  return new Response('ok');
}
// Stands in for the send_email binding through RPC. Miniflare's EmailMessage (cloudflare:email) is a plain object holding
// the raw text under 'EmailMessage::raw'. Each message is first passed to Miniflare's own send_email simulator, which
// refuses what Cloudflare would: an unparsable message, no Message-ID, or a From header that isn't the envelope sender.
const mailboxScript = `
  import {WorkerEntrypoint} from 'cloudflare:workers';
  import {EmailMessage} from 'cloudflare:email';
  export class Mailbox extends WorkerEntrypoint {
    async send(message) {
      const raw = message['EmailMessage::raw'];
      const text = typeof raw === 'string' ? raw : await new Response(raw).text();
      await this.env.CHECK.send(new EmailMessage(message.from, message.to, text));
      const recorded = await fetch('http://mailbox.test/sent', {method: 'POST', body: JSON.stringify({from: message.from, to: message.to, raw: text})});
      if (!recorded.ok) throw new Error('mailbox refused the message');
      return {messageId: 'recorded'};
    }
  }
  export default {fetch() {return new Response('not found', {status: 404});}};
`;

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {POST as requestPOST} from './app/api/trial/route.ts';
        import {POST as statusPOST} from './app/api/trial/status/route.ts';
        import {GET as queueGET, POST as queuePOST} from './app/api/manage/trials/route.ts';
        import {cleanup} from './lib/maintenance.ts';
        export default {async fetch(request) {
          globalThis.__testHeaders = request.headers;
          const headers = new Headers(request.headers);
          // Miniflare rejects Origin on direct worker fetches; the test names it in this header instead.
          if (headers.get('test-origin')) headers.set('Origin', headers.get('test-origin'));
          const req = new Request(request, {headers});
          const {pathname, searchParams} = new URL(request.url);
          // Maintenance cleanup as if it ran at ?now= (it runs about every 15 minutes in production).
          if (pathname === '/test/cleanup') return Response.json(await cleanup(Number(searchParams.get('now'))));
          if (pathname === '/api/trial') return requestPOST(req);
          if (pathname === '/api/trial/status') return statusPOST(req);
          if (pathname === '/api/manage/trials') return request.method === 'POST' ? queuePOST(req) : queueGET();
          return new Response('not found', {status: 404});
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'trial-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'cloudflare:email', 'node:crypto'],
    plugins: [{name: 'mock-framework-request-context', setup(builder) {
      builder.onResolve({filter: /^next\/(headers|navigation)$/}, args => ({path: args.path, namespace: 'mock-framework'}));
      builder.onLoad({filter: /.*/, namespace: 'mock-framework'}, args => ({contents: args.path.endsWith('/headers') ? 'export async function headers(){return globalThis.__testHeaders || new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}', loader: 'js'}));
    }}]
  });
  const settings = {MYBUNNY_API_KEY: 'runtime-provider-secret', CUSTOMER_PORTAL_URL: 'https://portal.lumanest.tv', CUSTOMER_PORTAL_PRIMARY_URL: 'https://tv.lumanest.tv', PLAYER_COOKIE_KEY: 'b'.repeat(64)};
  const worker = (name, bindings, extra = {}) => ({name, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.outputFiles[0].text, scriptPath: fileURLToPath(new URL('../trial-runtime-worker.js', import.meta.url)), d1Databases: {DB: name + '-db'}, bindings, outboundService: upstream, ...extra});
  const mail = {serviceBindings: {TRIAL_ALERT_EMAIL: {name: 'mailbox', entrypoint: 'Mailbox'}}};
  runtime = new Miniflare({compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], cf: false,
    // Kept for the alert tests, and passed on, except the send_email simulator's own note of each message.
    handleStructuredLogs({level, message}) {
      logs.push({level, message});
      if (!message.includes('send_email binding called')) (level === 'error' || level === 'warn' ? console.error : console.log)(message);
    },
    workers: [
      worker('trial', {...settings, TRIALS_ENABLED: 'true'}),
      worker('trial-off', settings),
      worker('trial-no-key', {...settings, TRIALS_ENABLED: 'true', PLAYER_COOKIE_KEY: 'not-a-key'}),
      // Deployed before migration 0011 was applied.
      worker('trial-unmigrated', {...settings, TRIALS_ENABLED: 'true'}),
      // Email alerts (lib/trial-alert-send.ts): configured; the binding without TRIAL_ALERT_TO or with an invalid one;
      // TRIAL_ALERT_TO without the binding (a deploy prepared without --trial-alerts); an invalid TRIAL_ALERT_FROM.
      worker('trial-alerts', {...settings, TRIALS_ENABLED: 'true', TRIAL_ALERT_TO: 'owner@example.test'}, mail),
      worker('trial-alerts-no-to', {...settings, TRIALS_ENABLED: 'true', TRIAL_ALERT_FROM: 'alerts@lumanest.tv'}, mail),
      worker('trial-alerts-bad-to', {...settings, TRIALS_ENABLED: 'true', TRIAL_ALERT_TO: 'Owner <owner@example.test>'}, mail),
      worker('trial-alerts-no-binding', {...settings, TRIALS_ENABLED: 'true', TRIAL_ALERT_TO: 'owner@example.test'}),
      worker('trial-alerts-bad-from', {...settings, TRIALS_ENABLED: 'true', TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: 'Alerts <alerts@lumanest.tv>'}, mail),
      {name: 'mailbox', compatibilityDate: '2026-05-15', modules: true, script: mailboxScript, email: {send_email: [{name: 'CHECK'}]}, outboundService: mailboxOutbound}
    ]});
  const migrations = [];
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) migrations.push([file, await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8')]);
  const version = 'b'.repeat(32), now = Date.now();
  for (const name of ['trial', 'trial-off', 'trial-no-key', 'trial-unmigrated', ...alertWorkers]) {
    const db = await runtime.getD1Database('DB', name);
    for (const [file, migration] of migrations) if (name !== 'trial-unmigrated' || !file.startsWith('0011_')) await db.batch(migration.split('--> statement-breakpoint').map(sql => db.prepare(sql.trim())));
    // A signed-in password owner (the fixture of tests/subscriptions.test.ts).
    await db.prepare('INSERT INTO owner_credentials (id,email,password_hash,recovery_hash,version,created,updated) VALUES (?,?,?,?,?,?,?)').bind('owner', 'support@lumanest.tv', 'scrypt$32768$8$3$' + 'c'.repeat(32) + '$' + 'd'.repeat(128), 'e'.repeat(64), version, now, now).run();
    // It outlives every clean-up a test runs (the last one is about 181 days ahead).
    await db.prepare('INSERT INTO owner_sessions VALUES (?,?,?,?)').bind(createHash('sha256').update(ownerToken).digest('hex'), 'owner', version, now + 365 * DAY).run();
  }
  database = await runtime.getD1Database('DB', 'trial');
});
test.after(async () => {await runtime?.dispose();});
test.beforeEach(async () => {
  await database.batch([database.prepare('DELETE FROM trial_requests'), database.prepare('DELETE FROM player_login_attempts')]);
  resetProvider();
});

async function call(path, {method = 'POST', body, headers = {}, worker = 'trial', ip = '203.0.113.10', from = origin, cookie} = {}) {
  const init = {method, headers: {'cf-connecting-ip': ip, ...(method === 'POST' ? {'Content-Type': 'application/json', ...(from ? {'test-origin': from} : {})} : {}), ...(cookie ? {Cookie: cookie} : {}), ...headers}};
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await (await runtime.getWorker(worker)).fetch(new URL(path, origin), init);
  const text = await response.text();
  return {status: response.status, headers: response.headers, text, data: text ? JSON.parse(text) : null};
}
const person = (n, extra = {}) => ({name: 'Trial Person ' + n, email: `person${n}@example.test`, device: 'samsung', consent: true, website: '', ...extra});
const ask = (n, ip = '198.51.100.' + n, extra = {}) => call('/api/trial', {body: person(n, extra), ip});
const tokenOf = result => result.data.status_url.slice('/trial/status#'.length);
const status = (token, ip = '192.0.2.200') => call('/api/trial/status', {body: {token}, ip});
const owner = (body, extra = {}) => call('/api/manage/trials', {body, cookie: ownerCookie, ...extra});
const queue = async () => {
  const result = await call('/api/manage/trials', {method: 'GET', cookie: ownerCookie});
  assert.equal(result.status, 200, result.text);
  return result.data;
};
async function trialId(email) {return (await database.prepare('SELECT id FROM trial_requests WHERE email=?').bind(email).first()).id;}
async function row(id) {return database.prepare('SELECT * FROM trial_requests WHERE id=?').bind(id).first();}
const calls = () => provider.calls.map(call => call.method + ' ' + call.path);
async function pending(n) {
  const result = await ask(n);
  assert.equal(result.status, 200, result.text);
  return {id: await trialId(`person${n}@example.test`), token: tokenOf(result)};
}

test('trials are refused while switched off or without the player key, and nothing reaches the provider', async () => {
  for (const worker of ['trial-off', 'trial-no-key']) {
    const result = await call('/api/trial', {body: person(1), worker});
    assert.equal(result.status, 503);
    assert.equal(result.data.error.code, 'trials_unavailable');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await status('A'.repeat(43), '192.0.2.1')).status, 404, 'status still answers on the enabled worker');
  assert.equal((await call('/api/trial/status', {body: {token: 'A'.repeat(43)}, worker: 'trial-no-key'})).data.error.code, 'trials_unavailable');
  assert.deepEqual(provider.calls, []);
});

test('the request form is validated strictly and only same-site JSON is read', async () => {
  const refused = async (body, expected, options = {}) => {
    const result = await call('/api/trial', {body, ...options});
    assert.equal(result.status, expected, JSON.stringify(body) + ' ' + result.text);
    return result.data.error;
  };
  assert.equal((await refused(person(1), 403, {from: 'https://other.example'})).code, 'origin_rejected');
  assert.equal((await refused(person(1), 403, {from: ''})).code, 'origin_rejected');
  assert.equal((await refused(JSON.stringify(person(1)), 415, {headers: {'Content-Type': 'text/plain'}})).code, 'json_required');
  assert.equal((await refused(person(1, {name: 'x'.repeat(3000)}), 413)).code, 'request_too_large');
  assert.equal((await refused('{"name":', 400)).code, 'invalid_request');
  const invalid = [[], person(1, {consent: false}), {...person(1), consent: undefined}, person(1, {email: 'not-an-email'}), person(1, {email: 'a'.repeat(250) + '@example.test'}),
    person(1, {device: 'toaster'}), person(1, {name: '   '}), person(1, {name: 'Bell\u0007'}), person(1, {name: 'Line\nbreak'}), person(1, {name: 'x'.repeat(101)}), person(1, {extra: 'field'}), person(1, {website: 7})];
  for (const body of invalid) {
    const error = await refused(body, 400);
    assert.deepEqual(error, {code: 'invalid_request', message: 'Check your name, email and device, then try again.'});
  }
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM trial_requests').first()).count, 0);
  assert.deepEqual(provider.calls, []);
});

test('a filled honeypot is told it worked, and nothing is stored or counted', async () => {
  const result = await call('/api/trial', {body: person(1, {website: 'https://spam.example'})});
  assert.equal(result.status, 200);
  assert.equal(result.data.state, 'pending');
  assert.match(result.data.status_url, /^\/trial\/status#[A-Za-z0-9_-]{43}$/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM trial_requests').first()).count, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM player_login_attempts').first()).count, 0);
  const lookup = await status(tokenOf(result));
  assert.equal(lookup.status, 404);
  assert.equal(lookup.data.error.code, 'trial_not_found');
});

test('a request returns a private status link; D1 keeps only hashes of the link and the network', async () => {
  const ip = '203.0.113.77';
  const result = await call('/api/trial', {body: person(1, {name: '  Pat Example  ', email: ' Pat@Example.TEST '}), ip});
  assert.equal(result.status, 200, result.text);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(Object.keys(result.data).sort(), ['state', 'status_url']);
  assert.equal(result.data.state, 'pending');
  assert.match(result.data.status_url, /^\/trial\/status#[A-Za-z0-9_-]{43}$/);
  const token = tokenOf(result);

  const checked = await status(token);
  assert.equal(checked.status, 200);
  assert.equal(checked.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(Object.keys(checked.data).sort(), ['requested_at', 'state']);
  assert.equal(checked.data.state, 'pending');
  assert.ok(Math.abs(Date.parse(checked.data.requested_at) - Date.now()) < 60000);
  assert.ok(!/pat|example|samsung/i.test(checked.text), 'no email, name or device in the status');

  const saved = await database.prepare('SELECT * FROM trial_requests').all();
  assert.equal(saved.results.length, 1);
  const stored = saved.results[0];
  assert.equal(stored.email, 'Pat@Example.TEST');
  assert.equal(stored.name, 'Pat Example');
  assert.equal(stored.device, 'samsung');
  assert.equal(stored.state, 'pending');
  assert.match(stored.id, /^[0-9a-f-]{36}$/);
  for (const hash of [stored.status_hash, stored.network, stored.email_key]) assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(stored.status_hash, token);
  const everything = JSON.stringify([saved.results, (await database.prepare('SELECT * FROM player_login_attempts').all()).results]);
  for (const secret of [token, ip, '203.0.113']) assert.ok(!everything.includes(secret), 'D1 holds no ' + secret);

  for (const token of ['', 'short', 'A'.repeat(44), 'A'.repeat(42) + '!']) assert.equal((await status(token)).status, 404);
  assert.equal((await call('/api/trial/status', {body: {token, extra: 1}})).status, 404);
  assert.equal((await call('/api/trial/status', {body: {token}, from: 'https://other.example'})).status, 403);
  assert.deepEqual(provider.calls, []);
});

test('one trial per email address, in any letter case', async () => {
  assert.equal((await ask(1, '198.51.100.1')).status, 200);
  const again = await call('/api/trial', {body: person(1, {email: ' PERSON1@example.test'}), ip: '198.51.100.2'});
  assert.equal(again.status, 409);
  assert.deepEqual(again.data.error, {code: 'trial_already_requested', message: 'A free trial has already been requested with this email address.'});
});

test('two requests per home network in 30 days, an IPv6 /48 counting as one network, and three attempts an hour', async () => {
  assert.equal((await ask(1, '198.51.100.50')).status, 200);
  assert.equal((await ask(2, '198.51.100.50')).status, 200);
  const third = await ask(3, '198.51.100.50');
  assert.equal(third.status, 409);
  assert.equal(third.data.error.code, 'trial_network_used');
  const fourth = await ask(4, '198.51.100.50');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.data.error.code, 'trial_rate_limit');
  assert.equal(fourth.headers.get('Retry-After'), '3600');

  assert.equal((await ask(10, '2001:db8:aa:1::1')).status, 200);
  assert.equal((await ask(11, '2001:db8:aa:2::2')).status, 200);
  assert.equal((await ask(12, '2001:db8:aa:3::3')).data.error.code, 'trial_network_used');
  assert.equal((await ask(13, '2001:db8:bb:1::1')).status, 200, 'another /48 is another network');
});

test('a network that has used its trials gets the same answer whichever email address it tries', async () => {
  assert.equal((await ask(1, '198.51.100.1')).status, 200);
  assert.equal((await ask(2, '198.51.100.60')).status, 200);
  assert.equal((await ask(3, '198.51.100.60')).status, 200);
  const probe = await ask(1, '198.51.100.60');
  assert.equal(probe.status, 409);
  assert.equal(probe.data.error.code, 'trial_network_used', 'not whether person1 asked');
});

test('only stored requests count toward the shared hourly limit, so refused attempts can\'t lock everyone out', async () => {
  assert.equal((await ask(1, '198.51.100.1')).status, 200);
  for (let n = 1; n <= 10; n++) for (let attempt = 0; attempt < 3; attempt++) {
    const refused = await call('/api/trial', {body: person(1), ip: '203.0.113.' + n});
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error.code, 'trial_already_requested');
  }
  assert.equal((await ask(2, '192.0.2.2')).status, 200, 'thirty refused attempts leave room for a real request');
  for (let n = 3; n <= 30; n++) assert.equal((await ask(n, '192.0.2.' + n)).status, 200, 'request ' + n);
  const full = await ask(31, '192.0.2.31');
  assert.equal(full.status, 429);
  assert.equal(full.data.error.code, 'trial_rate_limit');
  assert.equal(full.headers.get('Retry-After'), '3600');
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM trial_requests').first()).count, 30);
});

test('new requests wait while 50 are pending', async () => {
  const now = Date.now();
  await database.batch(Array.from({length: 50}, (_, i) => database.prepare("INSERT INTO trial_requests (id,status_hash,email,email_key,name,device,network,state,created) VALUES (?,?,?,?,?,?,?,'pending',?)")
    .bind('queued-' + i, 'hash-' + i, `queued${i}@example.test`, 'email-' + i, 'Queued', 'web', 'network-' + i, now)));
  const busy = await ask(1);
  assert.equal(busy.status, 503);
  assert.equal(busy.data.error.code, 'trials_busy');
  await database.prepare("UPDATE trial_requests SET state='declined' WHERE id='queued-0'").run();
  assert.equal((await ask(2)).status, 200);
});

test('the owner queue needs the owner session, and its writes a same-site Origin first', async () => {
  const anonymous = await call('/api/manage/trials', {method: 'GET'});
  assert.equal(anonymous.status, 401);
  assert.equal((await call('/api/manage/trials', {body: {action: 'decline', id: 'x'}, from: 'https://other.example'})).status, 403);
  assert.equal((await call('/api/manage/trials', {body: {action: 'decline', id: 'x'}, cookie: ownerCookie, from: 'https://other.example'})).status, 403);
  assert.equal((await call('/api/manage/trials', {body: {action: 'decline', id: 'x'}})).status, 401);
  assert.equal((await call('/api/manage/trials', {body: {action: 'decline', id: 'x'}, cookie: '__Host-lumanest_owner=' + 'a'.repeat(64)})).status, 401);
  const unknown = await owner({action: 'approveTrial', id: 'x'});
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error.message, 'Choose a supported trial action.');
  assert.equal((await owner({action: 'decline', id: 'not a reference!'})).status, 404);
  assert.equal((await owner({action: 'decline', id: 'missing'})).data.error.code, 'trial_not_found');
  assert.equal((await owner([])).status, 400);
  const listed = await call('/api/manage/trials', {method: 'GET', cookie: ownerCookie});
  assert.equal(listed.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(listed.data, {trials: [], pending_count: 0, ready: true, enabled: true, alerts: 'off'});
  // The panel says when visitors can't ask for a trial, and why.
  for (const [worker, flags] of [['trial-off', [false, false]], ['trial-no-key', [false, true]]]) {
    const off = await call('/api/manage/trials', {method: 'GET', cookie: ownerCookie, worker});
    assert.equal(off.status, 200, off.text);
    assert.deepEqual([off.data.ready, off.data.enabled], flags, worker);
  }
  // It also says whether new requests are emailed to the owner, and when alerts are set up but can't send.
  for (const [worker, alerts] of [['trial-alerts', 'on'], ['trial-alerts-no-to', 'off'], ['trial-alerts-bad-to', 'off'], ['trial-alerts-no-binding', 'binding_missing'], ['trial-alerts-bad-from', 'sender_invalid']]) {
    const listing = await call('/api/manage/trials', {method: 'GET', cookie: ownerCookie, worker});
    assert.equal(listing.status, 200, listing.text);
    assert.equal(listing.data.alerts, alerts, worker);
  }
});

test('before migration 0011 is applied, the owner queue names it and the public form is unavailable', async () => {
  for (const request of [{method: 'GET'}, {body: {action: 'decline', id: 'x'}}, {body: {action: 'resolve', id: 'x', note: 'Checked.'}}, {body: {action: 'approve', id: 'x', line_id: 7}}]) {
    const result = await call('/api/manage/trials', {...request, cookie: ownerCookie, worker: 'trial-unmigrated'});
    assert.equal(result.status, 503, result.text);
    assert.deepEqual(result.data.error, {code: 'trials_storage_missing', message: 'Trial requests need migration 0011_trial_requests.sql. Apply it, then refresh.'});
  }
  const form = await call('/api/trial', {body: person(1), worker: 'trial-unmigrated'});
  assert.equal(form.status, 503);
  assert.equal(form.data.error.code, 'trials_unavailable');
  assert.deepEqual(provider.calls, []);
});

test('the queue lists pending requests first, oldest first, with how often their email and network asked', async () => {
  const now = Date.now(), insert = (id, state, created, network, email, extra = {}) => {
    const values = {id, status_hash: 'hash-' + id, email: id + '@example.test', email_key: email, name: 'Name ' + id, device: 'roku', network, state, created, ...extra};
    return database.prepare(`INSERT INTO trial_requests (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).bind(...Object.values(values));
  };
  await database.batch([
    insert('declined-old', 'declined', now - 5 * HOUR, 'net-a', 'email-a', {decided: now - 4 * HOUR}),
    insert('pending-new', 'pending', now - 1 * HOUR, 'net-a', 'email-b'),
    insert('pending-old', 'pending', now - 3 * HOUR, 'net-c', 'email-a'),
    insert('review', 'needs_review', now - 6 * HOUR, 'net-d', 'email-d', {attempted: now - 2 * HOUR}),
    insert('active-gone', 'active', now - 2 * HOUR, 'net-e', 'email-e', {expires: now - 1000}),
    insert('ancient', 'declined', now - 40 * DAY, 'net-a', 'email-f')
  ]);
  const {trials, pending_count} = await queue();
  assert.equal(pending_count, 2);
  assert.deepEqual(trials.map(trial => trial.id), ['pending-old', 'pending-new', 'review', 'active-gone', 'declined-old', 'ancient']);
  const byId = Object.fromEntries(trials.map(trial => [trial.id, trial]));
  assert.deepEqual(Object.keys(byId['pending-new']).sort(), ['attempted', 'created', 'customer_id', 'decided', 'device', 'email', 'error', 'expires', 'id', 'line_id', 'message', 'name', 'resolution', 'same_email', 'same_network', 'state'].sort());
  assert.equal(byId['pending-new'].same_network, 1, 'the declined request from the same network this month; not the 40-day-old one');
  assert.equal(byId['pending-new'].same_email, 0);
  assert.equal(byId['pending-old'].same_email, 1);
  assert.equal(byId['active-gone'].state, 'ended', 'a past expiry reads as ended before clean-up');
  assert.equal(byId.review.attempted, true);
  assert.equal(byId['pending-old'].attempted, false);
  assert.equal(byId['pending-old'].email, 'pending-old@example.test');
});

test('approval readies the owner\'s trial line, creates the invited customer once, and the requester sees it active', async () => {
  provider.lines[77] = trialLine(77);
  const {id, token} = await pending(1);
  const before = (await queue()).trials[0];
  assert.equal(before.state, 'pending');
  assert.equal(before.email, 'person1@example.test');

  const approved = await owner({action: 'approve', id, line_id: 77});
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(approved.data, {id, state: 'active', message: 'Trial approved. The customer has been emailed their login.'});
  assert.deepEqual(calls(), ['GET /api/v1/account', 'GET /api/v1/lines/77', 'PATCH /api/v1/lines/77', 'POST /api/v1/customers']);
  const [, , patch, customer] = provider.calls;
  assert.deepEqual(patch.body, {on_site: true, note: 'LumaNest trial ' + id.slice(0, 8)});
  assert.equal(patch.key, null);
  assert.deepEqual(customer.body, {email: 'person1@example.test', name: 'Trial Person 1', line_ids: [77], send_invitation: true});
  assert.equal(customer.key, 'trial-' + id);

  const saved = await row(id);
  assert.equal(saved.state, 'active');
  assert.equal(saved.line_id, 77);
  assert.equal(saved.customer_id, 501);
  assert.equal(saved.expires, Date.parse(provider.lines[77].expires_at));
  assert.ok(saved.attempted && saved.decided);

  const checked = await status(token);
  assert.deepEqual(checked.data, {state: 'active', requested_at: new Date(saved.created).toISOString(), expires_at: provider.lines[77].expires_at});

  for (const again of [{action: 'approve', id, line_id: 77}, {action: 'approve', id, line_id: 78}, {action: 'decline', id}]) {
    const refused = await owner(again);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error.code, 'trial_not_pending');
  }
  assert.equal(provider.calls.filter(call => call.path === '/api/v1/customers').length, 1, 'never created twice');
  assert.equal(provider.calls.length, 4);
  const listed = (await queue()).trials[0];
  assert.equal(listed.state, 'active');
  assert.equal(listed.line_id, 77);
  assert.equal(listed.customer_id, 501);
  assert.equal(listed.attempted, true);
});

test('a line that is missing, closed, not ending about 24 hours from now, already a customer\'s or another trial\'s is refused, and the request stays pending', async () => {
  provider.lines[77] = trialLine(77);
  const first = await pending(1), second = await pending(2);
  assert.equal((await owner({action: 'approve', id: first.id, line_id: 77})).status, 200);
  provider.calls = [];

  const inUse = await owner({action: 'approve', id: second.id, line_id: 77});
  assert.equal(inUse.status, 409);
  assert.equal(inUse.data.error.code, 'trial_line_in_use');
  assert.deepEqual(provider.calls, [], 'refused before any provider request');

  provider.lines[78] = trialLine(78, {customer: {id: 9, email: 'provider-private@example.test'}});
  provider.lines[80] = trialLine(80, {status: 'expired'});
  provider.lines[81] = trialLine(81, {expires_at: new Date(Date.now() + 30 * DAY).toISOString()});
  provider.lines[82] = trialLine(82, {expires_at: new Date(Date.now() - HOUR).toISOString()});
  provider.lines[83] = trialLine(83, {customer_id: 12});
  provider.lines[85] = trialLine(85, {expires_at: new Date(Date.now() + 2 * HOUR).toISOString()});
  provider.lines[86] = trialLine(86, {expires_at: null, days_left: 365});
  provider.lines[87] = trialLine(87, {expires_at: undefined});
  provider.lines[88] = trialLine(88, {expires_at: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 19)});
  provider.lines[89] = trialLine(89, {expires_at: undefined, days_left: -1});
  for (const [line, code] of [[78, 'trial_line_in_use'], [79, 'trial_line_not_found'], [80, 'trial_line_unusable'], [81, 'trial_line_not_trial'], [82, 'trial_line_unusable'], [83, 'trial_line_in_use'],
    [85, 'trial_line_not_trial'], [86, 'trial_line_not_trial'], [87, 'trial_line_not_trial'], [88, 'trial_line_not_trial'], [89, 'trial_line_unusable']]) {
    provider.calls = [];
    const refused = await owner({action: 'approve', id: second.id, line_id: line});
    assert.equal(refused.status, 409, line + ' ' + refused.text);
    assert.equal(refused.data.error.code, code);
    assert.deepEqual(calls(), ['GET /api/v1/account', 'GET /api/v1/lines/' + line], 'only reads');
    const saved = await row(second.id);
    assert.deepEqual([saved.state, saved.attempted, saved.decided, saved.line_id], ['pending', null, null, null]);
  }
  assert.equal((await status(second.token)).data.state, 'pending');

  for (const line of ['abc', 0, -1, 1.5, null, 2 ** 53]) assert.equal((await owner({action: 'approve', id: second.id, line_id: line})).status, 400);

  // Without an exact time (a day count, or a date without a time or zone), a line that fits is taken as 24 hours from approval.
  provider.lines[84] = trialLine(84, {expires_at: undefined, days_left: 1});
  provider.lines[90] = trialLine(90, {expires_at: new Date(Date.now() + DAY).toISOString().slice(0, 10)});
  const third = await pending(3);
  for (const [line, request] of [['84', second], [90, third]]) {
    assert.equal((await owner({action: 'approve', id: request.id, line_id: line})).data.state, 'active', 'line ' + line);
    const saved = await row(request.id);
    assert.equal(saved.expires - saved.attempted, 24 * HOUR);
  }
});

test('approval waits until the customer hub can send invitations', async () => {
  provider.lines[77] = trialLine(77);
  const {id} = await pending(1);
  provider.account.site.email_ready = false;
  const refused = await owner({action: 'approve', id, line_id: 77});
  assert.equal(refused.status, 503);
  assert.equal(refused.data.error.code, 'invitations_not_ready');
  assert.deepEqual(calls(), ['GET /api/v1/account']);
  provider.account.site = {status: 'approved', address: 'https://elsewhere.example', email_ready: true};
  assert.equal((await owner({action: 'approve', id, line_id: 77})).data.error.code, 'invitations_not_ready');
  const saved = await row(id);
  assert.deepEqual([saved.state, saved.attempted], ['pending', null]);
});

test('a failed or unconfirmed customer creation goes to review, is never retried, and is resolved with a note', async () => {
  provider.lines[77] = trialLine(77);
  provider.lines[78] = trialLine(78);
  provider.customer = 'fail';
  const failed = await pending(1);
  const result = await owner({action: 'approve', id: failed.id, line_id: 77});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {id: failed.id, state: 'needs_review', message: 'The trial needs review: check the line and customer in your provider panel, then resolve it with a note.'});
  assert.ok(!result.text.includes('provider-private'));
  let saved = await row(failed.id);
  assert.deepEqual([saved.state, saved.error, saved.line_id, saved.customer_id], ['needs_review', 'provider_unavailable', 77, null]);
  assert.ok(saved.attempted);
  assert.deepEqual(Object.keys((await status(failed.token)).data).sort(), ['requested_at', 'state']);
  assert.equal((await status(failed.token)).data.state, 'support');

  provider.customer = 'ok';
  assert.equal((await owner({action: 'approve', id: failed.id, line_id: 77})).data.error.code, 'trial_not_pending');
  assert.equal(provider.calls.filter(call => call.path === '/api/v1/customers').length, 1, 'never retried automatically');
  assert.equal((await owner({action: 'decline', id: failed.id})).status, 409);

  for (const note of [undefined, 'no', ' ok ', 'x'.repeat(501), 'bad\u0000note']) {
    const refused = await owner({action: 'resolve', id: failed.id, note});
    assert.equal(refused.status, 400);
    assert.equal(refused.data.error.code, 'resolution_note_required');
  }
  const resolved = await owner({action: 'resolve', id: failed.id, note: 'Customer created by hand in the panel.'});
  assert.deepEqual(resolved.data, {id: failed.id, state: 'resolved', message: 'Trial marked resolved.'});
  saved = await row(failed.id);
  assert.deepEqual([saved.state, saved.resolution], ['resolved', 'Customer created by hand in the panel.']);
  assert.equal((await status(failed.token)).data.state, 'support');
  assert.equal((await owner({action: 'resolve', id: failed.id, note: 'Again.'})).data.error.code, 'trial_not_resolvable');

  provider.customer = 'empty';
  const unconfirmed = await pending(2);
  assert.equal((await owner({action: 'approve', id: unconfirmed.id, line_id: 78})).data.state, 'needs_review');
  assert.equal((await row(unconfirmed.id)).error, 'activation_not_confirmed');
});

test('an approval still setting up can be resolved only after 10 minutes, and a pending request not at all', async () => {
  const {id, token} = await pending(1);
  assert.equal((await owner({action: 'resolve', id, note: 'Nothing to resolve.'})).data.error.code, 'trial_not_resolvable');
  await database.prepare("UPDATE trial_requests SET state='activating',attempted=?,decided=?,line_id=90 WHERE id=?").bind(Date.now(), Date.now(), id).run();
  assert.equal((await status(token)).data.state, 'setting_up');
  assert.equal((await owner({action: 'resolve', id, note: 'Checked the panel.'})).data.error.code, 'trial_not_resolvable');
  await database.prepare('UPDATE trial_requests SET attempted=? WHERE id=?').bind(Date.now() - 11 * 60 * 1000, id).run();
  assert.equal((await owner({action: 'resolve', id, note: 'Checked the panel.'})).data.state, 'resolved');
});

test('a declined request shows the owner\'s message, and the email may ask again', async () => {
  const {id, token} = await pending(1);
  assert.equal((await owner({action: 'decline', id, message: 'Bad\u0007message'})).status, 400);
  assert.equal((await owner({action: 'decline', id, message: 'x'.repeat(501)})).status, 400);
  const declined = await owner({action: 'decline', id, message: '  Sorry, trials are paused this week.\nPlease choose a plan.  '});
  assert.deepEqual(declined.data, {id, state: 'declined', message: 'Trial request declined.'});
  const checked = await status(token);
  assert.equal(checked.data.state, 'declined');
  assert.equal(checked.data.message, 'Sorry, trials are paused this week.\nPlease choose a plan.');
  assert.equal((await owner({action: 'approve', id, line_id: 77})).data.error.code, 'trial_not_pending');
  assert.equal((await owner({action: 'decline', id})).data.error.code, 'trial_not_pending');
  assert.deepEqual(provider.calls, []);

  const again = await call('/api/trial', {body: person(1), ip: '192.0.2.99'});
  assert.equal(again.status, 200, 'a declined request does not block the email');
  const second = await database.prepare("SELECT id FROM trial_requests WHERE state='pending'").first();
  assert.equal((await owner({action: 'decline', id: second.id})).status, 200);
  assert.deepEqual(Object.keys((await status(tokenOf(again))).data).sort(), ['requested_at', 'state'], 'no message when the owner left none');
});

test('an active trial ends at its expiry, and clean-up removes old requests idempotently', async () => {
  provider.lines[77] = trialLine(77);
  const {id, token} = await pending(1);
  assert.equal((await owner({action: 'approve', id, line_id: 77})).status, 200);
  const declined = await pending(2);
  assert.equal((await owner({action: 'decline', id: declined.id})).status, 200);
  const expires = (await row(id)).expires;

  const cleanup = async now => (await call('/test/cleanup?now=' + now, {method: 'GET'})).data;
  const early = await cleanup(expires - 1000);
  assert.deepEqual([early.trial_requests_ended, early.trial_requests_removed], [0, 0]);
  const ended = await cleanup(expires + 1000);
  assert.deepEqual([ended.trial_requests_ended, ended.trial_requests_removed], [1, 0]);
  assert.deepEqual(Object.keys(ended).slice(-2), ['trial_requests_ended', 'trial_requests_removed']);
  assert.ok(Object.values(await cleanup(expires + 1000)).every(count => count === 0), 'a second run changes nothing');
  assert.equal((await row(id)).state, 'ended');
  assert.deepEqual((await status(token)).data, {state: 'ended', requested_at: new Date((await row(id)).created).toISOString(), expires_at: new Date(expires).toISOString()});
  assert.equal((await queue()).trials.find(trial => trial.id === id).state, 'ended');
  assert.equal((await ask(1, '192.0.2.150')).data.error.code, 'trial_already_requested', 'an ended trial still counts');

  const month = await cleanup(Date.now() + 31 * DAY);
  assert.equal(month.trial_requests_removed, 1, 'the declined request goes 30 days after the decision');
  assert.equal(await row(declined.id), null);
  assert.ok(await row(id), 'the ended trial is kept for 180 days');
  const later = await cleanup(expires + 181 * DAY);
  assert.equal(later.trial_requests_removed, 1);
  assert.equal(await row(id), null);
  assert.ok(Object.values(await cleanup(expires + 181 * DAY)).every(count => count === 0));
});

// Owner email alerts (lib/trial-alert-send.ts). They go out after the response (waitUntil), so the tests wait for them.
async function resetAlerts() {
  for (const name of alertWorkers) {
    const db = await runtime.getD1Database('DB', name);
    await db.batch([db.prepare('DELETE FROM trial_requests'), db.prepare('DELETE FROM player_login_attempts')]);
  }
  mailbox.sent = [];
  mailbox.fail = false;
  mailbox.hold = null;
  logs.length = 0;
}
async function until(check, what) {
  for (const end = Date.now() + 10000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 20))) {
    const value = await check();
    if (value) return value;
  }
  assert.fail('Timed out waiting for ' + what);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 300));
const alertAsk = (n, ip, extra = {}, worker = 'trial-alerts') => call('/api/trial', {body: person(n, extra), ip, worker});
async function alertRows(worker = 'trial-alerts') {
  return (await (await runtime.getD1Database('DB', worker)).prepare('SELECT * FROM trial_requests ORDER BY created').all()).results;
}
function readMail(message) {
  const end = message.raw.indexOf('\r\n\r\n'), headers = {};
  for (const line of message.raw.slice(0, end).replace(/\r\n[ \t]/g, '').split('\r\n')) headers[line.slice(0, line.indexOf(':'))] = line.slice(line.indexOf(':') + 2);
  const subject = headers.Subject.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, data) => Buffer.from(data, 'base64').toString('utf8'));
  const encoded = message.raw.slice(end + 4).replace(/=\r\n/g, ''), bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '=') {bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2;}
    else bytes.push(encoded.charCodeAt(i));
  }
  return {headers, subject, body: Buffer.from(bytes).toString('utf8')};
}
async function mails(count) {
  await until(() => mailbox.sent.length >= count, count + ' alert(s)');
  await settle();
  assert.equal(mailbox.sent.length, count, 'exactly ' + count + ' alert(s)');
  return mailbox.sent.map(readMail);
}

test('each stored request emails the owner once, with the name and device but no email address, network or status link', async () => {
  await resetAlerts();
  const first = await alertAsk(1, '198.51.100.71', {name: '  Zoë Example  ', device: 'fire'});
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(Object.keys(first.data).sort(), ['state', 'status_url'], 'the answer is unchanged');
  let [mail] = await mails(1);
  const [message] = mailbox.sent, [stored] = await alertRows();
  assert.equal(message.from, 'alerts@lumanest.tv');
  assert.equal(message.to, 'owner@example.test');
  assert.equal(mail.headers.From, 'LumaNest TV <alerts@lumanest.tv>');
  assert.equal(mail.headers.To, '<owner@example.test>');
  assert.equal(mail.subject, 'New free-trial request – LumaNest TV');
  assert.match(mail.headers['Message-ID'], /^<[0-9a-f-]{36}@lumanest\.tv>$/);
  assert.match(mail.body, /^Name: Zoë Example$/m);
  assert.match(mail.body, /^Device: Fire TV$/m);
  assert.ok(mail.body.includes('(' + new Date(stored.created).toISOString() + ')'), 'the stored request time');
  assert.match(mail.body, /^Pending requests: 1$/m);
  assert.doesNotMatch(mail.body, /other request/, 'a first request has no repeat lines');
  assert.match(mail.body, /^Review it: https:\/\/lumanest\.tv\/manage$/m);
  const token = tokenOf(first);
  for (const secret of ['person1@example.test', '@', '198.51.100', token, stored.network, stored.email_key, stored.status_hash, stored.id]) {
    assert.ok(!mail.body.includes(secret), 'the alert body holds no ' + secret);
  }
  assert.equal(message.raw.split('person1').length, 1, 'the requester\'s email address is nowhere in the message');

  // The same home network asks again, with another address.
  assert.equal((await alertAsk(2, '198.51.100.71')).status, 200);
  mail = (await mails(2))[1];
  assert.match(mail.body, /^Name: Trial Person 2$/m);
  assert.match(mail.body, /^Device: Samsung TV$/m);
  assert.match(mail.body, /^Pending requests: 2$/m);
  assert.match(mail.body, /^This home network has made 1 other request in the last 30 days\.$/m);
  assert.doesNotMatch(mail.body, /email address has made/);

  // An address whose earlier request was declined may ask again; the alert says so.
  const owner = await runtime.getD1Database('DB', 'trial-alerts');
  await owner.prepare("UPDATE trial_requests SET state='declined',decided=? WHERE email=?").bind(Date.now(), 'person1@example.test').run();
  assert.equal((await alertAsk(1, '192.0.2.71')).status, 200);
  mail = (await mails(3))[2];
  assert.match(mail.body, /^Pending requests: 2$/m);
  assert.match(mail.body, /^This email address has made 1 other request\.$/m);
  assert.doesNotMatch(mail.body, /home network/);
  assert.deepEqual(provider.calls, [], 'alerts never reach the provider');
});

test('no alert for the honeypot, an invalid form, a repeated email, a used network, the rate limit or a full queue', async () => {
  await resetAlerts();
  const honeypot = await alertAsk(1, '198.51.100.81', {website: 'https://spam.example'});
  assert.equal(honeypot.status, 200);
  assert.equal((await alertAsk(1, '198.51.100.81', {consent: false})).status, 400);
  assert.equal((await alertAsk(2, '198.51.100.82')).status, 200, 'stored');
  assert.equal((await alertAsk(3, '198.51.100.82')).status, 200, 'stored');
  assert.equal((await alertAsk(4, '198.51.100.82')).data.error.code, 'trial_network_used');
  assert.equal((await alertAsk(5, '198.51.100.82')).data.error.code, 'trial_rate_limit');
  assert.equal((await alertAsk(2, '198.51.100.83')).data.error.code, 'trial_already_requested');
  const owner = await runtime.getD1Database('DB', 'trial-alerts'), now = Date.now();
  await owner.batch(Array.from({length: 48}, (_, i) => owner.prepare("INSERT INTO trial_requests (id,status_hash,email,email_key,name,device,network,state,created) VALUES (?,?,?,?,?,?,?,'pending',?)")
    .bind('queued-' + i, 'hash-' + i, `queued${i}@example.test`, 'email-' + i, 'Queued', 'web', 'network-' + i, now)));
  assert.equal((await alertAsk(6, '198.51.100.84')).data.error.code, 'trials_busy');
  await owner.prepare("UPDATE trial_requests SET state='declined' WHERE id='queued-0'").run();
  assert.equal((await alertAsk(7, '198.51.100.85')).status, 200, 'stored once the queue has room');
  const sent = await mails(3);
  assert.deepEqual(sent.map(mail => mail.body.match(/^Name: (.*)$/m)[1]), ['Trial Person 2', 'Trial Person 3', 'Trial Person 7'], 'one alert per stored request, in order');
  assert.match(sent[2].body, /^Pending requests: 50$/m);
});

test('without the binding, TRIAL_ALERT_TO or plain addresses, nothing is sent, the request still succeeds, and alerts set up but unable to send are logged', async () => {
  await resetAlerts();
  for (const [n, worker] of [[1, 'trial-alerts-no-to'], [2, 'trial-alerts-bad-to'], [3, 'trial-alerts-no-binding'], [5, 'trial-alerts-bad-from']]) {
    const result = await alertAsk(n, '198.51.100.9' + n, {}, worker);
    assert.equal(result.status, 200, worker + ' ' + result.text);
    assert.equal((await alertRows(worker)).length, 1, worker + ' stored the request');
  }
  // The configured worker shares the mailbox: only its request is emailed.
  assert.equal((await alertAsk(4, '198.51.100.94')).status, 200);
  const [mail] = await mails(1);
  assert.match(mail.body, /^Name: Trial Person 4$/m);
  // Alerts that aren't set up (no TRIAL_ALERT_TO, or not a plain address) log nothing. TRIAL_ALERT_TO without the
  // binding, as after a deploy prepared without --trial-alerts, or with an invalid sender logs a fixed code, once.
  const failures = () => logs.filter(log => log.message.includes('lumanest_trial_alert_failed')).map(log => log.message).sort();
  await until(() => failures().length >= 2, 'the two logs');
  assert.deepEqual(failures(), ['lumanest_trial_alert_failed {"code":"alert_binding_missing"}', 'lumanest_trial_alert_failed {"code":"alert_sender_invalid"}']);
  for (const log of logs) assert.ok(!/owner@example\.test|person\d@|Trial Person|198\.51\.100/.test(log.message), 'no personal data in ' + log.message);
});

test('the requester\'s answer never waits for the email: it comes back while the send is unfinished, and the alert still goes', async () => {
  await resetAlerts();
  let release, timer;
  mailbox.hold = new Promise(resolve => {release = resolve;});
  try {
    // A request that waited for the send would never answer while it is held, so it fails here instead of hanging.
    const result = await Promise.race([alertAsk(1, '198.51.100.111'), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('the answer waited for the email')), 5000);})]);
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(Object.keys(result.data).sort(), ['state', 'status_url']);
    await settle();
    assert.equal(mailbox.sent.length, 0, 'the send is still held when the answer arrives');
  } finally {
    clearTimeout(timer);
    release();
  }
  const [mail] = await mails(1);
  assert.match(mail.body, /^Name: Trial Person 1$/m, 'waitUntil kept the send alive after the response');
  assert.ok(!logs.some(log => log.message.includes('lumanest_trial_alert_failed')));
});

test('a mail binding that fails never changes the requester\'s answer, and is logged with a fixed code only', async () => {
  await resetAlerts();
  mailbox.fail = true;
  const result = await alertAsk(1, '198.51.100.101', {name: 'Private Name'});
  assert.equal(result.status, 200, result.text);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(Object.keys(result.data).sort(), ['state', 'status_url']);
  assert.equal((await call('/api/trial/status', {body: {token: tokenOf(result)}, worker: 'trial-alerts'})).data.state, 'pending', 'the request is stored');
  await until(() => logs.some(log => log.message.includes('lumanest_trial_alert_failed')), 'the failure log');
  const failures = logs.filter(log => log.message.includes('lumanest_trial_alert_failed'));
  assert.deepEqual(failures.map(log => log.message), ['lumanest_trial_alert_failed {"code":"alert_not_sent"}']);
  for (const log of logs) assert.ok(!/owner@example\.test|person1@|Private Name|198\.51\.100/.test(log.message), 'no personal data in ' + log.message);
  assert.equal(mailbox.sent.length, 0);

  mailbox.fail = false;
  assert.equal((await alertAsk(2, '198.51.100.102')).status, 200);
  const [mail] = await mails(1);
  assert.match(mail.body, /^Name: Trial Person 2$/m);
  assert.match(mail.body, /^Pending requests: 2$/m, 'the earlier request is still pending');
});
