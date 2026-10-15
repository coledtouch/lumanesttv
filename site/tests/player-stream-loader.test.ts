import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerStreamLoader} from '../lib/player-stream-loader.ts';

const origin = 'https://lumanest.tv';
const source = '/api/player/stream?token=sealed-test-token';
const dataSource = {url: source, duration: 0, filesize: 0};
const fullRange = {from: 0, to: -1};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
function setup(fetcher: typeof fetch, options: {origin?: string; seekURL?: string; playbackSignal?: AbortSignal; onFormat?: (format: 'file' | 'hls') => void} = {}) {
  const Loader = createPlayerStreamLoader(options.origin || origin, options.playbackSignal, fetcher, options.onFormat);
  const loader = new Loader({
    getConfig(url, range) {return {url: options.seekURL || url, headers: range.from || range.to !== -1 ? {Range: 'bytes=' + range.from + '-' + (range.to === -1 ? '' : range.to)} : {}};},
    removeURLParameters(url) {return url;}
  }, {});
  const chunks: {data: number[]; start: number; received: number | undefined}[] = [];
  const errors: {kind: string; code: number; message: string}[] = [];
  const complete: [number, number][] = [];
  const lengths: number[] = [];
  loader.onContentLengthKnown = length => lengths.push(length);
  loader.onDataArrival = (data, start, received) => chunks.push({data: Array.from(new Uint8Array(data)), start, received});
  loader.onError = (kind, info) => errors.push({kind: String(kind), code: info.code, message: info.msg});
  loader.onComplete = (from, to) => complete.push([from, to]);
  return {loader, chunks, errors, complete, lengths};
}

test('aborting a buffered live stream immediately cancels a stalled read and its request', async () => {
  let canceled = 0;
  let signal: AbortSignal | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {controller.enqueue(new Uint8Array([1, 2, 3]));},
    pull() {return new Promise(() => {});},
    cancel() {canceled++;}
  });
  const result = setup(async (_url, init) => {signal = init?.signal || undefined; return new Response(body);});
  result.loader.open(dataSource, fullRange);
  await tick();
  assert.equal(result.chunks.length, 1);
  assert.equal(result.loader.status, 2);
  result.loader.abort();
  assert.equal(signal?.aborted, true);
  assert.equal(canceled, 1);
  assert.equal(result.loader.status, 0);
  assert.equal(result.loader.isWorking(), false);
  await tick();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.complete, []);
  assert.equal(result.chunks.length, 1);
});

test('reopening a loader rejects a late previous response without changing the new stream', async () => {
  const first = deferred<Response>();
  let requests = 0, lateCanceled = 0;
  const result = setup(async () => ++requests === 1 ? first.promise : new Response(new Uint8Array([9, 8])));
  result.loader.open(dataSource, fullRange);
  result.loader.open(dataSource, {from: 20, to: -1});
  await tick();
  assert.deepEqual(result.chunks, [{data: [9, 8], start: 20, received: 2}]);
  assert.deepEqual(result.complete, [[20, 21]]);
  first.resolve(new Response(new ReadableStream({cancel() {lateCanceled++;}})));
  await tick();
  assert.equal(lateCanceled, 1);
  assert.equal(result.chunks.length, 1);
  assert.deepEqual(result.complete, [[20, 21]]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.loader.status, 4);
});

test('destroy cancels a pending request and ignores late responses and subsequent opens', async () => {
  const pending = deferred<Response>();
  let requests = 0, canceled = 0;
  let signal: AbortSignal | undefined;
  const result = setup(async (_url, init) => {requests++; signal = init?.signal || undefined; return pending.promise;});
  result.loader.open(dataSource, fullRange);
  result.loader.destroy();
  assert.equal(signal?.aborted, true);
  result.loader.open(dataSource, fullRange);
  pending.resolve(new Response(new ReadableStream({cancel() {canceled++;}})));
  await tick();
  assert.equal(requests, 1);
  assert.equal(canceled, 1);
  assert.deepEqual(result.chunks, []);
  assert.deepEqual(result.complete, []);
  assert.deepEqual(result.errors, []);
});

