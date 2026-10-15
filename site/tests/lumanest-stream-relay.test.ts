import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ALLOWED_HOSTS, allowedHosts, createStreamRelay, hostAllowed} from '../cloudflare/lumanest-stream-relay.mjs';

const key = 'a'.repeat(64);
const env = {STREAM_RELAY_KEY: key};
const stream = 'http://136.148.65.126/live/test-user/test-password/1.ts?token=private-test-token';
const encode = (value: string) => new TextEncoder().encode(value);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function request(input: unknown = {url: stream}, options: {authorization?: string; signal?: AbortSignal; path?: string; method?: string} = {}) {
  return new Request('https://streams.lumanest.tv' + (options.path || '/relay'), {
    method: options.method || 'POST', signal: options.signal,
    headers: {'Content-Type': 'application/json', Authorization: options.authorization ?? 'Bearer ' + key},
    body: options.method === 'GET' ? undefined : JSON.stringify(input),
  });
}
function socketServer(parts: (string | Uint8Array)[], options: {stall?: boolean; opened?: Promise<unknown>; idleTimeout?: number; idleCheck?: number} = {}) {
  let closes = 0, pulls = 0, canceled = 0;
  const writes: string[] = [];
  const addresses: {hostname: string; port: number}[] = [];
  let source: ReadableStreamDefaultController<Uint8Array>;
  let index = 0;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {source = controller;},
    pull(controller) {
      pulls++;
      const value = parts[index++];
      if (value !== undefined) controller.enqueue(typeof value === 'string' ? encode(value) : value);
      else if (options.stall) return new Promise<void>(() => {});
      else controller.close();
    },
    cancel() {canceled++;},
  }, {highWaterMark: 0});
  const relay = createStreamRelay((address: {hostname: string; port: number}) => {
    addresses.push(address);
    return {
      readable,
      writable: new WritableStream<Uint8Array>({write(bytes) {writes.push(new TextDecoder().decode(bytes));}}),
      opened: options.opened || Promise.resolve({}), closed: Promise.resolve(),
      close() {closes++; try {source.close();} catch {} return Promise.resolve();},
    };
  }, {idleTimeout: options.idleTimeout, idleCheck: options.idleCheck});
  return {relay, writes, addresses, readable, get closes() {return closes;}, get pulls() {return pulls;}, get canceled() {return canceled;}};
}

test('relay authenticates before reading or opening a connection and accepts only its POST endpoint', async () => {
  const server = socketServer([]);
  for (const authorization of ['', 'Bearer wrong', 'Basic ' + key]) {
    const response = await server.relay.fetch(request(undefined, {authorization}), env);
    assert.equal(response.status, 401);
  }
  assert.equal((await server.relay.fetch(request(), {STREAM_RELAY_KEY: 'short'})).status, 401);
  assert.equal((await server.relay.fetch(request({}, {path: '/other'}), env)).status, 404);
  assert.equal((await server.relay.fetch(request({}, {path: '/relay?url=private'}), env)).status, 404);
  assert.equal((await server.relay.fetch(request({}, {method: 'GET'}), env)).status, 405);
  assert.equal(server.addresses.length, 0);
});

test('relay rejects SSRF destinations, malformed authorities, injected headers and unknown JSON properties', async () => {
  const urls = ['http://127.0.0.1/private', 'http://169.254.169.254/private', 'http://136.148.66.126/private', 'http://136.148.65.0/private', 'http://136.148.65.255/private', 'http://38.190.178.55/private', 'https://136.148.65.126/private', 'http://provider.example/private', 'http://user:password@136.148.65.126/private', 'http://136.148.65.126:8080/private', 'http://136.148.65.126/private#fragment', 'http://136.148.65.126/', 'http://136.148.65.126/private\r\nX-Injection: true', 'http://0x8894417e/private'];
  for (const url of urls) {
    const server = socketServer([]);
    assert.equal((await server.relay.fetch(request({url}), env)).status, 400, url);
    assert.equal(server.addresses.length, 0);
  }
  const server = socketServer([]);
  for (const input of [null, [], {url: stream, headers: {}}, {url: stream, range: 'bytes=0-1\r\nX: bad'}, {url: stream, range: 'bytes=0-1,3-4'}, {url: stream, range: 'bytes=-0'}, {url: stream, range: 'bytes=3-1'}, {url: stream, range: 'bytes=9007199254740992-'}, {url: stream, range: null}]) assert.equal((await server.relay.fetch(request(input), env)).status, 400);
  assert.equal((await server.relay.fetch(request({url: stream + 'x'.repeat(13000)}), env)).status, 400);
  assert.equal(server.addresses.length, 0);
});

