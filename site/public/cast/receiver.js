/*
 * LumaNest TV Google Cast Web Receiver.
 *
 * The provider sends live channels as raw MPEG-TS. Google's Cast framework (CAF v3) plays HLS, DASH and MP4 with its
 * own players and hands every other type to a plain <video> by setting `video.src = url`. Chrome on Cast devices
 * cannot demux MPEG-TS, so this receiver intercepts that one step on its own <video>: a LumaNest live cast link
 * (/api/cast/live.ts?t=...) goes to mpegts.js, which remuxes it to fragmented MP4 for Media Source Extensions. CAF
 * keeps doing everything else (LOAD/PAUSE/PLAY/STOP, volume, media status to the phone), because it still sees the
 * normal media events on its element. HLS and MP4 links are left to CAF untouched.
 *
 * This relies on CAF internals Google does not document (see docs/casting.md), so the page checks at runtime that
 * its hook was used and shows an error instead of a black screen if not.
 *
 * Constraints: ES2019 at most (1st/2nd-gen Chromecasts run Chrome 70, which has no optional chaining, nullish
 * coalescing or globalThis); no localStorage or cookies; never log a cast link, token or channel name.
 */
(function () {
  'use strict';

  var video = document.getElementById('player');
  var screen = document.getElementById('screen');
  var titleNode = document.getElementById('screen-title');
  var textNode = document.getElementById('screen-text');
  var actionNode = document.getElementById('screen-action');
  var eyebrowNode = document.getElementById('screen-eyebrow');
  var pill = document.getElementById('pill');
  var pillText = document.getElementById('pill-text');

  // ------------------------------------------------------------------ screen
  var MESSAGES = {
    expired: ['Cast link expired', 'For your security, a cast lasts up to 4 hours.', 'Cast this channel again from the LumaNest web player.'],
    signedout: ['Casting stopped', 'You signed out of the LumaNest web player.', 'Sign in again, then cast this channel again.'],
    refused: ['Your line didn\u2019t let the TV in', 'Your line may be busy on another screen. Stop playback on other devices.', 'Then cast this channel again.'],
    unavailable: ['Channel unavailable', 'This channel couldn\u2019t be loaded right now.', 'Choose another channel and cast again.'],
    unreachable: ['Connection lost', 'The TV couldn\u2019t reconnect to this channel.', 'Cast this channel again, or choose another one.'],
    format: ['Format not supported', 'This channel uses a video or audio format this TV can\u2019t play.', 'Try another channel, or use the LumaNest Tuner app.'],
    unsupported: ['This TV can\u2019t play live channels', 'Its Cast software has no Media Source support.', 'Use the LumaNest Tuner app on your TV instead.'],
    blocked: ['Can\u2019t play this link', 'LumaNest TV only plays channels sent from the LumaNest web player.', 'Open lumanest.tv/watch and cast a channel.'],
    update: ['Casting needs an update', 'Google changed the Cast software on this TV, and LumaNest can\u2019t play this channel on it right now.', 'Use the LumaNest Tuner app, or try again later.'],
    playback: ['This channel couldn\u2019t play', 'Your TV stopped this channel.', 'Cast it again, or choose another channel.'],
    startup: ['Casting couldn\u2019t start', 'The Google Cast software didn\u2019t load on this TV.', 'Restart the TV or Chromecast, then cast again.']
  };

  function showScreen(state, eyebrow, title, text, action) {
    screen.setAttribute('data-state', state);
    screen.className = 'screen';
    eyebrowNode.lastChild.nodeValue = ' ' + eyebrow;
    titleNode.textContent = title;
    textNode.textContent = text;
    actionNode.textContent = action || '';
  }
  function showIdle() {
    hidePill();
    showScreen('idle', 'LUMANEST TV', 'Ready to cast', 'Choose a channel in the LumaNest web player, then tap Cast to TV.');
  }
  function showLoading(name) {
    hidePill();
    showScreen('loading', 'TUNING IN', name || 'Your channel', 'Starting the stream on your TV\u2026');
  }
  function showError(kind) {
    var message = MESSAGES[kind] || MESSAGES.playback;
    hidePill();
    showScreen('error', 'LUMANEST TV', message[0], message[1], message[2]);
  }
  function hideScreen() {screen.className = 'screen hidden';}
  var pillTimer = 0;
  function showPill(text, delay) {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(function () {pillText.textContent = text; pill.className = 'pill';}, delay || 0);
  }
  function hidePill() {clearTimeout(pillTimer); pill.className = 'pill hidden';}

  // Diagnostics for chrome://inspect on registered devices: fixed words and numbers only, never links or names.
  function log(event, detail) {
    try {console.info('lumanest-receiver', event, typeof detail === 'number' ? detail : '');} catch { /* no console */ }
  }

  var framework = window.cast && window.cast.framework;
  if (!framework || !video) {showError('startup'); return;}
  var mpegts = window.mpegts;
  if (mpegts && mpegts.LoggingControl) {
    try {mpegts.LoggingControl.enableAll = false;} catch { /* older build */ }
  }

  // ------------------------------------------------------------------ cast links
  var TS_PATH = '/api/cast/live.ts';
  /** Only LumaNest cast links on this site are played; anything else is refused before CAF touches it. */
  function parseLink(value) {
    if (typeof value !== 'string' || !value) return null;
    var url;
    try {url = new URL(value, window.location.href);} catch {return null;}
    if (url.origin !== window.location.origin || url.pathname.indexOf('/api/cast/') !== 0 || !url.searchParams.get('t')) return null;
    return {href: url.href, ts: url.pathname === TS_PATH};
  }

  // ------------------------------------------------------------------ the upstream connection
  // mpegts.js's own fetch loader doesn't cancel a read on Chrome until another chunk arrives, so closing a stalled
  // stream would leave the provider connection open while the next one starts. This loader always aborts the request.
  var IDLE = 0, CONNECTING = 1, BUFFERING = 2, ERROR = 3, COMPLETE = 4;
  function ignore() { /* no listener */ }
  function cancelBody(response) {
    try {if (response.body) response.body.cancel().catch(ignore);} catch { /* already closed */ }
  }
  function CastStreamLoader() {
    this.type = 'lumanest-cast-stream';
    this.status = IDLE;
    this.needStashBuffer = false;
    this.generation = 0;         // bumped by abort(), so a request that was replaced or closed never reports back
    this.controller = null;
    this.reader = null;
    this.onContentLengthKnown = ignore;
    this.onURLRedirect = ignore;
    this.onDataArrival = ignore;
    this.onError = ignore;
    this.onComplete = ignore;
  }
  CastStreamLoader.prototype.isWorking = function () {return this.status === CONNECTING || this.status === BUFFERING;};
  CastStreamLoader.prototype.abort = function () {
    var controller = this.controller;
    var reader = this.reader;
    this.generation++;
    this.controller = null;
    this.reader = null;
    this.status = IDLE;
    if (controller) {try {controller.abort();} catch { /* already aborted */ }}
    if (reader) {try {reader.cancel().catch(ignore);} catch { /* already released */ }}
  };
  CastStreamLoader.prototype.destroy = function () {
    this.abort();
    this.onContentLengthKnown = this.onURLRedirect = this.onDataArrival = this.onError = this.onComplete = ignore;
  };
  CastStreamLoader.prototype.open = function (dataSource, range) {
    this.abort();
    var generation = this.generation;
    var from = range && range.from > 0 ? range.from : 0;
    var received = 0;
    var parsed = parseLink(dataSource && dataSource.url);
    var controller = new window.AbortController();
    var current = () => generation === this.generation;
    var report = (kind, code) => {
      if (!current()) return;
      this.abort();
      this.status = ERROR;
      this.onError(kind, {code: code, msg: ''});
    };
    this.controller = controller;
    this.status = CONNECTING;
    (async () => {
      if (!parsed || !parsed.ts) throw new Error('not a cast link');
      var response = await window.fetch(parsed.href, {
        method: 'GET', signal: controller.signal, credentials: 'omit', mode: 'same-origin', cache: 'no-store',
        referrerPolicy: 'no-referrer', redirect: 'error'
      });
      if (!current()) {cancelBody(response); return;}
      // Reported as the library's loader does, so onEngineError still gets 401/403/404 as NETWORK_STATUS_CODE_INVALID.
      if (!response.ok) {cancelBody(response); report(mpegts.LoaderErrors.HTTP_STATUS_CODE_INVALID, response.status); return;}
      if (!response.body) throw new Error('empty response');
      var reader = response.body.getReader();
      this.reader = reader;
      while (current()) {
        var result;
        try {result = await reader.read();} catch {report(mpegts.LoaderErrors.EARLY_EOF, -1); return;}
        if (!current()) return;
        if (result.done) {
          // The provider ended the stream; LOADING_COMPLETE makes the receiver reconnect.
          this.controller = null;
          this.reader = null;
          this.status = COMPLETE;
          this.onComplete(from, from + received - 1);
          return;
        }
        var value = result.value;
        if (!value || !value.byteLength) continue;
        this.status = BUFFERING;
        var start = from + received;
        received += value.byteLength;
        var whole = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;
        this.onDataArrival(whole ? value.buffer : value.slice().buffer, start, received);
      }
    })().catch(() => report(mpegts.LoaderErrors.EXCEPTION, -1));
  };

  // ------------------------------------------------------------------ mpegts.js session
  var CONFIG = {
    customLoader: CastStreamLoader,
    // Transmux on the page: the web player does the same, and MSE in workers needs a far newer Chrome.
    enableWorker: false,
    enableWorkerForMSE: false,
    enableStashBuffer: false,
    lazyLoad: false,
    // Cast builds cap MSE buffers (about 30 MB of H.264, 2 MB of AAC), so keep only a few seconds behind playback
    // and stay close to the live edge instead of letting the buffer grow.
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 8,
    liveBufferLatencyMinRemain: 3,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 12,
    autoCleanupMinBackwardDuration: 6
  };
  var RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

  var engine = null;          // the one mpegts.js player; never more than one upstream connection
  var link = '';              // the cast link mpegts.js plays, kept in memory only
  var owned = false;          // mpegts.js (not CAF's own player) is playing this element
  var internal = 0;           // > 0 while this script or mpegts.js changes the element itself
  var passError = false;      // lets our own "error" event through to CAF
  var wantPlaying = true;     // false after the phone sends PAUSE
  var suspended = false;      // paused long enough that the download was closed
  var failure = '';           // shown error; cleared by the next LOAD
  var generation = 0;         // counts LOAD requests, so a delayed stop never hits a newer channel
  var attempts = 0;
  var refusals = 0;
  var expiresAt = 0;          // when this cast link stops being accepted (from the sender), 0 if unknown
  var everPlayed = false;
  var lastTime = -1;
  var lastProgressAt = 0;
  var retryTimer = 0;
  var healthyTimer = 0;
  var suspendTimer = 0;
  var watchdog = 0;

  function clearTimers() {
    clearTimeout(retryTimer); retryTimer = 0;
    clearTimeout(healthyTimer); healthyTimer = 0;
    clearTimeout(suspendTimer); suspendTimer = 0;
    clearInterval(watchdog); watchdog = 0;
  }

  function closeEngine() {
    if (!engine) return;
    var old = engine;
    engine = null;
    internal++;
    // destroy() unloads (CastStreamLoader aborts the fetch even while a read is stalled, so the server closes the
    // upstream connection) and detaches the element.
    try {old.destroy();} catch {
      try {old.unload();} catch { /* already unloaded */ }
      try {old.detachMediaElement();} catch { /* already detached */ }
    }
    internal--;
  }

  function openEngine() {
    closeEngine();
    if (!mpegts || typeof mpegts.isSupported !== 'function' || !mpegts.isSupported()) {fail('unsupported'); return;}
    var player = null;
    var started = false;
    internal++;
    try {
      player = mpegts.createPlayer({type: 'mpegts', isLive: true, url: link, withCredentials: false}, CONFIG);
      engine = player;
      // Handled after mpegts.js finishes emitting: reacting may destroy this player, which must not happen mid-emit.
      player.on(mpegts.Events.ERROR, function (type, detail, info) {
        setTimeout(function () {if (engine === player) onEngineError(type, detail, info);}, 0);
      });
      // A live stream never completes; the provider closed the connection, so reconnect before the picture runs out.
      player.on(mpegts.Events.LOADING_COMPLETE, function () {
        setTimeout(function () {if (engine === player) retry('complete');}, 0);
      });
      player.attachMediaElement(video);
      player.load();
      started = true;
    } catch {
      log('engine_start_failed');
    }
    internal--;
    if (!started) {closeEngine(); retry('start'); return;}
    everPlayed = false;
    lastTime = -1;
    lastProgressAt = Date.now();
    if (!watchdog) watchdog = setInterval(checkProgress, 2000);
  }

  function playQuietly() {
    try {
      var started = video.play();
      if (started && typeof started.catch === 'function') started.catch(function () { /* CAF reports state */ });
    } catch { /* not ready yet; autoplay starts it */ }
  }

  function startSession(url) {
    endSession();
    owned = true;
    link = url;
    wantPlaying = true;
    suspended = false;
    attempts = 0;
    refusals = 0;
    hookUsed = true;
    log('session_start');
    openEngine();
  }

  function endSession() {
    clearTimers();
    if (!owned) return;
    owned = false;
    suspended = false;
    link = '';
    closeEngine();
    log('session_end');
  }

  /** Closes the download while the phone has paused; PLAY reopens it at the live edge. */
  function suspend() {
    clearTimeout(retryTimer); retryTimer = 0;
    clearTimeout(suspendTimer); suspendTimer = 0;
    suspended = true;
    closeEngine();
    showPill('Paused');
    log('suspended');
  }

  function retry(reason) {
    if (!owned || failure || retryTimer || suspended) return;
    // Reconnecting while paused would start playing again (CAF leaves autoplay on), so suspend instead.
    if (!wantPlaying) {suspend(); return;}
    if (attempts >= RETRY_DELAYS.length) {fail('unreachable'); return;}
    var delay = RETRY_DELAYS[attempts++];
    clearTimeout(healthyTimer); healthyTimer = 0;
    // Close the old connection now; the next one opens only after the delay.
    closeEngine();
    log('reconnect_' + reason, attempts);
    showPill('Reconnecting\u2026');
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      if (!owned || failure || suspended) return;
      if (!wantPlaying) {suspend(); return;}  // the phone paused while this reconnect was waiting
      openEngine();
      playQuietly();
    }, delay);
  }

  /** A decoder or Media Source failure that repeats before anything has played is a format this TV can't play. */
  function mediaFailed(reason) {
    if (attempts >= 2 && !everPlayed) fail('format');
    else retry(reason);
  }

  function onEngineError(type, detail, info) {
    var code = info && typeof info.code === 'number' ? info.code : 0;
    log('engine_error', code);
    if (type === mpegts.ErrorTypes.NETWORK_ERROR && detail === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID) {
      // 401: the web player signed out. 403: the cast link expired, or the provider refused the line (busy).
      if (code === 401) {fail('signedout'); return;}
      if (code === 403) {
        if (expiresAt && Date.now() >= expiresAt - 30000) {fail('expired'); return;}
        if (++refusals > 3) {fail(expiresAt ? 'refused' : 'expired'); return;}
      } else if (code === 400 || code === 404 || code === 410) {fail('unavailable'); return;}
    } else if (type === mpegts.ErrorTypes.MEDIA_ERROR) {
      if (detail === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED || detail === mpegts.ErrorDetails.MEDIA_CODEC_UNSUPPORTED) {fail('format'); return;}
      mediaFailed('error');
      return;
    }
    retry('error');
  }

  function checkProgress() {
    if (!owned || !engine || retryTimer || suspended || failure) return;
    var now = Date.now();
    var time = video.currentTime;
    if (!wantPlaying || time !== lastTime) {lastTime = time; lastProgressAt = now; return;}
    // No picture within 30 s of connecting, or frozen for 20 s while playing: reconnect.
    if (now - lastProgressAt > (everPlayed ? 20000 : 30000)) retry('stall');
  }

  /** Shows the error, stops downloading and tells CAF the media failed so the phone's Cast session updates too. */
  function fail(kind) {
    if (failure && failure !== 'playback') return;
    var current = generation;
    failure = kind;
    log('failed_' + kind);
    showError(kind);
    clearTimers();
    if (owned) {
      closeEngine();
      // CAF's plain-video player treats an "error" event as a failed load or playback and releases the element,
      // which ends this session through the removeAttribute hook below.
      passError = true;
      try {video.dispatchEvent(new Event('error'));} catch { /* very old engine */ }
      passError = false;
    }
    // If CAF didn't release the element (its internals changed), end the media explicitly.
    setTimeout(function () {
      if (current !== generation) return;
      if (owned) endSession();
      stopCafMedia();
    }, 3000);
  }

  // ------------------------------------------------------------------ the hook on CAF's media element
  var mediaProto = window.HTMLMediaElement.prototype;
  var srcDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'src');
  var nativeLoad = mediaProto.load;
  var nativeSetAttribute = window.Element.prototype.setAttribute;
  var nativeRemoveAttribute = window.Element.prototype.removeAttribute;
  var hookUsed = false;

  function takeOver(value) {
    if (internal) return null;
    var parsed = parseLink(typeof value === 'string' ? value : String(value));
    return parsed && parsed.ts ? parsed : null;
  }

  if (srcDescriptor && srcDescriptor.get && srcDescriptor.set) {
    Object.defineProperty(video, 'src', {
      configurable: true,
      enumerable: true,
      get: function () {return srcDescriptor.get.call(video);},
      set: function (value) {
        var parsed = takeOver(value);
        // A LumaNest TS link starts mpegts.js; blob: URLs (mpegts.js, Shaka), '' and other links go to the browser.
        if (parsed) startSession(parsed.href);
        else srcDescriptor.set.call(video, value);
      }
    });
  }
  video.setAttribute = function (name, value) {
    var parsed = String(name).toLowerCase() === 'src' ? takeOver(value) : null;
    if (parsed) {startSession(parsed.href); return undefined;}
    return nativeSetAttribute.call(video, name, value);
  };
  // CAF releases media with removeAttribute('src') + load(); mpegts.js itself does the same while detaching.
  video.removeAttribute = function (name) {
    if (!internal && owned && String(name).toLowerCase() === 'src') endSession();
    return nativeRemoveAttribute.call(video, name);
  };
  video.load = function () {
    // While mpegts.js owns the element, a reload would tear its Media Source down underneath it.
    if (owned && !internal) return undefined;
    return nativeLoad.call(video);
  };

  // Registered before CAF registers its own listeners, so these run first and can keep mpegts.js's internal
  // reconnects from looking like the end of the programme. mpegts.js itself does not listen to these events.
  video.addEventListener('ended', function (event) {
    if (!owned) return;
    event.stopImmediatePropagation();
    retry('ended');
  }, true);
  video.addEventListener('error', function (event) {
    if (!owned || passError) return;
    event.stopImmediatePropagation();
    // MEDIA_ERR_DECODE (3) and MEDIA_ERR_SRC_NOT_SUPPORTED (4) come from the TV's decoder or MSE parser, which
    // mpegts.js never reports itself, so they get the same rule as its MEDIA_ERROR.
    var code = video.error && typeof video.error.code === 'number' ? video.error.code : 0;
    log('media_error', code);
    if (code === 3 || code === 4) mediaFailed('media');
    else retry('media');
  }, true);
  video.addEventListener('pause', function (event) {
    // Pauses the phone didn't ask for come from reconnecting; CAF would report them as PAUSED.
    if (owned && wantPlaying) event.stopImmediatePropagation();
  }, true);

  // ------------------------------------------------------------------ screen follows playback
  video.addEventListener('playing', function () {
    hideScreen();
    hidePill();
    if (failure === 'playback') failure = '';
    if (!owned) return;
    everPlayed = true;
    lastProgressAt = Date.now();
    clearTimeout(healthyTimer);
    healthyTimer = setTimeout(function () {attempts = 0; refusals = 0;}, 60000);
  });
  video.addEventListener('waiting', function () {if (!retryTimer) showPill('Buffering\u2026', 1500);});
  video.addEventListener('pause', function () {if (!wantPlaying) showPill('Paused');});

  // ------------------------------------------------------------------ CAF
  var context = framework.CastReceiverContext.getInstance();
  var playerManager = context.getPlayerManager();
  var messages = framework.messages;
  var events = framework.events;
  var pendingLoad = false;
  var selfCheck = 0;
  // Live TS can't seek. Other links (movies and series as MP4, HLS) keep SEEK; CAF removes it itself for live HLS.
  var LIVE_COMMANDS = messages.Command.PAUSE | messages.Command.STREAM_VOLUME | messages.Command.STREAM_MUTE;
  var MEDIA_COMMANDS = LIVE_COMMANDS | messages.Command.SEEK;

  function stopCafMedia() {
    try {
      if (playerManager.getPlayerState() !== messages.PlayerState.IDLE) playerManager.stop();
    } catch { /* nothing loaded */ }
  }

  playerManager.setMessageInterceptor(messages.MessageType.LOAD, function (request) {
    var media = request && request.media;
    var parsed = media ? parseLink(media.contentUrl || media.contentId || '') : null;
    clearTimeout(selfCheck);
    generation++;
    failure = '';
    if (!parsed) {
      showError('blocked');
      failure = 'blocked';
      var error = new messages.ErrorData(messages.ErrorType.LOAD_FAILED);
      error.reason = messages.ErrorReason.INVALID_PARAMS;
      return error;
    }
    pendingLoad = true;
    playerManager.setSupportedMediaCommands(parsed.ts ? LIVE_COMMANDS : MEDIA_COMMANDS, false);
    var metadata = media.metadata;
    var name = metadata && typeof metadata.title === 'string' ? metadata.title.slice(0, 80) : '';
    showLoading(name);
    media.contentUrl = parsed.href;
    if (parsed.ts) {
      media.contentType = 'video/mp2t';
      media.streamType = messages.StreamType.LIVE;
      var custom = media.customData;
      expiresAt = custom && typeof custom.expiresAt === 'number' ? custom.expiresAt : 0;
      // Self-check: CAF should hand this link to the src hook within moments. If an SDK update changed that, say so
      // instead of leaving a black screen.
      hookUsed = false;
      selfCheck = setTimeout(function () {
        if (!hookUsed && (!failure || failure === 'playback')) {log('hook_unused'); failure = ''; fail('update');}
      }, 10000);
    }
    return request;
  });
  playerManager.setMessageInterceptor(messages.MessageType.PAUSE, function (request) {
    wantPlaying = false;
    if (owned) {
      clearTimeout(suspendTimer);
      // mpegts.js keeps downloading a paused live stream. At high bitrates that fills Cast's small MSE buffer within
      // seconds, after which it never resumes the download, and it keeps the line busy: close the download soon and
      // reopen it at the live edge on PLAY.
      suspendTimer = setTimeout(function () {
        if (!owned || wantPlaying || failure) return;
        suspend();
      }, 5000);
    }
    return request;
  });
  playerManager.setMessageInterceptor(messages.MessageType.PLAY, function (request) {
    wantPlaying = true;
    clearTimeout(suspendTimer); suspendTimer = 0;
    hidePill();
    if (owned && suspended) {
      suspended = false;
      attempts = 0;
      openEngine();
    }
    return request;
  });

  playerManager.addEventListener(events.EventType.PLAYER_LOAD_COMPLETE, function () {pendingLoad = false;});
  playerManager.addEventListener(events.EventType.ERROR, function (event) {
    // Recoverable errors (for example a Shaka segment retry) don't stop playback.
    if (event && event.severity === events.ErrorSeverity.RECOVERABLE) return;
    pendingLoad = false;
    if (!failure) {failure = 'playback'; showError('playback');}
  });
  playerManager.addEventListener(events.EventType.REQUEST_STOP, function () {endSession();});
  playerManager.addEventListener(events.EventType.MEDIA_FINISHED, function (event) {
    if (pendingLoad || (event && event.endedReason === 'INTERRUPTED')) return;
    endSession();
    if (!failure) showIdle();
  });

  var options = new framework.CastReceiverOptions();
  options.mediaElement = video;
  // Live TS goes to mpegts.js and HLS to Shaka, so Google's older Media Player Library is never needed. Shaka is
  // asked for explicitly: CAF otherwise picks the HLS player from platform flags, and MPL never loads here.
  options.skipMplLoad = true;
  options.useShakaForHls = true;
  options.supportedCommands = LIVE_COMMANDS;
  options.statusText = 'LumaNest TV';
  try {context.setLoggerLevel(framework.LoggerLevel.NONE);} catch { /* default level */ }
  context.start(options);
  showIdle();
})();
