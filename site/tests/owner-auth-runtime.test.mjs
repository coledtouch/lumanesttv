import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

let runtime;
let database;
const EMAIL = 'support@lumanest.tv';
const PASSWORD = 'a private long test passphrase';
const NEXT_PASSWORD = 'another private long test passphrase';
const SETUP_TOKEN = 'runtime-one-time-owner-setup-token-0123456789';
const ownerHeaders = {'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'unrelated-owner@example.test'};
const sha = value => createHash('sha256').update(value).digest('hex');

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {POST as login} from './app/api/owner/login/route.ts';
        import {POST as setup} from './app/api/owner/setup/route.ts';
        import {POST as recover} from './app/api/owner/recover/route.ts';
        import {POST as logout} from './app/api/owner/logout/route.ts';
        import {POST as recoveryCode} from './app/api/owner/recovery-code/route.ts';
        import {getOwner,ownerConfigured} from './lib/owner-auth.ts';
        import {requireAdmin,errorResponse} from './lib/admin.ts';
        import {env} from 'cloudflare:workers';
        export default {async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname.startsWith('/second/')) {
            url.pathname = url.pathname.slice('/second'.length);
            return env.SECOND.fetch(new Request(url,request));
          }
          if (url.pathname.startsWith('/no-setup-token/')) {
            url.pathname = url.pathname.slice('/no-setup-token'.length);
            return env.NO_SETUP_TOKEN.fetch(new Request(url,request));
          }
          globalThis.__testHeaders = request.headers;
          const path = new URL(request.url).pathname;
          try {
            if (path === '/admin') return Response.json(await requireAdmin());
            if (path === '/owner') return Response.json({owner:await getOwner(),configured:await ownerConfigured()});
            if (request.method !== 'POST') return new Response(null,{status:405});
            const action = {'/api/owner/login':login,'/api/owner/setup':setup,'/api/owner/recover':recover,'/api/owner/logout':logout,'/api/owner/recovery-code':recoveryCode}[path];
            return action ? action(request) : new Response(null,{status:404});
          } catch(error) {return errorResponse(error);}
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'owner-auth-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name:'mock-framework-request-context', setup(builder) {
      builder.onResolve({filter:/^next\/(headers|navigation)$/}, args => ({path:args.path,namespace:'mock-framework'}));
      builder.onLoad({filter:/.*/,namespace:'mock-framework'}, args => ({contents:args.path.endsWith('/headers') ? 'export async function headers(){return globalThis.__testHeaders || new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}',loader:'js'}));
    }}]
  });
  runtime = new Miniflare({compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], cf:false, workers:[
    {name:'owner-runtime', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text, scriptPath:fileURLToPath(new URL('../owner-runtime-worker.js',import.meta.url)), bindings:{ADMIN_USER_ID:'runtime-owner',OWNER_SETUP_TOKEN:SETUP_TOKEN}, d1Databases:{DB:'owner-auth-test'},serviceBindings:{SECOND:'owner-runtime-second',NO_SETUP_TOKEN:'owner-no-setup-token'}},
    {name:'owner-runtime-second', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text, scriptPath:fileURLToPath(new URL('../owner-runtime-worker.js',import.meta.url)), bindings:{ADMIN_USER_ID:'runtime-owner',OWNER_SETUP_TOKEN:SETUP_TOKEN}, d1Databases:{DB:'owner-auth-test'}},
    {name:'owner-no-setup-token', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text, scriptPath:fileURLToPath(new URL('../owner-runtime-worker.js',import.meta.url)), bindings:{ADMIN_USER_ID:'runtime-owner'}, d1Databases:{DB:'owner-auth-test'}},
    {name:'owner-no-database', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text, scriptPath:fileURLToPath(new URL('../owner-runtime-worker.js',import.meta.url)), bindings:{ADMIN_USER_ID:'runtime-owner'}}
  ]});
  database = await runtime.getD1Database('DB', 'owner-runtime');
  const migration = await readFile(new URL('../drizzle/0002_fluffy_mystique.sql', import.meta.url), 'utf8');
  await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
});
test.after(async () => {await runtime?.dispose();});
test.beforeEach(async () => {
  await database.batch(['owner_sessions', 'owner_credentials', 'owner_auth_attempts'].map(table => database.prepare('DELETE FROM ' + table)));
});