test('fixed-length media forwards only approved headers and safely generates the upstream request', async () => {
  const server = socketServer(['HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Length: 3\r\nAccept-Ranges: bytes\r\nContent-Range: bytes 5-7/10\r\nSet-Cookie: private=value\r\nX-Private: hidden\r\n\r\nABCEXCESS']);
  const response = await server.relay.fetch(request({url: stream.replace('.126/', '.126:80/'), range: 'bytes=5-7'}), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Content-Range'), 'bytes 5-7/10');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  for (const name of ['Set-Cookie', 'X-Private', 'Content-Length']) assert.equal(response.headers.get(name), null);
  assert.equal(await response.text(), 'ABC');
  assert.deepEqual(server.addresses, [{hostname: '136.148.65.126', port: 80}]);
  assert.match(server.writes[0], /^GET \/live\/test-user\/test-password\/1\.ts\?token=private-test-token HTTP\/1\.0\r\nHost: 136\.148\.65\.126\r\n/);
  assert.ok(server.writes[0].includes('Range: bytes=5-7\r\n'));
  assert.ok(server.writes[0].includes('Accept-Encoding: identity\r\nConnection: close\r\n'));
  assert.ok(!server.writes[0].includes(key));
  assert.equal(server.closes, 1);
  assert.equal(server.readable.locked, false);
});

test('the original approved provider IP and single suffix ranges are supported', async () => {
  const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 1\r\n\r\nX']);
  const response = await server.relay.fetch(request({url: 'http://38.190.178.54/live/1', range: 'bytes=-1024'}), env);
  assert.equal(await response.text(), 'X');
  assert.equal(server.addresses[0].hostname, '38.190.178.54');
  assert.ok(server.writes[0].includes('Range: bytes=-1024\r\n'));
});

test('chunked responses stream decoded data across arbitrary header and chunk boundaries', async () => {
  const raw = 'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n3;extension=yes\r\nABC\r\n2\r\nDE\r\n0\r\nX-Private-Trailer: secret\r\n\r\n';
  const server = socketServer(Array.from(raw));
  const response = await server.relay.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ABCDE');
  assert.equal(response.headers.get('Transfer-Encoding'), null);
  assert.equal(response.headers.get('X-Private-Trailer'), null);
  assert.equal(server.closes, 1);
});

test('EOF-delimited media is pulled on demand without buffering future body chunks', async () => {
  const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\n', 'ABC', 'DEF']);
  const response = await server.relay.fetch(request(), env);
  const headerPulls = server.pulls;
  await tick();
  assert.equal(server.pulls, headerPulls);
  assert.equal(await response.text(), 'ABCDEF');
  await tick();
  assert.equal(server.closes, 1);
});

test('native EOF pumping propagates downstream cancellation and request abort to the socket', {timeout: 3000}, async () => {
  for (const abortRequest of [false, true]) {
    const controller = new AbortController();
    const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\nABC'], {stall: true});
    const response = await server.relay.fetch(request(undefined, {signal: controller.signal}), env);
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'ABC');
    const pending = reader.read();
    await tick();
    if (abortRequest) {
      const rejected = assert.rejects(pending);
      controller.abort();
      assert.equal(server.closes, 1);
      await rejected;
    } else {
      await reader.cancel('next channel');
      assert.deepEqual(await pending, {value: undefined, done: true});
    }
    await tick();
    assert.equal(server.closes, 1);
    assert.equal(server.readable.locked, false);
  }
});

test('request abort cancels a native prefix write before any downstream reader is attached', {timeout: 3000}, async () => {
  const controller = new AbortController();
  const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\nABC'], {stall: true});
  const response = await server.relay.fetch(request(undefined, {signal: controller.signal}), env);
  controller.abort();
  assert.equal(server.closes, 1);
  await assert.rejects(response.text());
  await tick();
  assert.equal(server.readable.locked, false);
  assert.equal(server.closes, 1);
});

