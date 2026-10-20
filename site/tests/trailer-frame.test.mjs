// public/embed/trailer-frame.js, the in-app trailer player's script, run in Node: the message rules as pure functions,
// then the page's wiring with a stub YouTube API, a stub parent window and dispatched events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const SOURCE = readFileSync(new URL('../public/embed/trailer-frame.js', import.meta.url), 'utf8');
const KEY = 'L0fw0WzFaBM';
// Every message the page may send, as the contract writes them.
const EVENT = /^\{"tuner":"trailer","v":1,"type":"(?:ready"|state","state":"(?:unstarted|playing|paused|buffering|ended|cued)"|error","code":\d{1,6}|key","key":"(?:back|enter|playpause|play|pause|stop|left|right|up|down)")\}$/;
const plain = value => JSON.parse(JSON.stringify(value));

function load(globals = {}) {
  const context = {...globals};
  runInNewContext(SOURCE, context, {filename: 'trailer-frame.js'});
  return context;
}
const frame = load().LumaNestTrailerFrame;
const command = (type, extra = {}) => JSON.stringify({tuner: 'trailer', v: 1, type, ...extra});

test('the script is ES5 and plain ASCII: it runs in the TV engines (Tizen 2.3, webOS 3)', () => {
  assert.doesNotThrow(() => parse(SOURCE, {ecmaVersion: 5, sourceType: 'script'}));
  assert.doesNotMatch(SOURCE, /[^\x09\x0a\x20-\x7e]/);
});

test('commands: exactly the contract shape, nothing else', () => {
  for (const type of ['toggle', 'play', 'pause', 'stop']) assert.deepEqual(plain(frame.parseCommand(command(type))), {type});
  assert.deepEqual(plain(frame.parseCommand(command('seek', {by: -10}))), {type: 'seek', by: -10});
  assert.deepEqual(plain(frame.parseCommand(command('seek', {by: 10}))), {type: 'seek', by: 10});
  assert.deepEqual(plain(frame.parseCommand('{"by":10.0,"type":"seek","v":1,"tuner":"trailer"}')), {type: 'seek', by: 10});
  for (const data of [
    undefined, null, 1, {tuner: 'trailer', v: 1, type: 'play'}, ['x'], '', 'play', 'null', '[]', '"play"', '{', command('play') + 'x',
    command('ready'), command('state'), command('key'), command('error'), command('toString'), command('hasOwnProperty'), command('__proto__'),
    command('PLAY'), command(' play'), JSON.stringify({tuner: 'trailer', v: '1', type: 'play'}), JSON.stringify({tuner: 'trailer', v: 2, type: 'play'}),
    JSON.stringify({tuner: 'Trailer', v: 1, type: 'play'}), JSON.stringify({v: 1, type: 'play'}), JSON.stringify({tuner: 'trailer', type: 'play'}),
    command('play', {by: 10}), command('play', {extra: true}), command('seek'), command('seek', {by: 5}), command('seek', {by: '10'}),
    command('seek', {by: 10.5}), command('seek', {by: -100}), command('seek', {by: null}), command('seek', {by: 10, at: 3}),
    '{"tuner":"trailer","v":1,"type":"play","__proto__":{"x":1}}', command('play', {pad: 'x'.repeat(200)}),
  ]) assert.equal(frame.parseCommand(data), null, String(data));
});

test('events: the contract strings, and nothing outside it can be built', () => {
  assert.equal(frame.buildEvent('ready'), '{"tuner":"trailer","v":1,"type":"ready"}');
  assert.equal(frame.buildEvent('state', 'playing'), '{"tuner":"trailer","v":1,"type":"state","state":"playing"}');
  assert.equal(frame.buildEvent('error', 150), '{"tuner":"trailer","v":1,"type":"error","code":150}');
  assert.equal(frame.buildEvent('key', 'back'), '{"tuner":"trailer","v":1,"type":"key","key":"back"}');
  for (const state of ['unstarted', 'playing', 'paused', 'buffering', 'ended', 'cued']) assert.match(frame.buildEvent('state', state), EVENT);
  for (const name of ['back', 'enter', 'playpause', 'play', 'pause', 'stop', 'left', 'right', 'up', 'down']) assert.match(frame.buildEvent('key', name), EVENT);
  for (const [type, detail] of [
    ['ready', 'x'], ['state', 'stopped'], ['state', 1], ['state', 'toString'], ['error', '150'], ['error', 1.5], ['error', -1], ['error', NaN],
    ['error', Infinity], ['error', 1e7], ['key', 'home'], ['key', 'constructor'], ['key', 13], ['url', 'https://example.com'], ['title', 'x'], ['toggle', undefined],
  ]) assert.equal(frame.buildEvent(type, detail), null, type + ' ' + detail);
});

test('player states, error codes, remote keys and 10-second steps', () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 5].map(frame.stateName), ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']);
  for (const code of [4, 6, '1', null, undefined, NaN]) assert.equal(frame.stateName(code), null);
  assert.deepEqual([2, 5, 100, 101, 150, 152, 153, '150'].map(frame.errorCode), [2, 5, 100, 101, 150, 152, 153, 150]);
  for (const code of [null, undefined, -1, 1.5, '1e3', ' 5', 'x', {}, 1e7]) assert.equal(frame.errorCode(code), null);

  const key = (keyCode, name) => frame.keyName({keyCode, key: name});
  assert.deepEqual([10009, 461, 27, 8].map(code => key(code)), ['back', 'back', 'back', 'back'], 'Samsung, LG, Escape, Backspace');
  assert.deepEqual([13, 10252, 415, 19, 413, 37, 39, 38, 40].map(code => key(code)), ['enter', 'playpause', 'play', 'pause', 'stop', 'left', 'right', 'up', 'down']);
  assert.deepEqual([412, 417].map(code => key(code)), ['left', 'right'], 'Rewind and FastForward step as Left and Right');
  assert.deepEqual(['Escape', 'GoBack', 'Enter', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'MediaRewind', 'MediaFastForward'].map(name => key(0, name)),
    ['back', 'back', 'enter', 'playpause', 'play', 'pause', 'stop', 'left', 'right', 'up', 'down', 'left', 'right']);
  for (const [code, name] of [[65, 'a'], [0, 'Home'], [0, 'toString'], [0, undefined], [48, '0']]) assert.equal(key(code, name), null);
  assert.equal(frame.keyName(null), null);

  assert.equal(frame.seekTarget(30, 120, 10), 40);
  assert.equal(frame.seekTarget(30, 120, -10), 20);
  assert.equal(frame.seekTarget(4, 120, -10), 0);
  assert.equal(frame.seekTarget(115, 120, 10), 120);
  assert.equal(frame.seekTarget(115, 0, 10), 125, 'unknown duration: no upper bound');
  assert.equal(frame.seekTarget(NaN, NaN, 10), 10);
});

