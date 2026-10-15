import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {parseOptions, prepareCloudflare} from '../scripts/prepare-cloudflare.mjs';

const DATABASE_ID = '12345678-abcd-4321-abcd-123456789abc';

async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'lumanest-cloudflare-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  const root = pathToFileURL(path + '/');
  await mkdir(new URL('dist/server/', root), {recursive: true});
  await mkdir(new URL('dist/client/', root), {recursive: true});
  await writeFile(new URL('dist/server/wrangler.json', root), JSON.stringify({compatibility_date: '2026-10-06', vars: {DO_NOT_COPY: 'private-fixture-value'}, routes: ['old.invalid/*']}));
  await writeFile(new URL('dist/server/index.js', root), `
    export let received;
    let reply = () => new Response('ok');
    export function setReply(value) {reply = value;}
    export default {
      async fetch(request, env, ctx) {received = {request, env, ctx}; return reply(request);},
      scheduled() {},
    };
  `);
  await writeFile(new URL('dist/server/package.json', root), '{"type":"module"}');
  return root;
}

test('Cloudflare preparation starts without production routes, cron or copied variables', async t => {
  const root = await fixture(t);
  const {config} = await prepareCloudflare(parseOptions(['--database-id', DATABASE_ID]), root);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.triggers, undefined);
  assert.equal(config.vars, undefined);
  assert.equal(config.keep_vars, true);
  assert.equal(config.d1_databases[0].database_id, DATABASE_ID);
  assert.equal(config.d1_databases[0].migrations_dir, '../../drizzle');
  assert.equal(config.r2_buckets[0].bucket_name, 'lumanest-tv-downloads');
  assert.equal(config.compatibility_date, '2026-10-06');
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
  assert.equal(config.unsafe.metadata.observability.redact_query_string, true);
  const serialized = await readFile(new URL('dist/server/wrangler-cloudflare.json', root), 'utf8');
  assert.doesNotMatch(serialized, /private-fixture-value|old\.invalid/);
});

test('only the explicit production flag configures the apex domain', async t => {
  const root = await fixture(t);
  const {config} = await prepareCloudflare(parseOptions(['--database-id', DATABASE_ID, '--production']), root);
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{pattern: 'lumanest.tv', custom_domain: true}]);
  assert.doesNotMatch(JSON.stringify(config.routes), /portal\.|tv\.lumanest|streams\./);
});

test('preparation rejects omitted or placeholder databases and unknown arguments', () => {
  for (const args of [[], ['--database-id', '00000000-0000-4000-8000-000000000000'], ['--database-id', DATABASE_ID, '--route', 'elsewhere.invalid'], ['--database-id', DATABASE_ID, '--database-id', DATABASE_ID]]) {
    assert.throws(() => parseOptions(args));
  }
});

async function wrapper(t) {
  const root = await fixture(t);
  const target = new URL('dist/server/cloudflare-entry.mjs', root);
  await copyFile(new URL('../scripts/cloudflare-entry.mjs', import.meta.url), target);
  return {
    worker: (await import(target.href)).default,
    application: await import(new URL('dist/server/index.js', root).href),
  };
}

test('standalone entry strips hosting identity headers while preserving body, cookies and cancellation', async t => {
  const {worker, application} = await wrapper(t);
  const abort = new AbortController();
  const env = {DB: {}};
  const ctx = {waitUntil() {}};
  const request = new Request('https://lumanest.tv/api/example', {
    method: 'POST', body: 'unchanged body', signal: abort.signal,
    headers: {'OAI-Authenticated-User-Id': 'forged-owner', 'oai-authenticated-role': 'owner', Cookie: '__Host-lumanest_owner=fixture', Origin: 'https://lumanest.tv'},
  });
  const response = await worker.fetch(request, env, ctx);
  assert.equal(response.headers.get('X-LumaNest-Hosting'), 'cloudflare');
  assert.equal(application.received.request.headers.get('oai-authenticated-user-id'), null);
  assert.equal(application.received.request.headers.get('oai-authenticated-role'), null);
  assert.equal(application.received.request.headers.get('cookie'), '__Host-lumanest_owner=fixture');
  assert.equal(application.received.request.headers.get('origin'), 'https://lumanest.tv');
  assert.equal(await application.received.request.text(), 'unchanged body');
  assert.equal(application.received.env, env);
  assert.equal(application.received.ctx, ctx);
  abort.abort();
  assert.equal(application.received.request.signal.aborted, true);
});

test('hosting proof preserves response status, separate session cookies and streaming cancellation', async t => {
  const {worker, application} = await wrapper(t);
  let cancelled = false;
  application.setReply(() => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'one=1; HttpOnly');
    headers.append('Set-Cookie', 'two=2; HttpOnly');
    return new Response(new ReadableStream({cancel() {cancelled = true;}}), {status: 202, headers});
  });
  const response = await worker.fetch(new Request('https://lumanest.tv/api/example'), {}, {});
  assert.equal(response.status, 202);
  assert.equal(response.headers.getSetCookie().length, 2);
  await response.body.cancel();
  assert.equal(cancelled, true);
});

test('unexpected standalone errors expose and log no request or exception details', async t => {
  const {worker, application} = await wrapper(t);
  const messages = [];
  const previous = console.error;
  console.error = (...args) => messages.push(args);
  t.after(() => {console.error = previous;});
  application.setReply(() => {throw new Error('secret exception payload');});
  const response = await worker.fetch(new Request('https://lumanest.tv/api/example?token=secret-query'), {}, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-LumaNest-Hosting'), 'cloudflare');
  assert.doesNotMatch(await response.text(), /secret/);
  assert.deepEqual(messages, [['lumanest_standalone_request_failed']]);
});