test('non-media, non-success, oversized, conflicting and malformed headers never expose upstream content', async () => {
  for (const raw of [
    'HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\nprivate upstream error body',
    'HTTP/1.1 302 Found\r\nLocation: http://private.example/user/password\r\n\r\n',
    'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nprivate upstream error body',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\nABC',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 3\r\nTransfer-Encoding: chunked\r\n\r\nABC',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Encoding: gzip\r\n\r\nABC',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nX-Private: ' + 'x'.repeat(32768) + '\r\n\r\n',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\n Folded: invalid\r\n\r\n',
  ]) {
    const server = socketServer([raw]);
    const response = await server.relay.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {error: 'stream_unavailable'});
    assert.equal(response.headers.get('Location'), null);
    assert.equal(server.closes, 1);
  }
});

test('truncated and malformed response bodies fail with a safe error and close their socket', async () => {
  for (const raw of [
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 4\r\n\r\nAB',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\nnot-hex\r\nprivate',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nAB',
    'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nAXX0\r\n\r\n',
  ]) {
    const server = socketServer([raw]);
    const response = await server.relay.fetch(request(), env);
    assert.equal(response.status, 200);
    await assert.rejects(response.text(), {message: 'The stream connection is unavailable.'});
    assert.equal(server.closes, 1);
    assert.equal(server.readable.locked, false);
  }
});

test('canceling a stalled downstream read closes the socket immediately and settles pending reads', {timeout: 3000}, async () => {
  const server = socketServer(['HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nABC\r\n'], {stall: true});
  const response = await server.relay.fetch(request(), env);
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'ABC');
  const pending = reader.read();
  await tick();
  const cancelled = reader.cancel('channel changed');
  assert.equal(server.closes, 1);
  await cancelled;
  assert.deepEqual(await pending, {value: undefined, done: true});
  assert.equal(server.readable.locked, false);
});

test('request cancellation interrupts connection setup and active streaming without leaking errors', {timeout: 3000}, async () => {
  const controller = new AbortController();
  const connecting = socketServer([], {opened: new Promise(() => {})});
  const pendingResponse = connecting.relay.fetch(request(undefined, {signal: controller.signal}), env);
  while (connecting.addresses.length === 0) await tick();
  controller.abort();
  assert.equal((await pendingResponse).status, 502);
  assert.equal(connecting.closes, 1);

  const activeController = new AbortController();
  const active = socketServer(['HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n'], {stall: true});
  const response = await active.relay.fetch(request(undefined, {signal: activeController.signal}), env);
  const reader = response.body!.getReader();
  const read = reader.read();
  const rejected = assert.rejects(read, {message: 'The stream connection is unavailable.'});
  await tick(); activeController.abort();
  assert.equal(active.closes, 1);
  await rejected;
  assert.equal(active.readable.locked, false);
});

