'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/player.js'), 'utf8');

function timers() {
  let now = 0, next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, delay) { const id = next++; pending.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        let earliest = null;
        for (const entry of pending) {
          if (entry[1].at <= end && (!earliest || entry[1].at < earliest[1].at)) { earliest = entry; }
        }
        if (!earliest) { break; }
        now = earliest[1].at; pending.delete(earliest[0]); earliest[1].fn();
      }
      now = end;
    },
    get size() { return pending.size; },
    get now() { return now; }
  };
}

function avplay(audioGroup) {
  const calls = [], prepares = [], seeks = [], restores = [];
  let state = 'NONE', listener = {}, currentTime = 0, duration = 90000, busy = '', saved = null;
  const tracks = [
    { type: 'AUDIO', index: 2, extra_info: '{"track_lang":"spa","track_name":"Spanish"}' },
    { type: 'AUDIO', index: 7, extra_info: '{"track_lang":"und"}' },
    { type: 'TEXT', index: 11, extra_info: '{"track_lang":"fra"}' }
  ];
  function legal(method, states) {
    assert.equal(busy, '', method + ' must wait for the async callback');
    assert.ok(states.includes(state), method + ' not legal in ' + state);
    calls.push([method]);
  }
  const av = {
    calls, prepares, seeks, restores,
    getState() { return state; },
    open(url) { legal('open', ['NONE', 'IDLE']); state = 'IDLE'; currentTime = 0; av.audioEnabled = true; calls.at(-1).push(url); },
    close() { calls.push(['close']); state = 'NONE'; busy = ''; },
    setListener(value) { legal('setListener', ['IDLE']); listener = value; },
    setDisplayRect(...args) { legal('setDisplayRect', ['IDLE', 'READY', 'PLAYING', 'PAUSED']); calls.at(-1).push(...args); },
    setDisplayMethod(value) { legal('setDisplayMethod', ['IDLE', 'READY', 'PLAYING', 'PAUSED']); calls.at(-1).push(value); },
    setTimeoutForBuffering(seconds) { legal('setTimeoutForBuffering', ['IDLE']); calls.at(-1).push(seconds); },
    setStreamingProperty(type, value) { legal('setStreamingProperty', ['IDLE']); calls.at(-1).push(type, value); },
    enableAudioStream() {
      legal('enableAudioStream', ['IDLE', 'READY', 'PLAYING', 'PAUSED']);
      for (const other of audioGroup || []) {
        if (other !== av && other.getState() !== 'NONE') { other.audioEnabled = false; }
      }
      av.audioEnabled = true;
    },
    disableAudioStream() {
      legal('disableAudioStream', ['IDLE', 'READY', 'PLAYING', 'PAUSED']);
      if (audioGroup && av.audioEnabled === false && state !== 'IDLE') {
        throw { name: 'InvalidAccessError', message: 'PLAYER_ERROR_INVALID_OPERATION' };
      }
      av.audioEnabled = false;
    },
    prepareAsync(ok, error) {
      legal('prepareAsync', ['IDLE']); busy = 'prepare';
      prepares.push({ ok, error, listener, url: calls.filter(x => x[0] === 'open').at(-1)[1] });
    },
    completePrepare(index = prepares.length - 1) { busy = ''; state = 'READY'; prepares[index].ok(); },
    failPrepare(name = 'InvalidAccessError', index = prepares.length - 1) { busy = ''; prepares[index].error({ name }); },
    play() { legal('play', ['READY', 'PLAYING', 'PAUSED']); state = 'PLAYING'; },
    pause() { legal('pause', ['PLAYING', 'PAUSED']); state = 'PAUSED'; },
    getDuration() { legal('getDuration', ['READY', 'PLAYING', 'PAUSED']); return duration; },
    getCurrentTime() { legal('getCurrentTime', ['READY', 'PLAYING', 'PAUSED']); return currentTime; },
    seekTo(ms, ok, error) { legal('seekTo', ['READY', 'PLAYING', 'PAUSED']); calls.at(-1).push(ms); busy = 'seek'; seeks.push({ ms, ok, error }); },
    completeSeek() { busy = ''; currentTime = seeks.at(-1).ms; seeks.at(-1).ok(); },
    failSeek() { busy = ''; seeks.at(-1).error({ name: 'NotSupportedError' }); },
    getTotalTrackInfo() { legal('getTotalTrackInfo', ['READY', 'PLAYING', 'PAUSED']); return tracks; },
    getCurrentStreamInfo() { legal('getCurrentStreamInfo', ['READY', 'PLAYING', 'PAUSED']); return [{ type: 'AUDIO', index: 2 }]; },
    setSelectTrack(type, index) {
      legal('setSelectTrack', type === 'AUDIO' ? ['PLAYING'] : ['PLAYING', 'PAUSED']); calls.at(-1).push(type, index);
    },
    setSilentSubtitle(silent) { legal('setSilentSubtitle', ['PLAYING', 'PAUSED']); calls.at(-1).push(silent); },
    suspend() { legal('suspend', ['READY', 'PLAYING', 'PAUSED']); saved = state; state = 'NONE'; },
    restoreAsync(url, position, prepare, ok, error) {
      legal('restoreAsync', ['NONE', 'PLAYING', 'PAUSED']); calls.at(-1).push(url, position, prepare);
      busy = 'restore'; restores.push({ ok, error });
    },
    completeRestore() { busy = ''; state = saved; restores.at(-1).ok(); },
    failRestore() { busy = ''; restores.at(-1).error({ name: 'UnknownError' }); },
    event(name, ...args) { if (name === 'oncurrentplaytime') { currentTime = args[0]; } listener[name](...args); },
    set duration(value) { duration = value; },
    set clock(value) { currentTime = value; }
  };
  if (audioGroup) { audioGroup.push(av); }
  return av;
}

function htmlVideo() {
  const listeners = new Map();
  const video = {
    style: {}, src: '', currentTime: 0, duration: NaN, paused: true,
    audioTracks: [{ language: 'spa', enabled: true }, { language: '', enabled: false }],
    textTracks: [{ language: 'fra', mode: 'disabled' }],
    plays: 0, loads: 0,
    addEventListener(name, fn) { if (!listeners.has(name)) { listeners.set(name, new Set()); } listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name) { for (const fn of [...(listeners.get(name) || [])]) { fn(); } },
    play() {
      video.plays += 1;
      if (video.playError) { return Promise.reject(video.playError); }
      video.paused = false; video.dispatch('playing'); return Promise.resolve();
    },
    pause() { video.paused = true; video.dispatch('pause'); },
    load() { video.loads += 1; },
    removeAttribute(name) { if (name === 'src') { video.src = ''; } },
    listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); }
  };
  return video;
}