function stubPlayer(state = -1) {
  const calls = [];
  return {
    calls, state, time: 30, duration: 120,
    getPlayerState() {return this.state;}, getCurrentTime() {return this.time;}, getDuration() {return this.duration;},
    playVideo() {calls.push('play');}, pauseVideo() {calls.push('pause');}, stopVideo() {calls.push('stop');},
    seekTo(seconds, allowAhead) {calls.push('seek ' + seconds + ' ' + allowAhead);},
  };
}

test('commands drive the player: toggle pauses while playing or buffering, otherwise plays', () => {
  const run = (state, data) => {const player = stubPlayer(state); frame.applyCommand(player, frame.parseCommand(data)); return player.calls;};
  assert.deepEqual(run(1, command('toggle')), ['pause']);
  assert.deepEqual(run(3, command('toggle')), ['pause']);
  for (const state of [-1, 2, 5, 0]) assert.deepEqual(run(state, command('toggle')), ['play'], 'state ' + state);
  assert.deepEqual(run(1, command('play')), ['play']);
  assert.deepEqual(run(1, command('pause')), ['pause']);
  assert.deepEqual(run(1, command('stop')), ['stop']);
  assert.deepEqual(run(1, command('seek', {by: 10})), ['seek 40 true']);
  assert.deepEqual(run(1, command('seek', {by: -10})), ['seek 20 true']);
});