test('provider allowlist parses strict exact addresses and /24 networks and keeps the original default', () => {
  const defaults = allowedHosts(undefined)!;
  assert.deepEqual(allowedHosts(''), defaults);
  assert.deepEqual(allowedHosts(DEFAULT_ALLOWED_HOSTS), defaults);
  for (const host of ['136.148.65.1', '136.148.65.126', '136.148.65.254', '38.190.178.54']) assert.ok(hostAllowed(host, defaults), host);
  for (const host of ['136.148.65.0', '136.148.65.255', '136.148.66.1', '38.190.178.55', '127.0.0.1', '0x8894417e', '136.148.065.1', '']) assert.equal(hostAllowed(host, defaults), false, host);
  const custom = allowedHosts(' 203.1.113.0/24 , 8.8.8.8')!;
  for (const host of ['203.1.113.7', '8.8.8.8']) assert.ok(hostAllowed(host, custom), host);
  for (const host of ['203.1.113.0', '203.1.113.255', '8.8.8.9', '136.148.65.126', '38.190.178.54']) assert.equal(hostAllowed(host, custom), false, host);
  for (const value of [' ', ',', '8.8.8.8,', '8.8.8', '8.8.8.08', '256.1.1.1', '8.8.8.8/32', '8.8.8.0/16', '8.8.8.1/24', '8.8.8.0/24/24', 'example.com', '::1', '8.8.8.8 9.9.9.9', 'x'.repeat(4097), Array(257).fill('8.8.8.8').join(',')]) {
    assert.equal(allowedHosts(value), null, value.slice(0, 40));
  }
  for (const value of ['127.0.0.1', '10.1.2.3', '172.16.0.0/24', '172.31.255.1', '192.168.1.0/24', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.0/24', '8.8.8.8,127.0.0.0/24']) {
    assert.equal(allowedHosts(value), null, value);
  }
  assert.equal(hostAllowed('172.15.255.1', allowedHosts('172.15.255.1')!), true);
  assert.equal(hostAllowed('172.32.0.1', allowedHosts('172.32.0.0/24')!), true);
});

test('relay uses the configured allowlist, still refuses private hosts and fails closed on invalid configuration', async () => {
  const configured = {...env, STREAM_RELAY_ALLOWED_HOSTS: '203.1.113.0/24'};
  const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 1\r\n\r\nX']);
  const response = await server.relay.fetch(request({url: 'http://203.1.113.9/live/1'}), configured);
  assert.equal(await response.text(), 'X');
  assert.deepEqual(server.addresses, [{hostname: '203.1.113.9', port: 80}]);
  for (const url of [stream, 'http://203.1.113.255/live/1', 'http://127.0.0.1/live/1']) {
    const blocked = socketServer([]);
    assert.equal((await blocked.relay.fetch(request({url}), configured)).status, 400, url);
    assert.equal(blocked.addresses.length, 0);
  }
  for (const value of ['192.168.0.0/24', 'not-an-address', '136.148.65.0/24,10.0.0.1']) {
    const misconfigured = socketServer([]);
    const failed = await misconfigured.relay.fetch(request(), {...env, STREAM_RELAY_ALLOWED_HOSTS: value});
    assert.equal(failed.status, 503, value);
    assert.deepEqual(await failed.json(), {error: 'relay_not_configured'});
    assert.equal(misconfigured.addresses.length, 0);
    assert.equal((await misconfigured.relay.fetch(request(undefined, {authorization: 'Bearer wrong'}), {...env, STREAM_RELAY_ALLOWED_HOSTS: value})).status, 401);
  }
});

test('the optional rate limiter is keyed on a key digest, returns 429 before connecting and is skipped when absent or failing', async () => {
  const keys: string[] = [];
  let allow = true;
  const limiter = {limit: async ({key}: {key: string}) => {keys.push(key); return {success: allow};}};
  const server = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 1\r\n\r\nX']);
  assert.equal(await (await server.relay.fetch(request(), {...env, RELAY_LIMITER: limiter})).text(), 'X');
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^relay:[a-f0-9]{32}$/);
  assert.ok(!keys[0].includes(key));
  allow = false;
  const limited = socketServer([]);
  const response = await limited.relay.fetch(request(), {...env, RELAY_LIMITER: limiter});
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(await response.json(), {error: 'relay_rate_limited'});
  assert.equal(limited.addresses.length, 0);
  assert.equal(keys[1], keys[0]);
  assert.equal((await limited.relay.fetch(request(undefined, {authorization: 'Bearer wrong'}), {...env, RELAY_LIMITER: limiter})).status, 401);
  assert.equal(keys.length, 2);
  for (const binding of [undefined, {}, {limit: async () => {throw new Error('unavailable');}}]) {
    const open = socketServer(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 1\r\n\r\nX']);
    assert.equal(await (await open.relay.fetch(request(), {...env, RELAY_LIMITER: binding})).text(), 'X');
  }
});

test('the decoded body path fails a stalled upstream after the idle timeout but not a paused downstream', {timeout: 3000}, async () => {
  const stalled = socketServer(['HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nABC\r\n'], {stall: true, idleTimeout: 40, idleCheck: 5});
  const response = await stalled.relay.fetch(request(), env);
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'ABC');
  await assert.rejects(reader.read(), {message: 'The stream connection is unavailable.'});
  assert.equal(stalled.closes, 1);
  assert.equal(stalled.readable.locked, false);

  const paused = socketServer(['HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\n\r\n', '3\r\nABC\r\n', '0\r\n\r\n'], {idleTimeout: 40, idleCheck: 5});
  const slow = await paused.relay.fetch(request(), env);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(paused.closes, 0);
  assert.equal(await slow.text(), 'ABC');
  assert.equal(paused.closes, 1);
});
