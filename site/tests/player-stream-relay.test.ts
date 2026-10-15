import test from 'node:test';
import assert from 'node:assert/strict';
import {relayPlayerStream} from '../lib/player-stream-relay.ts';

test('cancelling a stalled relay aborts the network before cancelling its pending reader', {timeout: 3000}, async () => {
  const network = new AbortController();
  const events: string[] = [];
  let began!: () => void;
  const started = new Promise<void>(resolve => {began = resolve;});
  network.signal.addEventListener('abort', () => {events.push('abort');});
  const upstream = new ReadableStream<Uint8Array>({
    pull() {began(); return new Promise<void>(() => {});},
    cancel(reason) {events.push('cancel:' + reason);},
  }, {highWaterMark: 0});
  const reader = relayPlayerStream(upstream, network)!.getReader();
  const pending = reader.read();
  await started;
  await reader.cancel('channel changed');
  assert.deepEqual(await pending, {value: undefined, done: true});
  assert.deepEqual(events, ['abort', 'cancel:channel changed']);
  assert.equal(upstream.locked, false);
  await reader.cancel('again');
  assert.deepEqual(events, ['abort', 'cancel:channel changed']);
});

test('the relay forwards chunks on demand and releases the upstream reader on normal EOF', async () => {
  const network = new AbortController();
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
  let reads = 0, cancellations = 0;
  const upstream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[reads++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {cancellations++;},
  }, {highWaterMark: 0});
  const relay = relayPlayerStream(upstream, network)!;
  await Promise.resolve();
  assert.equal(reads, 0);
  const reader = relay.getReader();
  assert.equal((await reader.read()).value, chunks[0]);
  assert.equal(reads, 1);
  assert.equal((await reader.read()).value, chunks[1]);
  assert.equal(reads, 2);
  assert.equal((await reader.read()).done, true);
  assert.equal(upstream.locked, false);
  assert.equal(network.signal.aborted, false);
  assert.equal(cancellations, 0);
  await reader.cancel();
  assert.equal(network.signal.aborted, false);
});

test('upstream failure aborts its request, releases the lock and hides private upstream errors', async () => {
  const network = new AbortController();
  let aborts = 0;
  network.signal.addEventListener('abort', () => {aborts++;});
  const upstream = new ReadableStream<Uint8Array>({
    pull(controller) {controller.error(new Error('https://provider.invalid/live/private-user/private-password'));},
  }, {highWaterMark: 0});
  const reader = relayPlayerStream(upstream, network)!.getReader();
  await assert.rejects(reader.read(), error => error instanceof Error && error.message === 'Stream connection interrupted.');
  assert.equal(aborts, 1);
  assert.equal(upstream.locked, false);
});

test('downstream cancellation absorbs upstream cancellation failures and releases its lock', async () => {
  const network = new AbortController();
  let cancellations = 0;
  const upstream = new ReadableStream<Uint8Array>({
    cancel() {cancellations++; throw new Error('private upstream cancellation failure');},
  }, {highWaterMark: 0});
  const relay = relayPlayerStream(upstream, network)!;
  await assert.doesNotReject(relay.cancel('stop'));
  assert.equal(network.signal.aborted, true);
  assert.equal(cancellations, 1);
  assert.equal(upstream.locked, false);
});

test('an upstream abort racing a pending body read does not reject downstream cancellation', {timeout: 3000}, async () => {
  const network = new AbortController();
  let began!: () => void;
  const started = new Promise<void>(resolve => {began = resolve;});
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {network.signal.addEventListener('abort', () => {controller.error(new Error('private aborted stream'));});},
    pull() {began(); return new Promise<void>(() => {});},
  }, {highWaterMark: 0});
  const reader = relayPlayerStream(upstream, network)!.getReader();
  const pending = reader.read();
  await started;
  await assert.doesNotReject(reader.cancel('next channel'));
  assert.deepEqual(await pending, {value: undefined, done: true});
  assert.equal(upstream.locked, false);
});

test('an absent upstream body remains absent', () => {
  const network = new AbortController();
  assert.equal(relayPlayerStream(null, network), null);
  assert.equal(network.signal.aborted, false);
});
