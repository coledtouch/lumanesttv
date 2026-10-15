import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleDiagnosticContainer} from '../lib/player-diagnostic-container.ts';

test('diagnostic signatures classify split chunks and immediately cancel without returning bytes', async () => {
  const ts = new Array(188 * 3).fill(0);
  for (const offset of [0, 188, 376]) {ts[offset] = 0x47; ts[offset + 3] = 0x10;}
  for (const [expected, value] of [
    ['mp4', [0, 0, 0, 24, 102, 116, 121, 112]],
    ['mpegts', ts],
    ['flv', [70, 76, 86, 1, 5, 0, 0, 0, 9]],
    ['hls', Array.from(new TextEncoder().encode(' \n#EXTM3U'))],
  ] as const) {
    let read = 0, cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {controller.enqueue(new Uint8Array([value[read++ % value.length]]));},
      cancel() {cancelled++;},
    }, {highWaterMark: 0});
    assert.equal(await sampleDiagnosticContainer(body, new AbortController().signal), expected);
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
    assert.ok(read <= value.length);
  }
});

test('an unknown stream samples at most 1024 bytes using bounded BYOB requests, then cancels', async () => {
  let delivered = 0, cancelled = 0;
  const requested: number[] = [];
  const body = new ReadableStream<Uint8Array>({
    type: 'bytes',
    pull(controller) {
      assert.ok('byobRequest' in controller);
      const view = controller.byobRequest!.view!;
      requested.push(view.byteLength);
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).fill(0);
      const count = Math.min(7, view.byteLength);
      delivered += count;
      controller.byobRequest!.respond(count);
    },
    cancel() {cancelled++;},
  }, {highWaterMark: 0});
  assert.equal(await sampleDiagnosticContainer(body, new AbortController().signal), 'unknown');
  assert.equal(delivered, 1024);
  assert.equal(requested[0], 1024);
  assert.equal(requested.at(-1), 2);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('large default chunks only inspect the first 1024 bytes and stop reading', async () => {
  let read = 0, cancelled = 0;
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('#EXTM3U'), 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {read++; controller.enqueue(bytes);},
    cancel() {cancelled++;},
  }, {highWaterMark: 0});
  assert.equal(await sampleDiagnosticContainer(body, new AbortController().signal), 'unknown');
  assert.equal(read, 1);
  assert.equal(cancelled, 1);
});

test('TS sync detection supports 188, 192, and 204 byte packets with bounded leading offsets', async () => {
  for (const size of [188, 192, 204]) {
    for (const offset of [0, 4, 187]) {
      const bytes = new Uint8Array(1024);
      for (const index of [offset, offset + size, offset + 2 * size]) {bytes[index] = 0x47; bytes[index + 3] = 0x10;}
      assert.equal(await sampleDiagnosticContainer(new Response(bytes).body, new AbortController().signal), 'mpegts');
    }
  }
  const tooFar = new Uint8Array(1024);
  for (const index of [188, 376, 564]) {tooFar[index] = 0x47; tooFar[index + 3] = 0x10;}
  assert.equal(await sampleDiagnosticContainer(new Response(tooFar).body, new AbortController().signal), 'unknown');
});

test('short legacy TS responses classify only at EOF while arbitrary single sync bytes do not', async () => {
  assert.equal(await sampleDiagnosticContainer(new Response(new Uint8Array([0x47, 0x40, 0, 0x10])).body, new AbortController().signal), 'mpegts');
  const noise = new Uint8Array(1024); noise.set([0x47, 0x40, 0, 0x10]);
  assert.equal(await sampleDiagnosticContainer(new Response(noise).body, new AbortController().signal), 'unknown');
});

test('diagnostics distinguish empty, text responses, WebM, and MPEG-PS using only safe enums', async () => {
  const samples: [string, Uint8Array][] = [
    ['empty', new Uint8Array()],
    ['html', new TextEncoder().encode('<!DOCTYPE html><html><body>private provider text</body></html>')],
    ['json-like', new TextEncoder().encode('{"error":"private provider error","private_url":"https://private.example/secret"}')],
    ['text-like', new TextEncoder().encode('Private provider placeholder text')],
    ['webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])],
    ['mpegps', new Uint8Array([0, 0, 1, 0xba, 0x44, 0, 0, 0])]
  ];
  for (const [expected, bytes] of samples) {
    const result = await sampleDiagnosticContainer(new Response(new Uint8Array(bytes)).body, new AbortController().signal);
    assert.equal(result, expected);
    assert.equal(typeof result, 'string');
    assert.doesNotMatch(result, /private|secret|https/);
  }
  assert.equal(await sampleDiagnosticContainer(null, new AbortController().signal), 'empty');
});

test('the diagnostic deadline cancels a stalled read and releases its lock', {timeout: 3000}, async () => {
  const deadline = new AbortController();
  let began!: () => void;
  const started = new Promise<void>(resolve => {began = resolve;});
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() {began(); return new Promise<void>(() => {});},
    cancel() {cancelled++;},
  }, {highWaterMark: 0});
  const result = sampleDiagnosticContainer(body, deadline.signal);
  const rejected = assert.rejects(result, {name: 'AbortError'});
  await started;
  deadline.abort();
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});