test('the playback signal closes all stream connections independently of engine teardown', async () => {
  const playback = new AbortController();
  let canceled = 0, requests = 0;
  const signals: AbortSignal[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests++;
    signals.push(init!.signal!);
    return new Response(new ReadableStream({
      start(controller) {controller.enqueue(new Uint8Array([1]));},
      pull() {return new Promise(() => {});},
      cancel() {canceled++;}
    }));
  };
  const first = setup(fetcher, {playbackSignal: playback.signal});
  const second = setup(fetcher, {playbackSignal: playback.signal});
  first.loader.open(dataSource, fullRange);
  second.loader.open(dataSource, fullRange);
  await tick();
  playback.abort();
  assert.equal(canceled, 2);
  assert.ok(signals.every(signal => signal.aborted));
  first.loader.open(dataSource, fullRange);
  second.loader.open(dataSource, fullRange);
  await tick();
  assert.equal(requests, 2);
  for (const result of [first, second]) {
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.complete, []);
    assert.equal(result.chunks.length, 1);
  }
});

test('stream requests preserve byte ranges and send only safe same-origin fetch options', async () => {
  let calledURL = '', options: RequestInit | undefined;
  const result = setup(async (url, init) => {calledURL = String(url); options = init; return new Response(new Uint8Array([1, 2, 3]), {status: 206, headers: {'Content-Length': '3'}});});
  result.loader.open(dataSource, {from: 100, to: 102});
  await tick();
  assert.equal(calledURL, origin + source);
  assert.equal(new Headers(options?.headers).get('Range'), 'bytes=100-102');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(options?.mode, 'same-origin');
  assert.equal(options?.cache, 'no-store');
  assert.equal(options?.referrerPolicy, 'no-referrer');
  assert.equal(options?.redirect, 'error');
  assert.deepEqual(result.lengths, [3]);
  assert.deepEqual(result.chunks, [{data: [1, 2, 3], start: 100, received: 3}]);
  assert.deepEqual(result.complete, [[100, 102]]);
});

test('chunk callbacks contain exact view bytes with monotonically increasing offsets', async () => {
  const bytes = new Uint8Array([99, 1, 2, 98]);
  const result = setup(async () => new Response(new ReadableStream({start(controller) {
    controller.enqueue(bytes.subarray(1, 3)); controller.enqueue(new Uint8Array([3, 4, 5])); controller.close();
  }}), {headers: {'Content-Length': '5'}}));
  result.loader.open(dataSource, {from: 15, to: -1});
  await tick();
  assert.deepEqual(result.chunks, [{data: [1, 2], start: 15, received: 2}, {data: [3, 4, 5], start: 17, received: 5}]);
  assert.deepEqual(result.complete, [[15, 19]]);
});

test('HTTP failures release the response and report its status without leaking its body', async () => {
  let canceled = 0;
  const result = setup(async () => new Response(new ReadableStream({cancel() {canceled++;}}), {status: 403}));
  result.loader.open(dataSource, fullRange);
  await tick();
  assert.equal(canceled, 1);
  assert.deepEqual(result.errors, [{kind: 'HttpStatusCodeInvalid', code: 403, message: 'The stream returned HTTP 403.'}]);
  assert.deepEqual(result.chunks, []);
  assert.deepEqual(result.complete, []);
  assert.equal(result.loader.status, 3);
});

test('fetch and body failures report a sanitized error and cancel the connection', async () => {
  for (const bodyFailure of [false, true]) {
    let signal: AbortSignal | undefined;
    const result = setup(async (_url, init) => {
      signal = init?.signal || undefined;
      if (!bodyFailure) throw new Error('private-provider-path/password');
      return new Response(new ReadableStream({start(controller) {controller.error(new Error('private-provider-path/password'));}}));
    });
    result.loader.open(dataSource, fullRange);
    await tick();
    assert.equal(signal?.aborted, true);
    assert.deepEqual(result.errors, [{kind: 'Exception', code: -1, message: 'The stream connection was interrupted. Try this channel again.'}]);
    assert.deepEqual(result.complete, []);
  }
});

test('truncated finite responses report early EOF rather than a successful completion', async () => {
  const result = setup(async () => new Response(new Uint8Array([1, 2]), {headers: {'Content-Length': '5'}}));
  result.loader.open(dataSource, fullRange);
  await tick();
  assert.deepEqual(result.errors, [{kind: 'EarlyEof', code: -1, message: 'The stream ended before its response was complete.'}]);
  assert.deepEqual(result.complete, []);
});