async function post(action, input, extraHeaders = {}, override = {}) {
  const response = await runtime.dispatchFetch('https://lumanest.tv/api/owner/' + action, {
    method:'POST', headers:{Origin:'https://lumanest.tv','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.10',...extraHeaders}, body:JSON.stringify(input), ...override
  });
  return {response, status:response.status, data:await response.json(), cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}
async function admin(headers = {}) {
  const response = await runtime.dispatchFetch('https://lumanest.tv/admin', {headers});
  return {status:response.status, data:await response.json()};
}
async function secondPost(action, input, extraHeaders = {}) {
  const response = await runtime.dispatchFetch('https://lumanest.tv/second/api/owner/' + action, {
    method:'POST', headers:{Origin:'https://lumanest.tv','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.11',...extraHeaders},body:JSON.stringify(input)
  });
  return {response, status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}
async function setup() {
  const result = await post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result;
}

test('only the exact existing owner can bootstrap, and a missing database fails closed', async () => {
  assert.equal((await admin(ownerHeaders)).status, 200);
  assert.equal((await admin()).status, 401);
  assert.equal((await admin({...ownerHeaders,'oai-authenticated-user-id':'another-owner'})).status, 403);
  assert.equal((await post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN})).status, 401);
  assert.equal((await post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN}, {...ownerHeaders,'oai-authenticated-user-id':'another-owner'})).status, 403);
  const worker = await runtime.getWorker('owner-no-database');
  const response = await worker.fetch('https://lumanest.tv/admin', {headers:ownerHeaders});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'owner_storage_unavailable');
});

test('all owner actions require same-origin JSON and reject oversized or malformed bodies', async () => {
  for (const action of ['login','setup','recover','logout','recovery-code']) {
    assert.equal((await post(action, {}, {Origin:'https://attacker.example.test'})).status, 403);
    assert.equal((await post(action, {}, {'Content-Type':'text/plain'})).status, 415);
    assert.equal((await post(action, {}, {}, {body:'x'.repeat(8193)})).status, 413);
    assert.equal((await post(action, {}, {}, {body:'{'})).status, 400);
    assert.equal((await post(action, {}, {}, {body:'[]'})).status, 400);
  }
});

test('setup requires a 16–128 character password and cannot change the server owner email', async () => {
  for (const password of ['short', 'x'.repeat(129)]) assert.equal((await post('setup', {password,setupToken:SETUP_TOKEN}, ownerHeaders)).status, 400);
  assert.equal((await post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN,email:'attacker@example.test'}, ownerHeaders)).status, 400);
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_credentials').first('count'), 0);
});

test('real workerd scrypt setup stores hashes, sets the secure session, and cuts off ChatGPT-only access', async () => {
  const result = await setup();
  assert.deepEqual(Object.keys(result.data).sort(), ['ok','recoveryCode']);
  assert.match(result.data.recoveryCode, /^(?:[A-F0-9]{8}-){7}[A-F0-9]{8}$/);
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
  assert.match(result.response.headers.get('Set-Cookie'), /^__Host-lumanest_owner=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  const row = await database.prepare('SELECT * FROM owner_credentials').first();
  assert.equal(row.email, EMAIL);
  assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(row.recovery_hash, sha(result.data.recoveryCode.replaceAll('-','').toLowerCase()));
  assert.ok(!JSON.stringify(row).includes(PASSWORD));
  assert.ok(!JSON.stringify(row).includes(result.data.recoveryCode));
  const session = await database.prepare('SELECT * FROM owner_sessions').first();
  assert.equal(session.token_hash, sha(result.cookie.split('=')[1]));
  assert.equal(session.credential_version, row.version);
  assert.ok(!JSON.stringify(session).includes(result.cookie.split('=')[1]));
  assert.equal((await admin(ownerHeaders)).status, 401);
  const signedIn = await admin({Cookie:result.cookie});
  assert.equal(signedIn.status, 200);
  assert.deepEqual(signedIn.data, {userId:'owner',email:EMAIL,displayName:'LumaNest owner',method:'password'});
  assert.equal((await post('setup', {password:NEXT_PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders)).status, 409);
});

test('owner login verifies the real password, normalizes email, and returns no credential or recovery code', async () => {
  await setup();
  assert.equal((await post('login', {email:'another@example.test',password:PASSWORD})).status, 401);
  assert.equal((await post('login', {email:EMAIL,password:'a wrong private passphrase'})).status, 401);
  const result = await post('login', {email:' SUPPORT@LUMANEST.TV ',password:PASSWORD});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data, {ok:true});
  assert.equal((await admin({Cookie:result.cookie})).status, 200);
});

test('recovery rotates password, recovery code and credential version, revoking every previous session', async () => {
  const initial = await setup();
  const second = await post('login', {email:EMAIL,password:PASSWORD});
  assert.equal(second.status, 200);
  assert.equal((await post('recover', {email:'another@example.test',recoveryCode:initial.data.recoveryCode,password:NEXT_PASSWORD})).status, 401);
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:'not-the-code',password:NEXT_PASSWORD})).status, 401);
  const result = await post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:NEXT_PASSWORD});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.notEqual(result.data.recoveryCode, initial.data.recoveryCode);
  assert.equal((await admin({Cookie:initial.cookie})).status, 401);
  assert.equal((await admin({Cookie:second.cookie})).status, 401);
  assert.equal((await admin({...ownerHeaders,Cookie:initial.cookie})).status, 401);
  assert.equal((await admin({Cookie:result.cookie})).status, 200);
  assert.equal((await post('login', {email:EMAIL,password:PASSWORD})).status, 401);
  assert.equal((await post('login', {email:EMAIL,password:NEXT_PASSWORD})).status, 200);
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:PASSWORD})).status, 401);
});