function harness(native = true) {
  const clock = timers(), av = native ? avplay() : null, video = htmlVideo();
  const object = { style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const states = [], errors = [], times = [];
  let ended = 0;
  const window = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: { now() { return clock.now; } } };
  if (av) { window.webapis = { avplay: av }; }
  vm.runInNewContext(source, { window }, { filename: 'player.js' });
  const player = window.TunerPlayer.create({ objectElement: object, videoElement: video,
    onState(value) { states.push(value); }, onTime(...args) { times.push(args); },
    onError(value) { errors.push(value); }, onEnded() { ended++; } });
  return { player, av, video, object, clock, states, errors, times, window, get ended() { return ended; } };
}

test('native prepare, display rectangle and metadata follow legal AVPlay ordering', () => {
  const h = harness();
  h.player.setRect({ left: 1280, top: 80, width: 600, height: 338 });
  h.player.play({ url: 'https://example.test/live.ts', live: true, title: 'Live TV' });
  assert.equal(h.player.state.status, 'loading');
  assert.equal(h.object.attributes.type, 'application/avplayer');
  assert.deepEqual(h.av.calls.find(x => x[0] === 'setDisplayRect'), ['setDisplayRect', 1280, 80, 600, 338]);
  h.av.completePrepare();
  assert.equal(h.player.state.status, 'playing');
  h.av.event('oncurrentplaytime', 1000);
  assert.equal(h.player.state.position, 1000);
  assert.equal(h.clock.size, 1, 'a low-frequency native progress monitor remains armed');
  assert.equal(h.player.tracks().audio[0].language, 'spa');
  assert.equal(h.player.tracks().audio.length, 2, 'unknown language is allowed');
  const opens = h.av.calls.filter(x => x[0] === 'open').length;
  h.player.setRect({ left: -3, top: 2000, width: 3000, height: 700 });
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'setDisplayRect').at(-1), ['setDisplayRect', 0, 1079, 1920, 1]);
  assert.equal(h.av.calls.filter(x => x[0] === 'open').length, opens, 'layout changes keep the stream');
});

test('superseded preparation and stopped callbacks cannot play or fail a newer request', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.ts', live: true });
  const old = h.av.prepares[0];
  h.player.play({ url: 'https://example.test/b.ts', live: true });
  const before = h.av.calls.length;
  old.ok(); old.error({ name: 'NotSupportedError' }); old.listener.onerror('PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(h.av.calls.length, before);
  assert.equal(h.player.state.request.url, 'https://example.test/b.ts');
  h.av.completePrepare();
  h.player.stop();
  const stopped = h.av.calls.length;
  h.av.prepares.at(-1).ok(); h.av.prepares.at(-1).listener.onstreamcompleted();
  assert.equal(h.av.calls.length, stopped);
  assert.equal(h.player.state.status, 'idle');
  assert.equal(h.clock.size, 0);
});

test('backup fallback deduplicates URLs and restores VOD position and pause intent', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4', backups: ['https://example.test/a.mp4', 'https://example.test/b.mp4'], live: false, startPosition: 15000 });
  h.av.completePrepare();
  assert.equal(h.av.seeks.at(-1).ms, 15000);
  assert.equal(h.av.calls.filter(x => x[0] === 'play').length, 0, 'wait for seek callback');
  h.av.completeSeek();
  h.av.event('oncurrentplaytime', 23000);
  h.player.pause();
  const failedListener = h.av.prepares[0].listener;
  failedListener.onerror('PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  failedListener.onerrormsg('PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'private source URL');
  assert.equal(h.av.prepares.length, 2, 'duplicate native error only falls back once');
  assert.equal(h.av.prepares[1].url, 'https://example.test/b.mp4');
  h.av.completePrepare();
  assert.equal(h.av.seeks.at(-1).ms, 23000);
  h.av.completeSeek();
  assert.equal(h.player.state.status, 'paused');
  assert.equal(h.av.getState(), 'PAUSED');
  assert.equal(h.errors.length, 0, 'successful fallback stays quiet');
});

test('hung preparation and rebuffering expire, while pause and suspension stop deadlines', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4', backups: ['https://example.test/b.mp4'] });
  h.clock.advance(30000);
  assert.equal(h.av.prepares.length, 2);
  h.player.pause();
  h.clock.advance(120000);
  assert.equal(h.player.state.status, 'paused');
  h.av.completePrepare();
  h.player.resume(); h.av.event('oncurrentplaytime', 1000);
  h.av.event('onbufferingstart');
  h.player.suspend();
  h.clock.advance(120000);
  assert.equal(h.errors.length, 0);
  h.player.restore(); h.av.completeRestore();
  h.av.event('onbufferingstart'); h.clock.advance(30000);
  assert.equal(h.player.state.status, 'error');
  assert.equal(h.av.getState(), 'NONE');
  assert.match(h.errors.at(-1), /too long/);
  assert.ok(!h.errors.at(-1).includes('example.test'), 'errors do not expose URLs');
});

test('repeated zero playback timestamps do not hide an initial stall', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4' }); h.av.completePrepare();
  h.av.event('oncurrentplaytime', 0); h.clock.advance(15000);
  h.av.event('oncurrentplaytime', 0); h.clock.advance(15000);
  assert.equal(h.player.state.status, 'error');
});

test('silent PLAYING stalls reopen once, then use backups without an infinite retry loop', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.ts', backups: ['https://example.test/b.ts'], live: true });
  h.av.completePrepare(); h.av.event('oncurrentplaytime', 60000);
  const oldListener = h.av.prepares[0].listener;
  h.clock.advance(35000);
  assert.equal(h.av.prepares.length, 2);
  assert.equal(h.av.prepares[1].url, 'https://example.test/a.ts', 'recover the currently chosen source once');
  assert.equal(h.player.state.status, 'loading');
  oldListener.onerror('PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(h.av.prepares.length, 2, 'retired callbacks cannot fail the recovery');
  h.av.completePrepare(); h.av.event('oncurrentplaytime', 1000); h.clock.advance(35000);
  assert.equal(h.av.prepares.length, 3);
  assert.equal(h.av.prepares[2].url, 'https://example.test/b.ts');
  h.av.completePrepare(); h.av.event('oncurrentplaytime', 1000); h.clock.advance(35000);
  assert.equal(h.player.state.status, 'error'); assert.equal(h.av.getState(), 'NONE');
  assert.equal(h.clock.size, 0);
  assert.match(h.errors.at(-1), /stopped responding/);
  assert.ok(!h.errors.at(-1).includes('example.test'));
  h.clock.advance(120000); assert.equal(h.av.prepares.length, 3);
});

