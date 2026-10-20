// The trailer player for the Samsung and LG apps (docs/extras.md, "Trailer in the app"), loaded by the page at
// https://lumanest.tv/embed/trailer?v=1&k=<key> (app/embed/trailer/route.ts), which the apps show in a full-screen
// iframe. YouTube refuses embeds without an https origin and Referer, and the apps run from file:// or an app scheme,
// so the player lives on this page and talks to the app with postMessage, as JSON strings:
//   to the app (target "*": the app's origin may be file:// or null):
//     {"tuner":"trailer","v":1,"type":"ready"}, {..."type":"state","state":"playing"},
//     {..."type":"error","code":150}, {..."type":"key","key":"back"}
//   from the app, acted on only when event.source is the parent window:
//     {"tuner":"trailer","v":1,"type":"toggle"|"play"|"pause"|"stop"}, {..."type":"seek","by":-10|10}
// Nothing else is ever sent: no address, no title. The script adds YouTube's IFrame API (www.youtube.com/iframe_api)
// itself, and only when it is to make the player (start, below). ES5 only, as it runs in the TV's own web engine
// (Samsung from Tizen 2.3, LG from webOS 3). The rules are pure functions on LumaNestTrailerFrame so tests can run them
// in Node.
(function (root) {
  'use strict';

  var TUNER = 'trailer';
  var VERSION = 1;
  var ORIGIN = 'https://lumanest.tv';
  var YOUTUBE_API = 'https://www.youtube.com/iframe_api';
  var KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  var MAX_MESSAGE = 200;
  var COMMANDS = {toggle: true, play: true, pause: true, stop: true, seek: true};
  // YT.PlayerState values.
  var STATE_NAMES = {'-1': 'unstarted', '0': 'ended', '1': 'playing', '2': 'paused', '3': 'buffering', '5': 'cued'};
  var STATES = {unstarted: true, playing: true, paused: true, buffering: true, ended: true, cued: true};
  var KEYS = {back: true, enter: true, playpause: true, play: true, pause: true, stop: true, left: true, right: true, up: true, down: true};
  // Key codes first: TV engines report remote keys by code (Samsung Back 10009, LG Back 461), often with no key name.
  var KEY_CODES = {
    8: 'back', 27: 'back', 461: 'back', 10009: 'back', 13: 'enter',
    10252: 'playpause', 179: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 178: 'stop',
    37: 'left', 39: 'right', 38: 'up', 40: 'down', 412: 'left', 417: 'right'
  };
  var KEY_NAMES = {
    Escape: 'back', Esc: 'back', Backspace: 'back', GoBack: 'back', BrowserBack: 'back', Enter: 'enter',
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop', MediaRewind: 'left', MediaFastForward: 'right',
    ArrowLeft: 'left', Left: 'left', ArrowRight: 'right', Right: 'right', ArrowUp: 'up', Up: 'up', ArrowDown: 'down', Down: 'down'
  };

  function own(object, name) {
    return Object.prototype.hasOwnProperty.call(object, name);
  }

  // Runs action and returns what it threw, or null: a player that has gone away must not break the page.
  function attempt(action) {
    try {
      action();
    } catch (error) {
      return error || true;
    }
    return null;
  }

  function validKey(key) {
    return typeof key === 'string' && KEY_PATTERN.test(key);
  }

  // The app's command as {type} or {type: 'seek', by}, or null for anything that is not exactly the contract's shape.
  function parseCommand(data) {
    var value, size;
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
    if (attempt(function () {value = JSON.parse(data);})) return null;
    if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') return null;
    if (value.tuner !== TUNER || value.v !== VERSION || typeof value.type !== 'string' || !own(COMMANDS, value.type)) return null;
    size = Object.keys(value).length;
    if (value.type === 'seek') {
      if (size !== 4 || !own(value, 'by') || (value.by !== -10 && value.by !== 10)) return null;
      return {type: 'seek', by: value.by};
    }
    return size === 3 ? {type: value.type} : null;
  }

  // The JSON string of one event for the app, or null for anything outside the contract.
  function buildEvent(type, detail) {
    var event = {tuner: TUNER, v: VERSION, type: type};
    if (type === 'ready') {
      if (detail !== undefined) return null;
    } else if (type === 'state') {
      if (typeof detail !== 'string' || !own(STATES, detail)) return null;
      event.state = detail;
    } else if (type === 'error') {
      if (errorCode(detail) !== detail) return null;
      event.code = detail;
    } else if (type === 'key') {
      if (typeof detail !== 'string' || !own(KEYS, detail)) return null;
      event.key = detail;
    } else {
      return null;
    }
    return JSON.stringify(event);
  }

  function stateName(code) {
    return typeof code === 'number' && own(STATE_NAMES, String(code)) ? STATE_NAMES[String(code)] : null;
  }

  // YouTube's onError code as a whole number, or null.
  function errorCode(data) {
    if (typeof data === 'string' && /^[0-9]{1,6}$/.test(data)) data = Number(data);
    return typeof data === 'number' && isFinite(data) && data >= 0 && data <= 999999 && Math.floor(data) === data ? data : null;
  }

  function keyName(event) {
    var code;
    if (!event) return null;
    code = event.keyCode || event.which;
    if (typeof code === 'number' && own(KEY_CODES, String(code))) return KEY_CODES[String(code)];
    return typeof event.key === 'string' && own(KEY_NAMES, event.key) ? KEY_NAMES[event.key] : null;
  }

  // Steps in a row: a step asked for less than SEEK_CHAIN ms after the last one goes on from where that one was to
  // land while the player does not yet report being within SEEK_NEAR seconds of it, because getCurrentTime() keeps the
  // old position until a seek has loaded; from getCurrentTime() alone, quick presses would land on the same spot.
  var SEEK_CHAIN = 3000;
  var SEEK_NEAR = 5;

  // Where the next step starts: the last step's target (last = {target, at}, in ms) or the player's position.
  function seekFrom(current, last, now) {
    var since;
    if (!last || typeof last.target !== 'number' || !isFinite(last.target)) return current;
    since = now - last.at;
    if (!(since >= 0 && since < SEEK_CHAIN)) return current;
    if (typeof current === 'number' && isFinite(current) && Math.abs(current - last.target) <= SEEK_NEAR) return current;
    return last.target;
  }

  // Where a 10-second step lands: never before the start, never past the end when the duration is known.
  function seekTarget(current, duration, by) {
    var target = (typeof current === 'number' && isFinite(current) && current > 0 ? current : 0) + by;
    if (typeof duration === 'number' && isFinite(duration) && duration > 0 && target > duration) target = duration;
    return target < 0 ? 0 : target;
  }

  // last (optional): the page's memory of its last step, {target, at}, updated here; now: the time in ms.
  function applyCommand(player, command, last, now) {
    var state, target;
    if (command.type === 'toggle') {
      state = player.getPlayerState();
      if (state === 1 || state === 3) player.pauseVideo();
      else player.playVideo();
    } else if (command.type === 'play') {
      player.playVideo();
    } else if (command.type === 'pause') {
      player.pauseVideo();
    } else if (command.type === 'stop') {
      player.stopVideo();
    } else if (command.type === 'seek') {
      target = seekTarget(seekFrom(player.getCurrentTime(), last, now), player.getDuration(), command.by);
      player.seekTo(target, true);
      if (last) {
        last.target = target;
        last.at = now;
      }
    }
  }

  // Whether a page that has framed this one, at any level, is a website other than lumanest.tv. The TV apps frame it
  // from file:// or an app scheme; a website must not borrow lumanest.tv as the origin of its YouTube embeds. Engines
  // without location.ancestorOrigins are not checked.
  function foreignAncestor(location) {
    var list = location && location.ancestorOrigins;
    var i;
    if (!list || typeof list.length !== 'number') return false;
    for (i = 0; i < list.length; i++) {
      if (/^https?:/i.test(String(list[i])) && String(list[i]) !== ORIGIN) return true;
    }
    return false;
  }

  function start(window) {
    var document = window.document;
    var element = document.getElementById('player');
    var key = element ? element.getAttribute('data-k') : null;
    var framed = !!window.parent && window.parent !== window;
    var player = null;
    var ready = false;
    var lastSeek = {target: null, at: 0};
    // Only inside the TV apps' overlay: opened on its own, or framed by a website, the page stays black and loads
    // nothing from YouTube.
    if (!validKey(key) || !framed || foreignAncestor(window.location)) return;

    function send(type, detail) {
      var message = buildEvent(type, detail);
      if (message && framed) window.parent.postMessage(message, '*');
    }

    function create() {
      if (player || !window.YT || typeof window.YT.Player !== 'function') return;
      player = new window.YT.Player(element, {
        host: 'https://www.youtube-nocookie.com',
        videoId: key,
        width: '100%',
        height: '100%',
        playerVars: {autoplay: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: ORIGIN, enablejsapi: 1},
        events: {
          onReady: function () {
            ready = true;
            // The app keeps the focus; the player's own frame must never take it.
            attempt(function () {
              var frame = player.getIframe();
              if (frame) frame.setAttribute('tabindex', '-1');
            });
            send('ready');
            attempt(function () {player.playVideo();});
          },
          onStateChange: function (event) {
            var name = stateName(event ? event.data : null);
            if (name) send('state', name);
          },
          onError: function (event) {
            var code = errorCode(event ? event.data : null);
            if (code !== null) send('error', code);
          }
        }
      });
    }

    window.onYouTubeIframeAPIReady = create;
    window.addEventListener('message', function (event) {
      var command;
      if (!framed || event.source !== window.parent || !player || !ready) return;
      command = parseCommand(event.data);
      if (command) attempt(function () {applyCommand(player, command, lastSeek, new Date().getTime());});
    }, false);
    // Keys belong to the app, which keeps the focus; one that reaches this page anyway goes back to it, so Back
    // always closes the trailer.
    document.addEventListener('keydown', function (event) {
      var name = keyName(event);
      if (!name) return;
      if (event.preventDefault) event.preventDefault();
      send('key', name);
    }, false);
    // YouTube's IFrame API only now, once the page is to make the player: opened on its own or framed by a website,
    // the page asks nothing of YouTube.
    if (window.YT && window.YT.loaded) create();
    else loadApi(document);
  }

  function loadApi(document) {
    var script = document.createElement('script');
    script.src = YOUTUBE_API;
    (document.body || document.documentElement).appendChild(script);
  }

  root.LumaNestTrailerFrame = {
    parseCommand: parseCommand, buildEvent: buildEvent, stateName: stateName, errorCode: errorCode, keyName: keyName,
    seekFrom: seekFrom, seekTarget: seekTarget, validKey: validKey, foreignAncestor: foreignAncestor, applyCommand: applyCommand, start: start
  };
  if (root.document && root.addEventListener) start(root);
}(this));