test('logout revokes the server session and expires the host-only cookie', async () => {
  const initial = await setup();
  const result = await post('logout', {}, {Cookie:initial.cookie});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {ok:true});
  assert.match(result.response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
  assert.equal((await admin({Cookie:initial.cookie})).status, 401);
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_sessions').first('count'), 0);
});

test('expired, malformed and duplicate session cookies do not authorize the owner', async () => {
  const initial = await setup();
  assert.equal((await admin({Cookie:'__Host-lumanest_owner=not-a-token'})).status, 401);
  assert.equal((await admin({Cookie:initial.cookie+'; '+initial.cookie})).status, 401);
  await database.prepare('UPDATE owner_sessions SET expires=?').bind(Date.now()-1).run();
  assert.equal((await admin({Cookie:initial.cookie})).status, 401);
});

test('per-IP throttles enforce atomic limits and return a bounded retry time', async () => {
  await setup();
  await database.prepare('INSERT INTO owner_auth_attempts (id,count,expires) VALUES (?,?,?)').bind(sha('login:ip:192.0.2.10'),10,Date.now()+900000).run();
  const result = await post('login', {email:EMAIL,password:PASSWORD});
  assert.equal(result.status, 429);
  assert.equal(result.data.error.code, 'owner_rate_limit');
  assert.ok(Number(result.response.headers.get('Retry-After')) > 0);
  assert.ok(Number(result.response.headers.get('Retry-After')) <= 900);
  await database.prepare('DELETE FROM owner_auth_attempts').run();
  await database.prepare('INSERT INTO owner_auth_attempts (id,count,expires) VALUES (?,?,?)').bind(sha('recover:ip:192.0.2.10'),5,Date.now()+3600000).run();
  assert.equal((await post('recover', {email:EMAIL,password:NEXT_PASSWORD,recoveryCode:'invalid'})).status, 429);
});

test('attempts from other clients cannot lock the owner out', async () => {
  await setup();
  await database.prepare('DELETE FROM owner_auth_attempts').run();
  for (const scope of ['global','account:'+EMAIL,'ip:198.51.100.7']) await database.prepare('INSERT INTO owner_auth_attempts (id,count,expires) VALUES (?,?,?)').bind(sha('login:'+scope),1000,Date.now()+900000).run();
  assert.equal((await post('login', {email:EMAIL,password:PASSWORD})).status, 200);
});

test('competing setup requests create exactly one credential and one private recovery code', async () => {
  const results = await Promise.all([post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders), post('setup', {password:NEXT_PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders)]);
  assert.equal(results.filter(result => result.status===200).length, 1, JSON.stringify(results.map(result=>result.data)));
  assert.ok(results.filter(result=>result.status!==200).every(result=>[409,503].includes(result.status)));
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_credentials').first('count'), 1);
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_sessions').first('count'), 1);
  for (const result of results.filter(result=>result.status!==200)) assert.equal(result.data.recoveryCode, undefined);
});

test('independent Worker isolates atomically select one setup and one recovery winner in shared D1', async () => {
  const setupResults = await Promise.all([post('setup', {password:PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders), secondPost('setup', {password:NEXT_PASSWORD,setupToken:SETUP_TOKEN}, ownerHeaders)]);
  assert.deepEqual(setupResults.map(result=>result.status).sort(), [200,409]);
  const initial = setupResults.find(result=>result.status===200);
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_credentials').first('count'), 1);
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_sessions').first('count'), 1);
  const recoveryResults = await Promise.all([
    post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:PASSWORD}),
    secondPost('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:NEXT_PASSWORD})
  ]);
  assert.deepEqual(recoveryResults.map(result=>result.status).sort(), [200,401]);
  const winner = recoveryResults.find(result=>result.status===200);
  const row = await database.prepare('SELECT * FROM owner_credentials').first();
  assert.equal(row.recovery_hash, sha(winner.data.recoveryCode.replaceAll('-','').toLowerCase()));
  assert.equal((await admin({Cookie:initial.cookie})).status, 401);
  assert.equal((await admin({Cookie:winner.cookie})).status, 200);
  assert.equal(recoveryResults.find(result=>result.status!==200).data.recoveryCode, undefined);
});