test('readable advancing native clocks keep playback healthy when callbacks disappear', () => {
  const h = harness(); h.player.play({ url: 'https://example.test/live.ts', live: true }); h.av.completePrepare();
  for (let i = 1; i <= 20; i++) { h.av.clock = i * 5000; h.clock.advance(5000); }
  assert.equal(h.av.prepares.length, 1); assert.equal(h.player.state.status, 'playing');
  assert.equal(h.player.state.position, 100000); assert.deepEqual(h.times.at(-1), [100000, 90000]);
  assert.equal(h.errors.length, 0);
  h.player.stop(); assert.equal(h.clock.size, 0);
});

test('advancing callbacks remain valid when this SDK cannot read its playback clock', () => {
  const h = harness(); h.player.play({ url: 'https://example.test/live.ts', live: true }); h.av.completePrepare();
  h.av.getCurrentTime = () => { throw { name: 'NotSupportedError' }; };
  for (let i = 1; i <= 20; i++) { h.av.event('oncurrentplaytime', i * 5000); h.clock.advance(5000); }
  assert.equal(h.av.prepares.length, 1); assert.equal(h.player.state.status, 'playing');
  assert.equal(h.errors.length, 0);
});

test('native progress polling stops for deliberate pause, async seek, suspension and restore', () => {
  const h = harness(); h.player.play({ url: 'https://example.test/film.mp4' }); h.av.completePrepare(); h.av.event('oncurrentplaytime', 1000);
  h.player.pause(); const pausedReads = h.av.calls.filter(call => call[0] === 'getCurrentTime').length;
  h.clock.advance(120000); assert.equal(h.av.calls.filter(call => call[0] === 'getCurrentTime').length, pausedReads);
  assert.equal(h.clock.size, 0); assert.equal(h.av.prepares.length, 1);
  h.player.resume(); h.av.event('oncurrentplaytime', 2000); h.player.seekTo(20000);
  const seekingReads = h.av.calls.filter(call => call[0] === 'getCurrentTime').length;
  h.clock.advance(20000); assert.equal(h.av.calls.filter(call => call[0] === 'getCurrentTime').length, seekingReads);
  h.av.completeSeek(); h.av.event('oncurrentplaytime', 21000);
  h.player.suspend(); const suspendedReads = h.av.calls.filter(call => call[0] === 'getCurrentTime').length;
  h.clock.advance(120000); assert.equal(h.av.calls.filter(call => call[0] === 'getCurrentTime').length, suspendedReads);
  h.player.restore(); h.clock.advance(20000);
  assert.equal(h.av.calls.filter(call => call[0] === 'getCurrentTime').length, suspendedReads);
  h.av.completeRestore(); h.av.clock = 22000; h.clock.advance(5000);
  assert.equal(h.av.prepares.length, 1); assert.equal(h.errors.length, 0);
});

test('silent VOD recovery seeks to the saved position instead of restarting the movie', () => {
  const h = harness(); h.player.play({ url: 'https://example.test/film.mp4' }); h.av.completePrepare(); h.av.event('oncurrentplaytime', 23000);
  h.clock.advance(35000); assert.equal(h.av.prepares.length, 2);
  h.av.completePrepare(); assert.equal(h.av.seeks.at(-1).ms, 23000);
  h.av.completeSeek(); assert.equal(h.player.state.status, 'playing'); assert.equal(h.player.state.position, 23000);
});

test('seek coalesces remote repeats and delays pause and layout calls until completion', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4' }); h.av.completePrepare();
  h.player.seekTo(10000); h.player.seek(10000); h.player.seek(10000);
  h.player.pause(); h.player.setRect({ left: 100, top: 100, width: 700, height: 400 });
  assert.equal(h.av.seeks.length, 1);
  h.av.completeSeek();
  assert.equal(h.av.seeks.at(-1).ms, 30000);
  h.av.completeSeek();
  assert.equal(h.player.state.status, 'paused');
  assert.equal(h.av.getState(), 'PAUSED');
  h.player.seekTo(200000); assert.equal(h.av.seeks.at(-1).ms, 89750);
  h.av.failSeek();
  assert.equal(h.player.state.status, 'paused', 'failed seek does not discard playable video');
});

test('audio selection queues while paused and subtitles use native track indices', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4' }); h.av.completePrepare(); h.player.pause();
  assert.equal(h.player.selectTrack('audio', 7), true);
  assert.equal(h.av.calls.filter(x => x[0] === 'setSelectTrack').length, 0);
  h.player.resume();
  assert.deepEqual(h.av.calls.find(x => x[0] === 'setSelectTrack'), ['setSelectTrack', 'AUDIO', 7]);
  h.player.pause(); h.player.selectTrack('subtitles', 11); h.player.selectTrack('subtitles', -1);
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'setSilentSubtitle').at(-1), ['setSilentSubtitle', true]);
  assert.equal(h.player.selectTrack('audio', 500), false);
});

test('native suspend and async restore preserve deliberate pause and live restore omits position zero', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4' }); h.av.completePrepare();
  h.av.event('oncurrentplaytime', 19000); h.player.pause(); h.player.suspend();
  h.player.restore();
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'restoreAsync').at(-1), ['restoreAsync', null, 19000, false]);
  h.player.resume(); h.player.pause();
  h.av.completeRestore(); assert.equal(h.player.state.status, 'paused');
  h.player.play({ url: 'https://example.test/live.ts', live: true }); h.av.completePrepare();
  h.player.suspend(); h.player.restore();
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'restoreAsync').at(-1), ['restoreAsync', null, null, false]);
  h.av.completeRestore(); assert.equal(h.player.state.status, 'playing');
});