test('10-second steps in a row add up while the player still reports the old position', () => {
  const player = stubPlayer(1);
  player.duration = 213;
  const last = {target: null, at: 0};
  const step = (by, now) => frame.applyCommand(player, frame.parseCommand(command('seek', {by})), last, now);
  // getCurrentTime() stays at 30 while the seeks load: each press still moves 10 s on.
  step(10, 1000); step(10, 1350); step(10, 1700); step(-10, 2050);
  assert.deepEqual(player.calls, ['seek 40 true', 'seek 50 true', 'seek 60 true', 'seek 50 true']);
  assert.deepEqual(plain(last), {target: 50, at: 2050});
  // The player reports the target (or near it): steps go on from where it is.
  player.calls.length = 0;
  player.time = 52; step(10, 2400);
  assert.deepEqual(player.calls, ['seek 62 true']);
  // A step more than 3 s after the last one starts from the player's position, wherever that is.
  player.calls.length = 0;
  player.time = 30; step(10, 5400);
  assert.deepEqual(player.calls, ['seek 40 true']);
  // Clamped at the end and at the start, chained or not.
  player.calls.length = 0;
  player.time = 200; step(10, 9000); step(10, 9300);
  player.time = 3; step(-10, 20000); step(-10, 20300);
  assert.deepEqual(player.calls, ['seek 210 true', 'seek 213 true', 'seek 0 true', 'seek 0 true']);
  // The rule alone: a recent target not yet reached, a reached one, an old one, a clock that went back, no memory.
  assert.equal(frame.seekFrom(30, {target: 50, at: 1000}, 3999), 50);
  assert.equal(frame.seekFrom(46, {target: 50, at: 1000}, 2000), 46);
  assert.equal(frame.seekFrom(30, {target: 50, at: 1000}, 4000), 30);
  assert.equal(frame.seekFrom(30, {target: 50, at: 1000}, 999), 30);
  assert.equal(frame.seekFrom(30, {target: null, at: 0}, 100), 30);
  assert.equal(frame.seekFrom(30, null, 100), 30);
  assert.equal(frame.seekFrom(NaN, {target: 50, at: 1000}, 1500), 50);
  // Without the memory (as before), each step starts from getCurrentTime().
  const alone = stubPlayer(1);
  frame.applyCommand(alone, frame.parseCommand(command('seek', {by: 10})));
  frame.applyCommand(alone, frame.parseCommand(command('seek', {by: 10})));
  assert.deepEqual(alone.calls, ['seek 40 true', 'seek 40 true']);
});

// A page in a stub browser: a parent window that records what it receives, the #player element, keydown and message
// listeners, the scripts the page adds to its body (with whether onYouTubeIframeAPIReady was set by then), and a stub
// YT.Player that records how it was made.
function page({key = KEY, framed = true, loaded = false, ancestors} = {}) {
  const sent = [];
  const listeners = {message: [], keydown: []};
  const element = {getAttribute: name => (name === 'data-k' ? key : null)};
  const iframe = {attributes: {}, setAttribute(name, value) {this.attributes[name] = value;}};
  const made = [];
  const scripts = [];
  const parent = {postMessage(message, target) {sent.push([message, target]);}};
  const window = {
    document: {
      getElementById: id => (id === 'player' ? element : null), addEventListener: (type, fn) => listeners[type].push(fn),
      createElement: tag => ({tagName: tag.toUpperCase()}),
      body: {appendChild: node => scripts.push({tag: node.tagName, src: node.src, handler: typeof window.onYouTubeIframeAPIReady})},
    },
    addEventListener: (type, fn) => listeners[type].push(fn),
  };
  window.parent = framed ? parent : window;
  if (ancestors) window.location = {ancestorOrigins: {length: ancestors.length, ...ancestors}};
  function Player(target, options) {
    Object.assign(this, stubPlayer(-1));
    this.target = target; this.options = options; this.getIframe = () => iframe;
    made.push(this);
  }
  window.YT = {Player, loaded: loaded ? 1 : 0};
  return {
    window, sent, made, iframe, element, parent, scripts,
    messages: () => sent.map(([message]) => message),
    post: (data, source = parent) => listeners.message.forEach(fn => fn({data, source, origin: 'null'})),
    key(keyCode, keyName) {
      const event = {keyCode, key: keyName, prevented: false, preventDefault() {this.prevented = true;}};
      listeners.keydown.forEach(fn => fn(event));
      return event.prevented;
    },
  };
}