test('HTTP, cross-origin, unsealed and altered seek destinations cannot reach the network', async () => {
  const forbidden = ['http://lumanest.tv' + source, 'https://other.example' + source, '/api/player/stream', '/api/player/channels?token=sealed', source + '&extra=private', source + '#private', 'https://user:password@lumanest.tv' + source];
  let calls = 0;
  for (const url of forbidden) {
    const result = setup(async () => {calls++; return new Response();});
    result.loader.open({...dataSource, url}, fullRange);
    await tick();
    assert.equal(result.errors.length, 1, url);
  }
  const altered = setup(async () => {calls++; return new Response();}, {seekURL: 'https://other.example' + source});
  altered.loader.open(dataSource, fullRange);
  const insecure = setup(async () => {calls++; return new Response();}, {origin: 'http://lumanest.tv'});
  insecure.loader.open(dataSource, fullRange);
  await tick();
  assert.equal(altered.errors.length, 1);
  assert.equal(insecure.errors.length, 1);
  assert.equal(calls, 0);
});

test('redirected responses are canceled even if a fetch implementation ignores redirect:error', async () => {
  for (const redirectedURL of ['https://other.example/private', origin + '/api/player/stream?token=changed']) {
    let canceled = 0;
    const response = new Response(new ReadableStream({cancel() {canceled++;}}));
    Object.defineProperties(response, {url: {value: redirectedURL}, redirected: {value: true}});
    const result = setup(async () => response);
    result.loader.open(dataSource, fullRange);
    await tick();
    assert.equal(canceled, 1);
    assert.deepEqual(result.errors, [{kind: 'Exception', code: -1, message: 'The player stream returned an unexpected redirect.'}]);
    assert.deepEqual(result.chunks, []);
  }
});

test('split MP4 and HLS signatures switch format only after canceling the old connection', async () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const hls = new TextEncoder().encode('#EXTM3U\n#EXT-X-VERSION:3\n');
  for (const [bytes, expected] of [[mp4, 'file'], [hls, 'hls']] as const) {
    let canceled = false;
    let signal: AbortSignal | undefined;
    const formats: string[] = [];
    const result = setup(async (_url, init) => {
      signal = init?.signal || undefined;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 3));
          controller.enqueue(bytes.subarray(3, 6));
          controller.enqueue(bytes.subarray(6));
        },
        pull() {return new Promise(() => {});},
        cancel() {canceled = true;}
      }), {headers: {'Content-Type': 'video/mp2t'}});
    }, {onFormat: format => {assert.equal(signal?.aborted, true); assert.equal(canceled, true); formats.push(format);}});
    result.loader.open(dataSource, fullRange);
    await tick();
    assert.deepEqual(formats, [expected]);
    assert.deepEqual(result.chunks, []);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.complete, []);
  }
});

test('MPEG-TS bytes retain exact data and offsets even when the MIME claims MP4', async () => {
  const bytes = new Uint8Array(752).fill(0x47);
  const formats: string[] = [];
  const result = setup(async () => new Response(new ReadableStream({start(controller) {
    controller.enqueue(bytes.subarray(0, 100));
    controller.enqueue(bytes.subarray(100, 376));
    controller.enqueue(bytes.subarray(376));
    controller.close();
  }}), {headers: {'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length)}}), {onFormat: format => formats.push(format)});
  result.loader.open(dataSource, {from: 12, to: -1});
  await tick();
  assert.deepEqual(formats, []);
  assert.deepEqual(result.chunks.map(chunk => [chunk.start, chunk.received, chunk.data.length]), [[12, 100, 100], [112, 376, 276], [388, 752, 376]]);
  assert.deepEqual(result.complete, [[12, 763]]);
  assert.deepEqual(result.errors, []);
});

test('short unknown responses flush their prefix and format sniffing stays optional', async () => {
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  const unchanged = setup(async () => new Response(bytes));
  unchanged.loader.open(dataSource, fullRange);
  const short = setup(async () => new Response(new Uint8Array([1, 2, 3])), {onFormat: () => assert.fail('Unknown bytes must not switch format')});
  short.loader.open(dataSource, fullRange);
  await tick();
  assert.deepEqual(unchanged.chunks, [{data: Array.from(bytes), start: 0, received: 8}]);
  assert.deepEqual(unchanged.complete, [[0, 7]]);
  assert.deepEqual(short.chunks, [{data: [1, 2, 3], start: 0, received: 3}]);
  assert.deepEqual(short.complete, [[0, 2]]);
});