test('suspending an unfinished native prepare cancels it and reopens safely on return', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4', startPosition: 4000 });
  const pending = h.av.prepares[0]; h.player.suspend();
  pending.ok(); assert.equal(h.av.getState(), 'NONE');
  h.player.restore(); assert.equal(h.av.prepares.length, 2);
  h.av.completePrepare(); h.av.completeSeek();
  assert.equal(h.player.state.status, 'playing'); assert.equal(h.player.state.position, 4000);
});

test('torrent sources give a truthful capability error or use a direct HTTP backup', () => {
  const h = harness();
  h.player.play({ url: 'magnet:?xt=urn:btih:abc' });
  assert.equal(h.player.state.status, 'error'); assert.match(h.errors[0], /HTTP or debrid/);
  assert.equal(h.av.prepares.length, 0);
  h.player.play({ url: 'torrent:abc', backups: ['https://example.test/debrid.mp4'] });
  assert.equal(h.av.prepares.at(-1).url, 'https://example.test/debrid.mp4');
  h.av.completePrepare(); assert.equal(h.player.state.status, 'playing');
});

test('VOD completion fires once and Play replays, live completion is a source failure', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.mp4' }); h.av.completePrepare();
  h.av.event('onstreamcompleted');
  h.av.event('onstreamcompleted');
  assert.equal(h.ended, 1); assert.equal(h.player.state.status, 'paused');
  h.player.resume(); assert.equal(h.av.seeks.at(-1).ms, 0); h.av.completeSeek();
  assert.equal(h.player.state.status, 'playing');
  h.player.play({ url: 'https://example.test/live.ts', live: true }); h.av.completePrepare();
  h.av.event('onstreamcompleted'); assert.equal(h.player.state.status, 'error'); assert.equal(h.ended, 1);
});

test('only one native factory owns AVPlay and stopping another instance cannot close it', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.ts', live: true }); h.av.completePrepare();
  const other = h.window.TunerPlayer.create({ objectElement: { style: {} } });
  other.play({ url: 'https://example.test/b.ts', live: true });
  assert.equal(h.player.state.status, 'idle');
  const count = h.av.calls.filter(x => x[0] === 'close').length;
  h.player.stop(); assert.equal(h.av.calls.filter(x => x[0] === 'close').length, count);
  h.av.completePrepare(); assert.equal(other.state.status, 'playing');
});

test('browser fallback handles metadata, VOD backup, tracks, suspend and cleanup', async () => {
  const h = harness(false);
  h.player.play({ url: 'https://example.test/a.mp4', backups: ['https://example.test/b.mp4'], startPosition: 12000 });
  h.video.duration = 90; h.video.dispatch('loadedmetadata');
  assert.equal(h.video.currentTime, 12); assert.equal(h.player.state.status, 'playing');
  assert.equal(h.video.style.display, 'block'); assert.equal(h.object.style.display, 'none');
  h.video.currentTime = 24; h.video.dispatch('timeupdate'); h.video.dispatch('error');
  assert.equal(h.video.src, 'https://example.test/b.mp4');
  h.video.dispatch('loadedmetadata'); assert.equal(h.video.currentTime, 24);
  h.player.pause(); h.player.suspend(); h.player.restore(); assert.equal(h.video.paused, true);
  h.player.selectTrack('audio', 1); assert.equal(h.video.audioTracks[1].enabled, true);
  h.player.selectTrack('subtitles', 0); assert.equal(h.video.textTracks[0].mode, 'showing');
  h.player.selectTrack('subtitles', -1); assert.equal(h.video.textTracks[0].mode, 'disabled');
  h.player.stop(); assert.equal(h.video.listenerCount(), 0); assert.equal(h.video.src, '');
  await Promise.resolve(); assert.equal(h.player.state.status, 'idle');
});

test('browser autoplay rejection is recoverable by Play without exhausting backups', async () => {
  const h = harness(false);
  h.video.playError = { name: 'NotAllowedError' };
  h.player.play({ url: 'https://example.test/a.mp4', backups: ['https://example.test/b.mp4'] });
  h.video.duration = 90; h.video.dispatch('loadedmetadata'); await Promise.resolve();
  assert.equal(h.player.state.status, 'paused'); assert.equal(h.video.src, 'https://example.test/a.mp4');
  h.video.playError = null; h.player.resume(); await Promise.resolve();
  assert.equal(h.player.state.status, 'playing');
});

function dualHarness(version = '8.0') {
  const h = harness(), audioGroup = [], managers = [avplay(audioGroup), avplay(audioGroup)];
  let allocated = 0;
  h.window.tizen = { systeminfo: { getCapability() { return version; } } };
  h.window.webapis.avplaystore = { getPlayer() {
    assert.ok(allocated < 2, 'do not allocate beyond two pooled instances'); return managers[allocated++];
  } };
  const objects = [{ style: {}, setAttribute() {} }, { style: {}, setAttribute() {} }];
  const states = [], audioErrors = [];
  function makeDual() {
    return h.window.TunerPlayer.createDual({ objectElements: objects,
      onState(slot, state) { states.push({ slot, state }); },
      onError(slot, message) { audioErrors.push({ slot, message }); } });
  }
  return { ...h, managers, objects, states, audioErrors, makeDual, get allocated() { return allocated; } };
}

test('a silently frozen muted sub recovers alone while the healthy peer and audio stay unchanged', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/main.ts', live: true });
  dual.play(1, { url: 'https://example.test/sub.ts', live: true });
  h.managers.forEach(manager => manager.completePrepare());
  h.managers[0].event('oncurrentplaytime', 60000); h.managers[1].event('oncurrentplaytime', 60000);
  const healthyCloses = h.managers[0].calls.filter(call => call[0] === 'close').length;
  for (let i = 1; i <= 7; i++) { h.managers[0].clock = 60000 + i * 5000; h.clock.advance(5000); }
  assert.equal(h.managers[0].prepares.length, 1);
  assert.equal(h.managers[0].calls.filter(call => call[0] === 'close').length, healthyCloses);
  assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[0].getCurrentTime(), 95000);
  assert.equal(h.managers[1].prepares.length, 2); assert.equal(h.managers[1].prepares.at(-1).url, 'https://example.test/sub.ts');
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  h.managers[1].completePrepare(); h.managers[1].event('oncurrentplaytime', 1000);
  assert.equal(h.managers[1].getState(), 'PLAYING'); assert.equal(h.allocated, 2);
  assert.equal(h.av.getState(), 'NONE', 'ordinary playback stays closed');
  assert.equal(h.states.filter(entry => entry.state.status === 'error').length, 0);
  dual.stop(); assert.equal(h.clock.size, 0);
});