test('the page adds YouTube\'s IFrame API, then makes the player the contract asks for when the API is ready', () => {
  const p = page();
  frame.start(p.window);
  assert.deepEqual(p.scripts, [{tag: 'SCRIPT', src: 'https://www.youtube.com/iframe_api', handler: 'function'}], 'the API once, after its handler');
  assert.equal(p.made.length, 0, 'waits for the API');
  assert.equal(typeof p.window.onYouTubeIframeAPIReady, 'function');
  p.window.onYouTubeIframeAPIReady();
  p.window.onYouTubeIframeAPIReady();
  assert.equal(p.made.length, 1, 'one player');
  const [player] = p.made;
  assert.equal(player.target, p.element);
  const {events, ...options} = player.options;
  assert.deepEqual(plain(options), {
    host: 'https://www.youtube-nocookie.com', videoId: KEY, width: '100%', height: '100%',
    playerVars: {autoplay: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: 'https://lumanest.tv', enablejsapi: 1},
  });
  assert.deepEqual(Object.keys(events).sort(), ['onError', 'onReady', 'onStateChange']);

  const early = page({loaded: true});
  frame.start(early.window);
  assert.equal(early.made.length, 1, 'an API that is already loaded is used at once');
  assert.deepEqual(early.scripts, [], 'and not added again');
});

test('ready, states, errors and keys reach the parent as contract strings with target "*"', () => {
  const p = page();
  frame.start(p.window);
  p.window.onYouTubeIframeAPIReady();
  const [player] = p.made;
  const {onReady, onStateChange, onError} = player.options.events;

  p.post(command('pause'));
  assert.deepEqual(player.calls, [], 'no command before ready');
  onReady({target: player});
  assert.deepEqual(player.calls, ['play'], 'playVideo on ready, never mute');
  assert.equal(p.iframe.attributes.tabindex, '-1');
  for (const state of [-1, 3, 1, 2, 5, 0, 4, undefined]) onStateChange({data: state});
  onStateChange(undefined);
  for (const code of [150, 153, '101', 'x', 2.5]) onError({data: code});
  assert.equal(p.key(10009), true);
  assert.equal(p.key(461), true);
  assert.equal(p.key(0, 'Escape'), true);
  assert.equal(p.key(13), true);
  assert.equal(p.key(65, 'a'), false, 'other keys are not touched');

  assert.deepEqual(p.messages(), [
    '{"tuner":"trailer","v":1,"type":"ready"}',
    ...['unstarted', 'buffering', 'playing', 'paused', 'cued', 'ended'].map(state => '{"tuner":"trailer","v":1,"type":"state","state":"' + state + '"}'),
    '{"tuner":"trailer","v":1,"type":"error","code":150}', '{"tuner":"trailer","v":1,"type":"error","code":153}', '{"tuner":"trailer","v":1,"type":"error","code":101}',
    ...['back', 'back', 'back', 'enter'].map(name => '{"tuner":"trailer","v":1,"type":"key","key":"' + name + '"}'),
  ]);
  for (const [message, target] of p.sent) {
    assert.match(message, EVENT);
    assert.equal(target, '*');
  }
});

