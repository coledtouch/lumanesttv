import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';

let runtime;

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {POST as startPOST} from './app/api/pair/start/route.ts';
        import {POST as pollPOST, OPTIONS as pollOPTIONS} from './app/api/pair/poll/route.ts';
        import {GET as pairGET, POST as pairPOST} from './app/api/player/pair/route.ts';
        import {seal} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {env} from 'cloudflare:workers';
        export default {async fetch(request) {
          globalThis.__testHeaders = request.headers;
          const headers = new Headers(request.headers);
          const kind = headers.get('test-player-session');
          if (kind === 'valid') {
            globalThis.__cookie ||= await seal({username:'pair-user',password:'pair-secret',exp:Date.now()+60000,sid:crypto.randomUUID()}, env.PLAYER_COOKIE_KEY, 'player-session');
            headers.set('Cookie', PLAYER_COOKIE + '=' + globalThis.__cookie);
          }
          if (headers.get('test-same-origin')) headers.set('Origin', new URL(request.url).origin);
          const req = new Request(request, {headers});
          const {pathname} = new URL(request.url);
          if (pathname === '/api/pair/start') return startPOST(req);
          if (pathname === '/api/pair/poll') return request.method === 'OPTIONS' ? pollOPTIONS() : pollPOST(req);
          return request.method === 'POST' ? pairPOST(req) : pairGET(req);
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'pairing-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name:'mock-framework-request-context',setup(builder) {
      builder.onResolve({filter:/^next\/(headers|navigation)$/}, args => ({path:args.path,namespace:'mock-framework'}));
      builder.onLoad({filter:/.*/,namespace:'mock-framework'}, args => ({contents:args.path.endsWith('/headers') ? 'export async function headers(){return globalThis.__testHeaders || new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}',loader:'js'}));
    }}]
  });
  const worker = (name, bindings) => ({name, compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text, scriptPath:fileURLToPath(new URL('../pairing-runtime-worker.js', import.meta.url)), d1Databases:{DB:name+'-db'}, bindings:{PLAYER_COOKIE_KEY:'b'.repeat(64), CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv', ...bindings}});
  runtime = new Miniflare({workers:[worker('pairing', {}), worker('pairing-xtream', {TV_APP_XTREAM_SERVER:'https://xtream.lumanest.tv/'}), worker('pairing-bare-host', {TV_APP_XTREAM_SERVER:' xtream.lumanest.tv '})]});
  const migrations = [];
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) migrations.push(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  for (const name of ['pairing', 'pairing-xtream', 'pairing-bare-host']) {
    const database = await runtime.getD1Database('DB', name);
    for (const migration of migrations) await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
});
test.after(async () => {await runtime?.dispose();});

async function call(path, {method = 'POST', body, headers = {}, worker = 'pairing', ip = '203.0.113.1'} = {}) {
  const url = new URL(path, 'https://lumanest.tv');
  const response = await (await runtime.getWorker(worker)).fetch(url, {method, headers: {'cf-connecting-ip': ip, ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json()};
}
const signedIn = {'test-player-session': 'valid', 'test-same-origin': '1', 'Content-Type': 'application/json'};

test('a TV pairs once with the login of the approving web player session', async () => {
  const start = await call('/api/pair/start', {body: {device: 'samsung'}, headers: {'Content-Type': 'text/plain'}});
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('Access-Control-Allow-Origin'), '*');
  const {deviceCode, userCode, verificationUriComplete, qr, interval, expiresIn} = start.data;
  assert.match(deviceCode, /^[A-Za-z0-9_-]{43}$/);
  assert.match(userCode, /^[B-DF-HJ-NP-TV-XZ2-9]{4}-[B-DF-HJ-NP-TV-XZ2-9]{4}$/);
  assert.equal(verificationUriComplete, 'https://lumanest.tv/pair?code=' + userCode);
  assert.ok(qr.length >= 21 && qr.every(row => row.length === qr.length && /^[01]+$/.test(row)));
  assert.equal(interval, 5); assert.equal(expiresIn, 600);

  assert.deepEqual((await call('/api/pair/poll', {body: {deviceCode}})).data, {status: 'pending'});
  assert.equal((await call('/api/player/pair?code=' + userCode, {method: 'GET'})).status, 401);
  const described = await call('/api/player/pair?code=' + userCode.toLowerCase().replace('-', ' '), {method: 'GET', headers: signedIn});
  assert.deepEqual(described.data, {code: userCode, device: 'Samsung TV', username: 'pair-user'});

  assert.equal((await call('/api/player/pair', {body: {code: userCode}, headers: {'test-player-session': 'valid'}})).status, 403);
  assert.equal((await call('/api/player/pair', {body: {code: userCode}, headers: signedIn})).status, 200);
  assert.equal((await call('/api/player/pair', {body: {code: userCode}, headers: signedIn})).status, 404);

  const approved = await call('/api/pair/poll', {body: {deviceCode}});
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.data, {status: 'approved', account: {type: 'm3u', name: 'LumaNest TV', m3uUrl: 'https://tv.lumanest.tv/m3u?u=pair-user&p=pair-secret'}});
  assert.deepEqual((await call('/api/pair/poll', {body: {deviceCode}})).data, {status: 'expired'});
});

test('an Xtream server setting pairs the TV in Xtream mode', async () => {
  const {data: {deviceCode, userCode}} = await call('/api/pair/start', {body: {device: 'android'}, worker: 'pairing-xtream'});
  assert.equal((await call('/api/player/pair', {body: {code: userCode}, headers: signedIn, worker: 'pairing-xtream'})).data.device, 'Android TV / Google TV / Fire TV');
  assert.deepEqual((await call('/api/pair/poll', {body: {deviceCode}, worker: 'pairing-xtream'})).data.account, {type: 'xtream', name: 'LumaNest TV', server: 'https://xtream.lumanest.tv', username: 'pair-user', password: 'pair-secret'});
});

test('a bare Xtream host is treated as HTTPS', async () => {
  const {data: {deviceCode, userCode}} = await call('/api/pair/start', {body: {device: 'lg'}, worker: 'pairing-bare-host'});
  assert.equal((await call('/api/player/pair', {body: {code: userCode}, headers: signedIn, worker: 'pairing-bare-host'})).status, 200);
  assert.equal((await call('/api/pair/poll', {body: {deviceCode}, worker: 'pairing-bare-host'})).data.account.server, 'https://xtream.lumanest.tv');
});

test('a Roku pairs and is named on the approval page', async () => {
  const start = await call('/api/pair/start', {body: {device: 'roku'}, ip: '198.51.100.9'});
  assert.equal(start.status, 200);
  assert.equal((await call('/api/player/pair?code=' + start.data.userCode, {method: 'GET', headers: signedIn})).data.device, 'Roku');
});

test('pairing rejects bad input and limits codes per network', async () => {
  assert.equal((await call('/api/pair/start', {body: {device: 'vcr'}})).status, 400);
  assert.equal((await call('/api/pair/poll', {body: {deviceCode: 'short'}})).status, 400);
  assert.equal((await call('/api/pair/poll', {method: 'OPTIONS'})).status, 204);
  assert.deepEqual((await call('/api/pair/poll', {body: {deviceCode: 'A'.repeat(43)}})).data, {status: 'expired'});
  assert.equal((await call('/api/player/pair', {body: {code: 'BBBB-BBBB'}, headers: signedIn})).status, 404);
  assert.equal((await call('/api/player/pair', {body: {code: 'not a code'}, headers: signedIn})).status, 400);
  for (let i = 0; i < 10; i++) assert.equal((await call('/api/pair/start', {body: {device: 'lg'}, ip: '198.51.100.7'})).status, 200);
  const limited = await call('/api/pair/start', {body: {device: 'lg'}, ip: '198.51.100.7'});
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'), '*');
});