test('muted dual streams with missing callbacks stay healthy if native clocks still advance', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/main.ts', live: true }); dual.play(1, { url: 'https://example.test/sub.ts', live: true });
  h.managers.forEach(manager => manager.completePrepare());
  for (let i = 1; i <= 20; i++) {
    h.managers[0].clock = i * 5000; h.managers[1].clock = i * 5000;
    if (i === 6) dual.selectAudio(1); if (i === 12) dual.selectAudio(0);
    h.clock.advance(5000);
  }
  assert.deepEqual(h.managers.map(manager => manager.prepares.length), [1, 1]);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  assert.equal(h.states.filter(entry => entry.state.status === 'error').length, 0);
  assert.equal(h.allocated, 2);
});

test('native dual view prepares two independent main/sub players and changes audio without reconnecting', () => {
  const h = dualHarness(), dual = h.makeDual();
  assert.equal(dual.capability.supported, true); assert.equal(dual.capability.native, true);
  dual.setRects([{ left: 50, top: 170, width: 892, height: 502 }, { left: 980, top: 170, width: 892, height: 502 }]);
  h.player.play({ url: 'https://example.test/old.ts', live: true }); h.av.completePrepare();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  assert.equal(h.player.state.status, 'idle', 'dual playback closes the ordinary stream');
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
  assert.deepEqual(h.managers[0].calls.find(c => c[0] === 'setStreamingProperty'), ['setStreamingProperty', 'IN_APP_MULTIVIEW', 'VIDEO_VIEW_RESOURCE_MAIN']);
  assert.deepEqual(h.managers[1].calls.find(c => c[0] === 'setStreamingProperty'), ['setStreamingProperty', 'IN_APP_MULTIVIEW', 'VIDEO_VIEW_RESOURCE_SUB']);
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  dual.selectAudio(1);
  assert.equal(h.managers[0].audioEnabled, false); assert.equal(h.managers[1].audioEnabled, true);
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
  dual.setRects([{ left: 56, top: 200, width: 1808, height: 575 }, { left: 1340, top: 480, width: 470, height: 264 }]);
  assert.equal(h.managers[0].prepares.length, 1, 'PiP layout does not reconnect');
  dual.stop(); assert.equal(h.managers[0].getState(), 'NONE'); assert.equal(h.managers[1].getState(), 'NONE');
  assert.equal(h.clock.size, 0);
});

test('initial parallel dual startup tolerates repeated main audio choice without disabling sub twice', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  assert.equal(h.managers[0].prepares.length, 1);
  assert.equal(h.managers[1].prepares.length, 1, 'both streams prepare immediately');
  assert.equal(dual.selectAudio(0), true, 'the UI confirms main audio while both prepare');
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  assert.equal(h.managers[0].getState(), 'PLAYING');
  assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  assert.equal(h.managers[1].calls.filter(c => c[0] === 'disableAudioStream').length, 1);
  assert.equal(h.states.filter(entry => entry.state.status === 'error').length, 0);
});

test('native audio switching adopts automatic peer silence and repeated selections make no extra calls', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  for (const selected of [1, 0, 1]) {
    assert.equal(dual.selectAudio(selected), true);
    assert.equal(h.managers[selected].audioEnabled, true);
    assert.equal(h.managers[1 - selected].audioEnabled, false);
    const before = h.managers.map(manager => manager.calls.length);
    assert.equal(dual.selectAudio(selected), true);
    assert.deepEqual(h.managers.map(manager => manager.calls.length), before, 'confirming the same choice is a no-op');
  }
  assert.equal(h.managers[0].calls.filter(c => c[0] === 'disableAudioStream').length, 0);
  assert.equal(h.managers[1].calls.filter(c => c[0] === 'disableAudioStream').length, 1, 'only initial IDLE mute is needed');
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
});

function playingDual() {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers.forEach(manager => manager.completePrepare());
  return { ...h, dual };
}

test('native dual startup keeps default MAIN audio and mutes SUB before assigning its resource', () => {
  const h = playingDual();
  assert.equal(h.managers[0].calls.filter(call => call[0] === 'enableAudioStream').length, 0);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  const subCalls = h.managers[1].calls;
  assert.ok(subCalls.findIndex(call => call[0] === 'disableAudioStream') < subCalls.findIndex(call => call[0] === 'setStreamingProperty'));
  assert.equal(h.dual.capability.requiresMainAudio, false);
});

test('a thrown native audio enable is never treated as success or followed by decoder-corrupting verification', () => {
  const h = playingDual(), enable = h.managers[1].enableAudioStream;
  let attempts = 0;
  h.managers[1].enableAudioStream = function () {
    assert.equal(this, h.managers[1]); attempts++; enable.call(this); throw { name: 'TypeMismatchError', code: 17 };
  };
  const before = h.managers.map(manager => manager.calls.filter(call => /AudioStream$/.test(call[0])).length);
  assert.equal(h.dual.selectAudio(1), false);
  assert.equal(attempts, 1);
  assert.equal(h.dual.capability.requiresMainAudio, true);
  assert.match(h.dual.capability.audioReason, /main picture/);
  assert.equal(h.managers[0].calls.filter(call => /AudioStream$/.test(call[0])).length, before[0], 'no native rollback or peer probe');
  assert.equal(h.managers[1].calls.filter(call => /AudioStream$/.test(call[0])).length, before[1] + 1, 'only the original enable occurs');
  const calls = h.managers.map(manager => manager.calls.length);
  assert.equal(h.dual.selectAudio(1), false); assert.equal(h.dual.selectAudio(0), false);
  assert.deepEqual(h.managers.map(manager => manager.calls.length), calls, 'fallback flag blocks further PLAYING route calls');
  assert.equal(h.audioErrors.length, 2, 'one failure report per attempted synchronous selection');
  assert.deepEqual(h.managers.map(manager => manager.prepares.length), [1, 1]);
});

