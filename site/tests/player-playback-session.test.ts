import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackSession} from '../lib/player-playback-session.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
class TestVideo extends EventTarget {
  play = () => Promise.resolve();
}
function deferred() {
  let reject!: (cause: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}
function setup(options: {video?: TestVideo; current?: () => boolean; finished?: string; stop?: () => void} = {}) {
  const video = options.video || new TestVideo();
  const statuses: string[] = [], errors: string[] = [];
  const session = createPlaybackSession(video as unknown as HTMLVideoElement, {
    status: message => statuses.push(message), error: message => errors.push(message),
    current: options.current || (() => true), finished: options.finished || 'Stream ended', stop: options.stop
  });
  const emit = (name: string) => video.dispatchEvent(new Event(name));
  return {video, statuses, errors, session, emit};
}

test('native playback events update only the current playback session', () => {
  const result = setup();
  for (const name of ['playing', 'waiting', 'pause', 'ended']) result.emit(name);
  assert.deepEqual(result.statuses, ['Playing', 'Buffering…', 'Paused', 'Stream ended']);
  assert.deepEqual(result.errors, ['']);
  const file = setup({finished: 'Finished'});
  file.emit('ended');
  assert.deepEqual(file.statuses, ['Finished']);
});

test('changing the current generation ignores native events and new play requests', () => {
  let current = true, plays = 0;
  const result = setup({current: () => current});
  result.video.play = () => {plays++; return Promise.resolve();};
  assert.equal(result.session.isCurrent(), true);
  current = false;
  assert.equal(result.session.isCurrent(), false);
  for (const name of ['playing', 'waiting', 'pause', 'ended', 'error']) result.emit(name);
  result.session.play();
  result.session.fail('Outdated failure');
  assert.equal(plays, 0);
  assert.deepEqual(result.statuses, []);
  assert.deepEqual(result.errors, []);
});

test('queued events from the previous video cannot overwrite the new channel', async () => {
  const old = setup(), next = setup();
  queueMicrotask(() => {for (const event of ['pause', 'ended', 'error', 'playing']) old.emit(event);});
  old.session.dispose([]);
  next.emit('playing');
  await tick();
  assert.equal(old.session.isCurrent(), false);
  assert.deepEqual(old.statuses, []);
  assert.deepEqual(old.errors, []);
  assert.deepEqual(next.statuses, ['Playing']);
  assert.deepEqual(next.errors, ['']);
});

test('a rejected play promise from a disposed session cannot change playback state', async () => {
  const pending = deferred();
  const old = setup(), next = setup();
  old.video.play = () => pending.promise;
  old.session.play();
  old.session.dispose([]);
  next.emit('playing');
  pending.reject(new DOMException('Private previous playback context', 'NotAllowedError'));
  await tick();
  assert.deepEqual(old.statuses, []);
  assert.deepEqual(old.errors, []);
  assert.deepEqual(next.statuses, ['Playing']);
});

test('dispose invalidates first and tries every cleanup even when teardown throws', () => {
  const result = setup();
  const cleaned: number[] = [];
  result.session.dispose([
    () => {cleaned.push(1); assert.equal(result.session.isCurrent(), false); result.emit('error'); throw new Error('Teardown failed');},
    () => {cleaned.push(2); result.session.fail('Late teardown failure'); throw new Error('Another teardown failed');},
    () => {cleaned.push(3); result.emit('pause');}
  ]);
  result.session.dispose([() => cleaned.push(4)]);
  assert.deepEqual(cleaned, [1, 2, 3]);
  assert.deepEqual(result.statuses, []);
  assert.deepEqual(result.errors, []);
});

test('a failure stays visible despite queued play rejection or native media events', async () => {
  const pending = deferred();
  const result = setup();
  result.video.play = () => pending.promise;
  result.session.play();
  result.session.fail('This channel could not be reached.');
  pending.reject(new DOMException('Autoplay prevented', 'NotAllowedError'));
  for (const event of ['playing', 'waiting', 'pause', 'ended', 'error']) result.emit(event);
  result.session.fail('Another error');
  await tick();
  assert.deepEqual(result.errors, ['This channel could not be reached.']);
  assert.deepEqual(result.statuses, ['Playback unavailable']);
});

test('only autoplay permission errors offer a manual play action', async () => {
  for (const synchronous of [false, true]) {
    const result = setup();
    result.video.play = () => {
      const error = new DOMException('Private autoplay context', 'NotAllowedError');
      if (synchronous) throw error;
      return Promise.reject(error);
    };
    result.session.play();
    await tick();
    assert.deepEqual(result.statuses, ['Press play to start']);
    assert.deepEqual(result.errors, []);
    result.emit('playing');
    assert.deepEqual(result.statuses, ['Press play to start', 'Playing']);
  }
});

test('aborted play requests remain silent and other errors become a safe playback failure', async () => {
  for (const name of ['AbortError', 'NotSupportedError', 'NetworkError']) {
    for (const synchronous of [false, true]) {
      const result = setup();
      result.video.play = () => {
        const error = new DOMException('Private provider address', name);
        if (synchronous) throw error;
        return Promise.reject(error);
      };
      result.session.play();
      await tick();
      assert.deepEqual(result.statuses, name === 'AbortError' ? [] : ['Playback unavailable']);
      assert.deepEqual(result.errors, name === 'AbortError' ? [] : ['Playback could not start. Try this channel again.']);
    }
  }
});

test('native media errors use safe copy and latch against subsequent playing events', () => {
  const result = setup();
  result.emit('error');
  result.emit('playing');
  assert.deepEqual(result.statuses, ['Playback unavailable']);
  assert.deepEqual(result.errors, ['This stream is unavailable or uses a format your browser cannot play. Choose another channel or try again.']);
});

test('a fatal error stops network once and safely absorbs stop errors and queued play rejections', async () => {
  const pending = deferred();
  let stopped = 0;
  const result = setup({stop: () => {stopped++; throw new Error('Stop failed');}});
  result.video.play = () => pending.promise;
  result.session.play();
  assert.doesNotThrow(() => result.emit('error'));
  pending.reject(new DOMException('Queued play failure', 'NotSupportedError'));
  result.emit('error');
  result.session.fail('Another error');
  await tick();
  assert.equal(stopped, 1);
  assert.deepEqual(result.statuses, ['Playback unavailable']);
  assert.equal(result.errors.length, 1);
});

test('a rejected play request stops the network before any later media error', async () => {
  let stopped = 0;
  const result = setup({stop: () => {stopped++;}});
  result.video.play = () => Promise.reject(new DOMException('Unsupported media', 'NotSupportedError'));
  result.session.play();
  await tick();
  assert.equal(stopped, 1);
  result.emit('error');
  assert.equal(stopped, 1);
  assert.deepEqual(result.statuses, ['Playback unavailable']);
});