test('a signed-in owner can replace a lost recovery code only after verifying the current password', async () => {
  assert.equal((await post('recovery-code', {password:PASSWORD}, ownerHeaders)).status, 401);
  const initial = await setup();
  assert.equal((await post('recovery-code', {password:PASSWORD}, ownerHeaders)).status, 401);
  assert.equal((await post('recovery-code', {password:'a wrong private passphrase'}, {Cookie:initial.cookie})).status, 401);
  const before = await database.prepare('SELECT * FROM owner_credentials').first();
  const result = await post('recovery-code', {password:PASSWORD}, {Cookie:initial.cookie});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.cookie, undefined);
  assert.notEqual(result.data.recoveryCode, initial.data.recoveryCode);
  const after = await database.prepare('SELECT * FROM owner_credentials').first();
  assert.equal(before.version, after.version);
  assert.equal(before.password_hash, after.password_hash);
  assert.equal((await admin({Cookie:initial.cookie})).status, 200);
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:NEXT_PASSWORD})).status, 401);
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:result.data.recoveryCode,password:NEXT_PASSWORD})).status, 200);
});

test('recovery and code regeneration cannot both commit against the same prior credentials across isolates', async () => {
  const initial = await setup();
  const results = await Promise.all([
    post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:NEXT_PASSWORD}),
    secondPost('recovery-code', {password:PASSWORD}, {Cookie:initial.cookie})
  ]);
  assert.equal(results.filter(result=>result.status===200).length, 1, JSON.stringify(results.map(result=>result.data)));
  assert.ok(results.filter(result=>result.status!==200).every(result=>[401,409].includes(result.status)));
  const winner = results.find(result=>result.status===200);
  const row = await database.prepare('SELECT * FROM owner_credentials').first();
  assert.equal(row.recovery_hash, sha(winner.data.recoveryCode.replaceAll('-','').toLowerCase()));
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:initial.data.recoveryCode,password:PASSWORD})).status, 401);
  assert.equal((await post('recover', {email:EMAIL,recoveryCode:winner.data.recoveryCode,password:PASSWORD})).status, 200);
});

test('concurrent owner logins either complete in sequence or return the explicit busy retry response', async () => {
  await setup();
  const results = await Promise.all([post('login', {email:EMAIL,password:PASSWORD}),post('login', {email:EMAIL,password:PASSWORD})]);
  assert.ok(results.some(result=>result.status===200));
  assert.ok(results.every(result=>[200,503].includes(result.status)));
  for (const busy of results.filter(result=>result.status===503)) {
    assert.equal(busy.data.error.code, 'owner_sign_in_busy');
    assert.equal(busy.response.headers.get('Retry-After'), '3');
  }
});

test('first-owner setup requires the configured one-time setup token in addition to the trusted identity', async () => {
  assert.equal((await post('setup', {password:PASSWORD}, ownerHeaders)).status, 400);
  for (const setupToken of ['', 'wrong-token-'.repeat(4), SETUP_TOKEN + 'x', 42]) {
    const result = await post('setup', {password:PASSWORD,setupToken}, ownerHeaders);
    assert.equal(result.status, 403, String(setupToken));
    assert.equal(result.data.error.code, 'invalid_setup_token');
  }
  const disabled = await runtime.dispatchFetch('https://lumanest.tv/no-setup-token/api/owner/setup', {method:'POST', headers:{Origin:'https://lumanest.tv','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.12',...ownerHeaders}, body:JSON.stringify({password:PASSWORD,setupToken:SETUP_TOKEN})});
  const disabledBody = await disabled.json();
  assert.equal(disabled.status, 503, JSON.stringify(disabledBody));
  assert.equal(disabledBody.error.code, 'owner_setup_disabled');
  assert.equal(await database.prepare('SELECT count(*) AS count FROM owner_credentials').first('count'), 0);
  assert.equal((await post('setup', {password:PASSWORD,setupToken:'  ' + SETUP_TOKEN + ' '}, ownerHeaders)).status, 200);
});