test('native before-effect audio errors request safe MAIN promotion without retrying or silencing the healthy peer', () => {
  for (const error of [{ name: 'InvalidAccessError', code: 15 }, { name: 'TypeMismatchError', code: 17 }, { name: 'NotSupportedError' }]) {
    const h = playingDual(); let attempts = 0;
    h.managers[1].enableAudioStream = function () { attempts++; throw error; };
    assert.equal(h.dual.selectAudio(1), false); assert.equal(attempts, 1);
    assert.equal(h.dual.capability.requiresMainAudio, true);
    assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
    assert.equal(h.audioErrors.length, 1);
    assert.deepEqual(h.managers.map(manager => manager.prepares.length), [1, 1]);
  }
});

test('safe audio promotion closes both old feeds before reusing exactly two managers with default MAIN audio', () => {
  const h = playingDual(), events = [];
  const oldRequests = h.managers.map(manager => manager.prepares[0].url);
  h.managers[1].enableAudioStream = function () { throw { name: 'InvalidAccessError', code: 15 }; };
  assert.equal(h.dual.selectAudio(1), false);
  for (const [slot, manager] of h.managers.entries()) {
    const close = manager.close, open = manager.open;
    manager.close = function () { events.push(['close', slot]); close.call(this); };
    manager.open = function (url) {
      if (events.filter(event => event[0] === 'open').length === 0) {
        assert.deepEqual(h.managers.map(m => m.getState()), ['NONE', 'NONE'], 'both streams must close before the first new open');
      }
      events.push(['open', slot]); open.call(this, url);
    };
    manager.enableAudioStream = function () { throw Error('safe MAIN promotion must never enable native audio'); };
  }
  h.dual.stop();
  h.dual.play(0, { url: oldRequests[1], live: true }); h.dual.play(1, { url: oldRequests[0], live: true });
  h.managers.forEach(manager => manager.completePrepare());
  assert.equal(h.managers[0].prepares.at(-1).url, oldRequests[1]); assert.equal(h.managers[1].prepares.at(-1).url, oldRequests[0]);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.dual.selectAudio(0), true); assert.equal(h.dual.selectAudio(1), false);
  assert.equal(h.allocated, 2);
  assert.equal(h.dual.capability.requiresMainAudio, true);
  h.managers[0].event('oncurrentplaytime', 1000); h.managers[1].event('oncurrentplaytime', 1000);
  for (let i = 1; i <= 8; i++) {
    h.managers[0].clock = 1000 + i * 5000; h.managers[1].clock = 1000 + i * 5000; h.clock.advance(5000);
  }
  assert.deepEqual(h.managers.map(manager => manager.prepares.length), [2, 2]);
});

test('stopping a normally supported dual session resets next startup to default MAIN audio after both releases', () => {
  const h = playingDual(); assert.equal(h.dual.selectAudio(1), true);
  assert.equal(h.managers[1].audioEnabled, true);
  h.dual.stop();
  const enables = h.managers.map(manager => manager.calls.filter(call => call[0] === 'enableAudioStream').length);
  h.dual.play(0, { url: 'https://example.test/next-main.ts', live: true }); h.dual.play(1, { url: 'https://example.test/next-sub.ts', live: true });
  h.managers.forEach(manager => manager.completePrepare());
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  assert.deepEqual(h.managers.map(manager => manager.calls.filter(call => call[0] === 'enableAudioStream').length), enables);
  assert.equal(h.dual.capability.requiresMainAudio, false);
});

test('queued native audio errors expose MAIN fallback and terminate safely without backup DSP retries', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/main.ts', backups: ['https://example.test/main-backup.ts'], live: true });
  dual.play(1, { url: 'https://example.test/sub.ts', live: true });
  assert.equal(dual.selectAudio(1), true, 'prepared callback owns this queued change');
  h.managers[0].disableAudioStream = function () { throw { name: 'NotSupportedError' }; };
  h.managers[0].completePrepare();
  assert.equal(dual.capability.requiresMainAudio, true);
  assert.equal(h.managers[0].getState(), 'NONE');
  assert.equal(h.states.filter(entry => entry.slot === 0).at(-1).state.status, 'error');
  assert.equal(h.managers[0].prepares.length, 1, 'audio routing failure is not retried against another source');
});

test('an unavailable dual pane cannot silence a healthy peer or queue a misleading audio choice', () => {
  const h = playingDual();
  h.managers[1].event('onerror', 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(h.states.filter(entry => entry.slot === 1).at(-1).state.status, 'error');
  const before = h.managers.map(manager => manager.calls.length);
  assert.equal(h.dual.selectAudio(1), false);
  assert.deepEqual(h.managers.map(manager => manager.calls.length), before);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[0].getState(), 'PLAYING');
  h.dual.stop(); const stopped = h.managers.map(manager => manager.calls.length);
  assert.equal(h.dual.selectAudio(0), false);
  assert.deepEqual(h.managers.map(manager => manager.calls.length), stopped);
});

test('reopening a muted dual stream resets applied audio state and mutes the new stream once', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  dual.play(1, { url: 'https://example.test/game3.ts', live: true });
  assert.equal(dual.selectAudio(0), true); h.managers[1].completePrepare();
  assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.managers[1].audioEnabled, false);
  assert.equal(h.managers[1].calls.filter(c => c[0] === 'disableAudioStream').length, 2);
  dual.stop(); dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  assert.equal(h.managers[1].calls.filter(c => c[0] === 'disableAudioStream').length, 3);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
});

test('dual audio choice queues during preparation and native instances are reused across sessions', () => {
  const h = dualHarness(); let dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  dual.selectAudio(1); h.managers[0].completePrepare(); h.managers[1].completePrepare();
  assert.equal(h.managers[0].audioEnabled, false); assert.equal(h.managers[1].audioEnabled, true);
  dual.stop();
  for (let count = 0; count < 3; count++) {
    dual = h.makeDual();
    dual.play(0, { url: 'https://example.test/game1.ts', live: true }); h.managers[0].completePrepare(); dual.stop();
  }
  assert.equal(h.allocated, 2);
});

test('an older or unsupported Samsung keeps normal playback and reports honest dual capability errors', () => {
  const h = dualHarness('6.5'), dual = h.makeDual();
  assert.equal(dual.capability.supported, false); assert.equal(h.allocated, 0);
  assert.equal(dual.play(0, { url: 'https://example.test/game1.ts', live: true }), false);
  assert.equal(h.states.at(-1).state.status, 'error'); assert.match(h.states.at(-1).state.error, /Tizen 7/);
  h.player.play({ url: 'https://example.test/a.ts', live: true }); h.av.completePrepare();
  assert.equal(h.player.state.status, 'playing');
  const newer = dualHarness(); delete newer.managers[1].disableAudioStream;
  assert.equal(newer.makeDual().capability.supported, false);
});