test('only the parent window commands the player, and only with contract messages', () => {
  const p = page();
  frame.start(p.window);
  p.window.onYouTubeIframeAPIReady();
  const [player] = p.made;
  player.options.events.onReady({target: player});
  player.calls.length = 0;
  player.state = 1;

  p.post(command('toggle'), {postMessage() {}});
  p.post(command('toggle'), p.window);
  p.post(command('toggle'), null);
  p.post({tuner: 'trailer', v: 1, type: 'toggle'});
  p.post(command('mute'));
  p.post(command('seek', {by: 30}));
  assert.deepEqual(player.calls, [], 'other sources, objects and unknown commands are ignored');

  p.post(command('toggle'));
  player.state = 2;
  p.post(command('toggle'));
  p.post(command('seek', {by: 10}));
  p.post(command('seek', {by: -10}));
  p.post(command('pause'));
  p.post(command('play'));
  p.post(command('stop'));
  // The stub's position stays at 30 s: the second step goes on from the first one's target (40 - 10).
  assert.deepEqual(player.calls, ['pause', 'play', 'seek 40 true', 'seek 30 true', 'pause', 'play', 'stop']);
  player.playVideo = () => {throw new Error('player gone');};
  assert.doesNotThrow(() => p.post(command('play')));
  assert.deepEqual(p.messages(), ['{"tuner":"trailer","v":1,"type":"ready"}'], 'commands are not answered');
});

test('a page that is not framed, is framed by a website, or holds no valid key, asks nothing of YouTube, makes no player and sends nothing', () => {
  for (const options of [{framed: false}, {framed: false, loaded: true}, {ancestors: ['https://example.com']}, {ancestors: ['file://', 'https://example.com'], loaded: true},
    {ancestors: ['http://127.0.0.1:8080']}, {ancestors: ['HTTPS://LUMANEST.TV']}]) {
    const p = page(options);
    frame.start(p.window);
    assert.deepEqual(p.scripts, [], 'no YouTube API: ' + JSON.stringify(options));
    assert.equal(p.made.length, 0, JSON.stringify(options));
    assert.equal(p.window.onYouTubeIframeAPIReady, undefined, JSON.stringify(options));
    assert.equal(p.key(10009), false);
    assert.deepEqual(p.sent, []);
  }
  // The TV apps' parents (file://, an app scheme, an opaque origin), lumanest.tv itself, or an engine without
  // location.ancestorOrigins: the API is added and the player is made.
  for (const ancestors of [['file://'], ['null'], ['app://TunerTv001.Tuner'], ['https://lumanest.tv', 'file://'], []]) {
    const p = page({ancestors});
    frame.start(p.window);
    assert.deepEqual(p.scripts.map(script => script.src), ['https://www.youtube.com/iframe_api'], JSON.stringify(ancestors));
    p.window.onYouTubeIframeAPIReady();
    assert.equal(p.made.length, 1, JSON.stringify(ancestors));
  }
  assert.equal(frame.foreignAncestor(undefined), false);
  assert.equal(frame.foreignAncestor({}), false);

  for (const key of [null, '', 'short', 'L0fw0WzFaBM"', 'L0fw0WzFaBMx']) {
    for (const loaded of [false, true]) {
      const p = page({key, loaded});
      frame.start(p.window);
      assert.deepEqual(p.scripts, [], String(key));
      assert.equal(p.made.length, 0, String(key));
      assert.equal(p.window.onYouTubeIframeAPIReady, undefined);
    }
  }
});

test('loaded as a page script it starts by itself; in Node it only defines the rules', () => {
  const p = page({loaded: true});
  const context = load({document: p.window.document, addEventListener: p.window.addEventListener, parent: p.parent, YT: p.window.YT});
  assert.equal(p.made.length, 1);
  assert.equal(typeof context.onYouTubeIframeAPIReady, 'function');
  assert.deepEqual(p.scripts, []);
  const later = page();
  const waiting = load({document: later.window.document, addEventListener: later.window.addEventListener, parent: later.parent});
  assert.deepEqual(later.scripts.map(script => script.src), ['https://www.youtube.com/iframe_api']);
  assert.equal(typeof waiting.onYouTubeIframeAPIReady, 'function');
  assert.equal(load().onYouTubeIframeAPIReady, undefined);
});