test('native dual setup failure never pretends to have a second playing stream', () => {
  const h = dualHarness(), dual = h.makeDual();
  h.managers[1].setStreamingProperty = function () { throw { name: 'NotSupportedError' }; };
  dual.play(0, { url: 'https://example.test/game1.ts', live: true }); h.managers[0].completePrepare();
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  const sub = h.states.filter(entry => entry.slot === 1).at(-1);
  assert.equal(sub.state.status, 'error'); assert.match(sub.state.error, /not supported by this TV/);
  assert.equal(h.managers[1].prepares.length, 0); assert.equal(h.managers[0].getState(), 'PLAYING');
});

test('dual source failure is isolated and returning to normal closes both streams and restores audio', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', backups: ['https://example.test/backup.ts'], live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  h.managers[0].event('onerror', 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(h.managers[1].getState(), 'PLAYING'); assert.equal(h.managers[1].prepares.length, 1);
  h.managers[0].completePrepare(); dual.selectAudio(1);
  h.av.audioEnabled = false; // another active instance may have disabled the ordinary player
  h.player.play({ url: 'https://example.test/a.ts', live: true });
  assert.equal(h.managers[0].getState(), 'NONE'); assert.equal(h.managers[1].getState(), 'NONE');
  h.av.completePrepare(); assert.equal(h.av.audioEnabled, true);
});

test('dual suspend/restore returns both actual players without replacing their URLs', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare(); dual.selectAudio(1);
  dual.suspend(); dual.restore();
  h.managers[0].completeRestore(); h.managers[1].completeRestore();
  assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.managers[0].audioEnabled, false); assert.equal(h.managers[1].audioEnabled, true);
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
});

test('changing audio while suspended works in either native restore completion order', () => {
  for (const previouslySelected of [0, 1]) {
    for (const firstRestored of [0, 1]) {
      const h = dualHarness(), dual = h.makeDual();
      dual.play(0, { url: 'https://example.test/game1.ts', live: true });
      dual.play(1, { url: 'https://example.test/game2.ts', live: true });
      h.managers[0].completePrepare(); h.managers[1].completePrepare();
      assert.equal(dual.selectAudio(previouslySelected), true);
      dual.suspend();
      const chosen = 1 - previouslySelected;
      assert.equal(dual.selectAudio(chosen), true);
      dual.restore();
      h.managers[firstRestored].completeRestore(); h.managers[1 - firstRestored].completeRestore();
      assert.equal(h.managers[chosen].audioEnabled, true);
      assert.equal(h.managers[1 - chosen].audioEnabled, false,
        'the previously chosen player must mute even if it restores last');
      assert.equal(h.managers[0].getState(), 'PLAYING'); assert.equal(h.managers[1].getState(), 'PLAYING');
      assert.equal(h.states.filter(entry => entry.state.status === 'error').length, 0);
    }
  }
});

test('desktop dual preview uses two real HTML videos with one chosen audio stream', async () => {
  const h = harness(false), videos = [htmlVideo(), htmlVideo()];
  const dual = h.window.TunerPlayer.createDual({ videoElements: videos });
  assert.equal(dual.capability.native, false);
  dual.play(0, { url: 'https://example.test/game1.mp4', live: true });
  dual.play(1, { url: 'https://example.test/game2.mp4', live: true });
  videos[0].dispatch('loadedmetadata'); videos[1].dispatch('loadedmetadata');
  assert.equal(videos[0].paused, false); assert.equal(videos[1].paused, false);
  assert.equal(videos[0].muted, false); assert.equal(videos[1].muted, true);
  dual.selectAudio(1); assert.equal(videos[0].muted, true); assert.equal(videos[1].muted, false);
  dual.stop(); await Promise.resolve(); assert.equal(videos[0].src, ''); assert.equal(videos[1].src, '');
});

test('audio switch failure preserves source streams until explicit safe restart', () => {
  const h = dualHarness(), dual = h.makeDual();
  dual.play(0, { url: 'https://example.test/game1.ts', live: true });
  dual.play(1, { url: 'https://example.test/game2.ts', live: true });
  h.managers[0].completePrepare(); h.managers[1].completePrepare();
  const enable = h.managers[1].enableAudioStream;
  h.managers[1].enableAudioStream = function () { throw { name: 'NotSupportedError' }; };
  assert.equal(dual.selectAudio(1), false);
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[0].getState(), 'PLAYING');
  assert.equal(h.managers[1].getState(), 'PLAYING');
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
  h.managers[1].enableAudioStream = enable;
  dual.suspend(); dual.restore();
  h.managers[0].completeRestore(); h.managers[1].completeRestore();
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false,
    'a failed audio choice must not be applied by a later restore');
  assert.equal(dual.capability.requiresMainAudio, true);
  assert.equal(dual.selectAudio(1), false, 'native DSP calls remain blocked until explicit MAIN promotion');
  assert.equal(h.managers[0].audioEnabled, true); assert.equal(h.managers[1].audioEnabled, false);
  assert.equal(h.managers[0].prepares.length, 1); assert.equal(h.managers[1].prepares.length, 1);
});

test('failed native mute changes restore desired intent before later playback synchronization', () => {
  const h = harness();
  h.player.play({ url: 'https://example.test/a.ts', live: true }); h.av.completePrepare();
  assert.equal(h.player.setMuted(true), true);
  const enable = h.av.enableAudioStream;
  h.av.enableAudioStream = function () { throw { name: 'NotSupportedError' }; };
  assert.equal(h.player.setMuted(false), false);
  h.av.enableAudioStream = enable;
  h.player.pause(); h.player.resume();
  assert.equal(h.av.audioEnabled, false, 'Play must retain the mute intent that preceded the failed change');
  h.player.suspend(); h.player.restore(); h.av.completeRestore();
  assert.equal(h.av.audioEnabled, false, 'Restore must also retain that prior intent without a new audio selection');
  assert.equal(h.player.setMuted(false), true);
  assert.equal(h.av.audioEnabled, true, 'an explicit retry can apply the requested change');
});

function subtitleHarness(native, subtitlesOn, video) {
  const clock = timers(), av = native ? avplay() : null, cues = [];
  video = video || htmlVideo();
  const window = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: { now() { return clock.now; } } };
  if (av) { window.webapis = { avplay: av }; }
  vm.runInNewContext(source, { window }, { filename: 'player.js' });
  const setting = { on: subtitlesOn };
  const player = window.TunerPlayer.create({ objectElement: { style: {}, setAttribute() {} }, videoElement: video,
    subtitles() { return setting.on; }, onSubtitle(text, duration) { cues.push([text, duration]); } });
  return { player, av, video, clock, cues, setting };
}

test('AVPlay subtitles: the On setting selects a text track per stream and cue text reaches the app', () => {
  const h = subtitleHarness(true, true);
  h.player.play({ url: 'https://example.test/live.m3u8', live: true });
  h.av.completePrepare();
  assert.deepEqual(h.av.calls.find(x => x[0] === 'setSelectTrack' && x[1] === 'TEXT'), ['setSelectTrack', 'TEXT', 11]);
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'setSilentSubtitle').at(-1), ['setSilentSubtitle', false]);
  assert.equal(h.player.subtitlesShowing(), true);
  h.av.event('onsubtitlechange', '2500', 'Bonjour');
  assert.deepEqual(h.cues.at(-1), ['Bonjour', 2500]);
  assert.equal(h.player.selectTrack('TEXT', -1), true);
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'setSilentSubtitle').at(-1), ['setSilentSubtitle', true]);
  assert.deepEqual(h.cues.at(-1), ['', 0], 'turning subtitles off clears the text on screen');
  const count = h.cues.length;
  h.av.event('onsubtitlechange', 1000, 'Hidden');
  assert.equal(h.cues.length, count, 'silenced cues are not drawn');
});

test('AVPlay subtitles stay silent with the Off setting until the viewer picks a track', () => {
  const h = subtitleHarness(true, false);
  h.player.play({ url: 'https://example.test/movie.mp4', live: false });
  h.av.completePrepare();
  assert.equal(h.av.calls.some(x => x[0] === 'setSelectTrack' && x[1] === 'TEXT'), false);
  assert.deepEqual(h.av.calls.filter(x => x[0] === 'setSilentSubtitle').at(-1), ['setSilentSubtitle', true]);
  h.av.event('onsubtitlechange', 1000, 'Not shown');
  assert.equal(h.cues.filter(cue => cue[0]).length, 0);
  assert.equal(h.player.tracks().subtitles[0].language, 'fra');
  h.player.selectTrack('TEXT', 11);
  h.av.event('onsubtitlechange', 1000, 'Shown');
  assert.deepEqual(h.cues.at(-1), ['Shown', 1000]);
  h.player.play({ url: 'https://example.test/next.mp4', live: false });
  assert.equal(h.player.subtitlesShowing(), false, 'a new stream follows the setting again');
});

test('HTML video subtitles: captions and subtitle tracks are offered, English is preferred, data tracks are not', () => {
  const video = htmlVideo();
  video.textTracks = [{ kind: 'metadata', language: '', mode: 'hidden' }, { kind: 'subtitles', language: 'fra', mode: 'disabled' }, { kind: 'captions', language: 'en', mode: 'disabled' }];
  const h = subtitleHarness(false, true, video);
  h.player.play({ url: 'https://example.test/live.m3u8', live: true });
  video.dispatch('loadedmetadata');
  assert.deepEqual(video.textTracks.map(track => track.mode), ['hidden', 'disabled', 'showing']);
  assert.deepEqual([...h.player.tracks().subtitles.map(track => track.index)], [1, 2]);
  h.player.selectTrack('TEXT', -1);
  assert.deepEqual(video.textTracks.map(track => track.mode), ['hidden', 'disabled', 'disabled']);
  assert.equal(h.player.subtitlesShowing(), false);
});

test('HTML video: tracks announced after metadata are picked up for live streams', () => {
  const video = htmlVideo(), trackListeners = [];
  video.textTracks = [];
  video.textTracks.addEventListener = (name, fn) => { assert.equal(name, 'addtrack'); trackListeners.push(fn); };
  video.textTracks.removeEventListener = (name, fn) => { trackListeners.splice(trackListeners.indexOf(fn), 1); };
  const h = subtitleHarness(false, true, video);
  h.player.play({ url: 'https://example.test/live.m3u8', live: true });
  video.dispatch('loadedmetadata');
  assert.equal(h.player.tracks().subtitles.length, 0);
  video.textTracks.push({ kind: 'captions', language: 'en', label: 'CC1', mode: 'disabled' });
  trackListeners.forEach(fn => fn());
  assert.equal(video.textTracks[0].mode, 'showing');
  h.player.stop();
  assert.equal(trackListeners.length, 0, 'the track listener is released with the stream');
});

test('the display rect is reapplied after preparation and resume, and always letterboxes', () => {
  const h = subtitleHarness(true, false);
  const last = name => h.av.calls.filter(x => x[0] === name).at(-1);
  h.player.setRect({ left: 1398, top: 145, width: 466, height: 263 });
  h.player.play({ url: 'https://example.test/live.m3u8', live: true });
  assert.deepEqual(last('setDisplayMethod'), ['setDisplayMethod', 'PLAYER_DISPLAY_MODE_LETTER_BOX']);
  h.player.setRect({ left: 0, top: 0, width: 1920, height: 1080 });
  h.av.completePrepare();
  assert.deepEqual(last('setDisplayRect'), ['setDisplayRect', 0, 0, 1920, 1080]);
  h.player.pause(); h.player.resume();
  assert.deepEqual(last('setDisplayRect'), ['setDisplayRect', 0, 0, 1920, 1080]);
  // Back to the guide: the picture returns to the preview frame. FULL_SCREEN would keep it covering the panel.
  h.player.setRect({ left: 1398, top: 145, width: 466, height: 263 });
  assert.deepEqual(last('setDisplayRect'), ['setDisplayRect', 1398, 145, 466, 263]);
  assert.deepEqual(last('setDisplayMethod'), ['setDisplayMethod', 'PLAYER_DISPLAY_MODE_LETTER_BOX']);
  assert.equal(h.av.calls.some(x => x[0] === 'setDisplayMethod' && x[1] !== 'PLAYER_DISPLAY_MODE_LETTER_BOX'), false);
});
