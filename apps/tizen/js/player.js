/* Samsung AVPlay and a dependency-free HTML video fallback. Times are milliseconds.
 * AVPlay reference: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 */
(function (root) {
  'use strict';

  var nativeOwners = [];
  var dualManagers = [];
  var dualOwner = null;
  var WAIT_MS = 30000;
  var PROGRESS_POLL_MS = 5000;

  function number(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function ownerRecord(manager) {
    var i;
    for (i = 0; i < nativeOwners.length; i += 1) {
      if (nativeOwners[i].manager === manager) { return nativeOwners[i]; }
    }
    var record = { manager: manager, owner: null, dual: false, appliedMuted: null, audioActive: false };
    nativeOwners.push(record);
    return record;
  }

  function create(options) {
    options = options || {};
    var av = options.nativePlayer !== undefined ? options.nativePlayer : root.webapis && root.webapis.avplay;
    if (av && typeof av.open !== 'function' && av.avplay) { av = av.avplay; }
    var ownership = av ? ownerRecord(av) : null;
    var muted = !!options.mute;
    var audioPending = options.mute !== undefined || !!options.multiviewResource || !!(av && av.enableAudioStream);
    var video = options.videoElement;
    var object = options.objectElement;
    var state = { status: 'idle', position: 0, duration: 0, request: null, error: '' };
    var api = { state: state };
    var token = 0;
    var sources = [];
    var sourceIndex = 0;
    var wantedPlaying = false;
    var suspended = false;
    var nativeSuspended = false;
    var prepared = false;
    var buffering = false;
    var ended = false;
    var operation = '';
    var activeSeek = null;
    var queuedSeek = null;
    var queuedTracks = {};
    var trackCache = { audio: [], subtitles: [] };
    var rect = { left: 0, top: 0, width: 1920, height: 1080 };
    var watchdog = null;
    var progressTimer = null;
    var progressAt = 0;
    var nativePosition = 0;
    var callbackPosition = 0;
    var progressConfirmed = false;
    var silentReopenUsed = false;
    var htmlListeners = [];

    function emit(status, error) {
      if (status) { state.status = status; }
      if (typeof error === 'string') { state.error = error; }
      if (options.onState) {
        options.onState({ status: state.status, position: state.position,
          duration: state.duration, request: state.request, error: state.error });
      }
    }

    function time(position, duration) {
      state.position = Math.max(0, number(position, state.position));
      state.duration = Math.max(0, number(duration, state.duration));
      if (options.onTime) { options.onTime(state.position, state.duration); }
    }

    function current(t) { return t === token && !!state.request; }
    function nativeState() {
      try { return av.getState(); } catch (ignore) { return 'NONE'; }
    }
    function clearWait() {
      if (watchdog !== null) { root.clearTimeout(watchdog); watchdog = null; }
    }
    function progressClock() {
      return root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();
    }
    function clearProgress() {
      if (progressTimer !== null) { root.clearTimeout(progressTimer); progressTimer = null; }
    }
    function noteProgress(position, fromCallback) {
      var previous = fromCallback ? callbackPosition : nativePosition;
      if (fromCallback) { callbackPosition = position; } else { nativePosition = position; }
      // Keep each clock's own cursor, including live timestamp discontinuities.
      // A muted player may omit callbacks while its readable native clock advances.
      if (position > previous) {
        progressAt = progressClock(); progressConfirmed = true;
        buffering = false; clearWait();
      }
    }
    function startProgress(t) {
      if (!av || progressTimer !== null || !current(t) || !wantedPlaying || suspended ||
          !prepared || operation || buffering || ended || ownership.owner !== api) { return; }
      progressAt = progressClock();
      nativePosition = state.position; callbackPosition = state.position;
      function poll() {
        progressTimer = null;
        if (!current(t) || !wantedPlaying || suspended || !prepared || operation || ended ||
            ownership.owner !== api) { return; }
        // Do not call AVPlay during prepare/seek/restore or when native playback is paused.
        if (nativeState() !== 'PLAYING' || buffering) { progressAt = progressClock(); }
        else {
          try {
            var position = number(av.getCurrentTime(), -1);
            if (position >= 0) {
              noteProgress(position, false);
              if (position > state.position) { time(position, state.duration); }
            }
          } catch (ignoreProgressRead) { /* Advancing callbacks still prove playback is healthy. */ }
          if (progressClock() - progressAt >= WAIT_MS) {
            rememberPosition();
            if (progressConfirmed && !silentReopenUsed) {
              // Close this stream before reopening the same pooled decoder. The peer stays playing.
              silentReopenUsed = true; openSource(state.position);
            } else { fail(t, 'The video stopped responding. Please retry or choose another channel.'); }
            return;
          }
        }
        if (current(t) && wantedPlaying && !suspended) { progressTimer = root.setTimeout(poll, PROGRESS_POLL_MS); }
      }
      progressTimer = root.setTimeout(poll, PROGRESS_POLL_MS);
    }
    function startWait(t) {
      if (watchdog !== null || !wantedPlaying || suspended || !current(t)) { return; }
      watchdog = root.setTimeout(function () {
        watchdog = null;
        if (current(t) && wantedPlaying && !suspended) {
          fail(t, 'The stream took too long to respond. Please try again.');
        }
      }, WAIT_MS);
    }
    function report(message) { if (options.onError) { options.onError(message); } }

    function mediaRect(element, visible) {
      if (!element || !element.style) { return; }
      element.style.display = visible ? 'block' : 'none';
      element.style.position = 'fixed';
      element.style.left = (rect.left / 19.2) + '%';
      element.style.top = (rect.top / 10.8) + '%';
      element.style.width = (rect.width / 19.2) + '%';
      element.style.height = (rect.height / 10.8) + '%';
      element.style.background = 'transparent';
      element.style.objectFit = 'contain';
    }
    function displayRect() {
      mediaRect(object, !!av && !!state.request);
      mediaRect(video, !av && !!state.request);
      if (av && !operation && !suspended && ownership.owner === api) {
        var s = nativeState();
        if (s === 'IDLE' || s === 'READY' || s === 'PLAYING' || s === 'PAUSED') {
          try { av.setDisplayRect(rect.left, rect.top, rect.width, rect.height); } catch (ignore) {}
        }
      }
    }

    function rememberPosition() {
      if (!state.request || state.request.live) { return; }
      try {
        if (av && prepared && !operation && !nativeSuspended && ownership.owner === api) {
          state.position = Math.max(state.position, number(av.getCurrentTime(), state.position));
        } else if (!av && video && prepared) {
          state.position = Math.max(0, number(video.currentTime * 1000, state.position));
        }
      } catch (ignore) {}
    }
    function removeHtmlListeners() {
      var i;
      for (i = 0; i < htmlListeners.length; i += 1) {
        video.removeEventListener(htmlListeners[i][0], htmlListeners[i][1]);
      }
      htmlListeners = [];
    }
    function closeMedia() {
      clearWait();
      clearProgress();
      if (av) {
        if (ownership.owner === api) {
          // close is legal in every AVPlay state and cancels pending preparation.
          try { av.close(); } catch (ignore) {}
          ownership.appliedMuted = null;
          ownership.audioActive = false;
        }
      } else if (video) {
        removeHtmlListeners();
        try { video.pause(); } catch (ignorePause) {}
        try { video.removeAttribute('src'); video.load(); } catch (ignoreLoad) {}
      }
      prepared = false;
      buffering = false;
      operation = '';
      activeSeek = null;
      nativeSuspended = false;
    }
    function terminal(t, message) {
      if (!current(t)) { return; }
      token += 1;
      closeMedia();
      wantedPlaying = false;
      queuedSeek = null;
      emit('error', message);
      report(message);
    }
    function fail(t, message) {
      if (!current(t)) { return; }
      rememberPosition();
      if (sourceIndex + 1 < sources.length) {
        sourceIndex += 1;
        openSource(state.position);
      } else {
        terminal(t, message || 'This stream could not be played. Try another source or retry.');
      }
    }
    function friendlyError(error) {
      var type = typeof error === 'string' ? error : (error && error.name) || '';
      if (/NOT_SUPPORTED|NotSupported|FORMAT|FILE/.test(type)) {
        return 'This TV cannot play this stream format. Try another source.';
      }
      return 'This stream is unavailable right now. Try another source or retry.';
    }
    function sourceAllowed(url) {
      return /^(https?:\/\/|file:\/\/)/i.test(url) || (!av && /^(blob:|data:video\/)/i.test(url));
    }
    function boundPosition(position) {
      var p = Math.max(0, Math.round(number(position, 0)));
      return state.duration > 0 ? Math.min(p, Math.max(0, state.duration - 250)) : p;
    }
    function readDuration() {
      try { state.duration = Math.max(0, number(av.getDuration(), 0)); } catch (ignore) {}
    }
    function finish(t) {
      if (!current(t) || suspended || ended) { return; }
      clearWait();
      clearProgress();
      if (state.request.live) {
        fail(t, 'The live stream ended. Choose another channel or retry.');
        return;
      }
      ended = true;
      wantedPlaying = false;
      state.position = state.duration || state.position;
      emit('paused');
      time(state.position, state.duration);
      if (options.onEnded) { options.onEnded(); }
    }

    function nativeTracks() {
      var total, selected, i, item, extra, key, label, language;
      trackCache = { audio: [], subtitles: [] };
      try { total = av.getTotalTrackInfo() || []; selected = av.getCurrentStreamInfo() || []; }
      catch (ignore) { return; }
      for (i = 0; i < total.length; i += 1) {
        item = total[i];
        key = item.type === 'AUDIO' ? 'audio' : (item.type === 'TEXT' ? 'subtitles' : '');
        if (!key) { continue; }
        try { extra = JSON.parse(item.extra_info || '{}'); } catch (ignoreJson) { extra = {}; }
        language = extra.language || extra.track_lang || extra.lang || '';
        label = extra.track_name || extra.title || language || (key === 'audio' ? 'Audio ' : 'Subtitle ') + (trackCache[key].length + 1);
        trackCache[key].push({ index: item.index, language: language, label: label, selected: false });
      }
      for (i = 0; i < selected.length; i += 1) {
        item = selected[i];
        key = item.type === 'AUDIO' ? 'audio' : (item.type === 'TEXT' ? 'subtitles' : '');
        if (key) { markTrack(key, item.index); }
      }
    }
    function markTrack(key, index) {
      var i;
      for (i = 0; i < trackCache[key].length; i += 1) {
        trackCache[key][i].selected = trackCache[key][i].index === index;
      }
    }
    function applyTracks() {
      if (!av || !prepared || operation || suspended) { return; }
      var s = nativeState(), key, index;
      for (key in queuedTracks) {
        if (Object.prototype.hasOwnProperty.call(queuedTracks, key)) {
          index = queuedTracks[key];
          // Samsung only allows AUDIO selection while PLAYING. Keep a paused choice until resume.
          if (key === 'audio' && s !== 'PLAYING') { continue; }
          if (s !== 'PLAYING' && s !== 'PAUSED') { continue; }
          try {
            if (key === 'subtitles' && index === -1) { av.setSilentSubtitle(true); }
            else {
              av.setSelectTrack(key === 'audio' ? 'AUDIO' : 'TEXT', index);
              if (key === 'subtitles') { av.setSilentSubtitle(false); }
            }
            markTrack(key, index);
          } catch (ignore) { report('This track is not supported by this stream.'); }
          delete queuedTracks[key];
        }
      }
    }
    function rememberPeerSilence() {
      // Samsung automatically silences the other active instance. Remember
      // that change: disabling it again can throw InvalidAccessError on TV.
      for (var i = 0; i < nativeOwners.length; i += 1) {
        var peer = nativeOwners[i], peerState = '';
        if (peer !== ownership && peer.owner && peer.audioActive && peer.appliedMuted !== true) {
          try { peerState = peer.manager.getState(); } catch (ignorePeerState) {}
          if (/^(IDLE|READY|PLAYING|PAUSED)$/.test(peerState)) { peer.appliedMuted = true; }
        }
      }
    }
    function forgetAudioState() {
      ownership.appliedMuted = null;
      // A thrown enable may already have silenced the previous player. Its
      // cached route cannot suppress the real enable needed during rollback.
      for (var i = 0; i < nativeOwners.length; i += 1) {
        var peer = nativeOwners[i];
        if (peer !== ownership && peer.owner && peer.audioActive) { peer.appliedMuted = null; }
      }
    }
    function applyAudio(force) {
      if (!audioPending || !av || ownership.owner !== api || suspended || (!force && operation)) { return; }
      if (ownership.appliedMuted === muted) { audioPending = false; return; }
      if (!force && options.mainAudioOnly && options.mainAudioOnly()) { audioPending = false; return; }
      var method = muted ? 'disableAudioStream' : 'enableAudioStream';
      if (typeof av[method] !== 'function') { throw new Error('DualAudioUnsupported'); }
      try { av[method](); }
      catch (error) {
        forgetAudioState();
        if (options.multiviewResource && prepared && !suspended && options.onAudioError) { options.onAudioError(); }
        throw error;
      }
      ownership.appliedMuted = muted;
      if (!muted) { rememberPeerSilence(); }
      audioPending = false;
    }
    function syncIntent(t) {
      if (!current(t) || !prepared || suspended || operation) { return; }
      try {
        var s = nativeState();
        try { applyAudio(false); }
        catch (audioError) {
          if (options.mainAudioOnly && options.mainAudioOnly()) {
            terminal(t, 'This TV needs the channel to be the main picture for audio.');
            return;
          }
          throw audioError;
        }
        if (wantedPlaying) {
          if (s !== 'PLAYING') { av.play(); }
          applyTracks();
          emit(buffering ? 'loading' : 'playing');
          startProgress(t);
        } else {
          if (s === 'READY') { av.play(); s = 'PLAYING'; }
          if (s === 'PLAYING') { av.pause(); }
          clearWait();
          clearProgress();
          emit('paused');
        }
      } catch (error) { fail(t, friendlyError(error)); }
    }
    function drainNative(t) {
      if (!current(t) || suspended) { return; }
      displayRect();
      if (queuedSeek !== null) {
        var target = queuedSeek;
        queuedSeek = null;
        nativeSeek(t, target);
      } else { syncIntent(t); }
    }
    function nativeSeek(t, position) {
      if (!current(t)) { return; }
      if (operation || !prepared) { queuedSeek = position; return; }
      var target = boundPosition(position);
      clearProgress();
      operation = 'seek';
      activeSeek = target;
      if (wantedPlaying) { emit('loading'); startWait(t); }
      function complete(success) {
        if (!current(t)) { return; }
        operation = '';
        activeSeek = null;
        if (success) { ended = false; time(target, state.duration); }
        else { report('Seeking is not supported at this position.'); }
        drainNative(t);
      }
      try { av.seekTo(target, function () { complete(true); }, function () { complete(false); }); }
      catch (ignore) { complete(false); }
    }
    function nativeOpen(t, start) {
      operation = 'prepare';
      try {
        av.open(sources[sourceIndex]);
        if (options.mainAudioOnly && options.mainAudioOnly()) { muted = options.multiviewResource === 'sub'; }
        // A newly opened MAIN already has default audio. Avoid re-routing it.
        ownership.appliedMuted = options.multiviewResource === 'main' ? false : null;
        ownership.audioActive = true;
        if (options.multiviewResource) {
          try {
            // Samsung's multiview sample disables SUB audio in IDLE before
            // assigning its video resource. MAIN keeps the default audio.
            audioPending = true;
            applyAudio(true);
            av.setStreamingProperty('IN_APP_MULTIVIEW', options.multiviewResource === 'sub' ?
              'VIDEO_VIEW_RESOURCE_SUB' : 'VIDEO_VIEW_RESOURCE_MAIN');
          } catch (unsupported) {
            terminal(t, 'Dual view is not supported by this TV. You can watch either channel on its own.');
            return;
          }
        } else if (audioPending || typeof av.enableAudioStream === 'function') {
          // Restoring single playback after dual view must restore its audio.
          // Old TVs may expose a stub for this newer API; ordinary video still works.
          audioPending = true;
          try { applyAudio(true); } catch (ignoreSingleAudio) { audioPending = false; }
        }
        av.setListener({
          onbufferingstart: function () {
            if (!current(t) || suspended) { return; }
            buffering = true;
            clearProgress();
            emit(wantedPlaying ? 'loading' : 'paused'); startWait(t);
          },
          onbufferingprogress: function () { if (current(t)) { startWait(t); } },
          onbufferingcomplete: function () {
            if (!current(t) || suspended || !prepared || operation) { return; }
            buffering = false; clearWait(); emit(wantedPlaying ? 'playing' : 'paused');
            startProgress(t);
          },
          oncurrentplaytime: function (position) {
            if (!current(t) || suspended || operation || !prepared) { return; }
            if (wantedPlaying) { noteProgress(Math.max(0, number(position, 0)), true); }
            time(position, state.duration);
            if (wantedPlaying && state.status !== 'playing') { emit('playing'); }
            startProgress(t);
          },
          onstreamcompleted: function () { finish(t); },
          onerror: function (error) { if (!suspended) { fail(t, friendlyError(error)); } },
          onerrormsg: function (error) { if (!suspended) { fail(t, friendlyError(error)); } },
          onresourceconflicted: function () { if (!suspended) { fail(t, 'Playback was interrupted by another TV app. Please retry.'); } }
        });
        av.setDisplayRect(rect.left, rect.top, rect.width, rect.height);
        try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (ignoreDisplay) {}
        try { av.setTimeoutForBuffering(30); } catch (ignoreTimeout) {}
        av.prepareAsync(function () {
          if (!current(t) || suspended) { return; }
          operation = '';
          prepared = true;
          readDuration();
          // No language filtering: all tracks the TV supports remain available.
          if (!state.request.live && start > 0 && queuedSeek === null) { queuedSeek = start; }
          drainNative(t);
          if (current(t) && !operation) { nativeTracks(); }
        }, function (error) { if (!suspended) { fail(t, friendlyError(error)); } });
      } catch (error) { fail(t, friendlyError(error)); }
    }

    function htmlTrackInfo() {
      var groups = { audio: video.audioTracks || [], subtitles: video.textTracks || [] };
      var key, list, i, item;
      trackCache = { audio: [], subtitles: [] };
      for (key in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, key)) { continue; }
        list = groups[key];
        for (i = 0; i < list.length; i += 1) {
          item = list[i];
          trackCache[key].push({ index: i, language: item.language || '',
            label: item.label || item.language || (key === 'audio' ? 'Audio ' : 'Subtitle ') + (i + 1),
            selected: key === 'audio' ? !!item.enabled : item.mode === 'showing' });
        }
      }
    }
    function htmlPlay(t) {
      if (!current(t) || suspended || !prepared || !wantedPlaying) { return; }
      startWait(t);
      try {
        var result = video.play();
        if (result && result.then) {
          result.then(function () {
            if (!current(t)) { return; }
            if (!wantedPlaying || suspended) { video.pause(); }
          }, function (error) {
            if (!current(t) || !wantedPlaying || suspended) { return; }
            if (error && error.name === 'NotAllowedError') {
              wantedPlaying = false; clearWait(); emit('paused');
              report('Press Play to start the video.');
            } else if (!error || error.name !== 'AbortError') { fail(t, friendlyError(error)); }
          });
        }
      } catch (error) { fail(t, friendlyError(error)); }
    }
    function htmlOpen(t, start) {
      if (!video) { terminal(t, 'Video playback is not available on this device.'); return; }
      function listen(name, fn) {
        var listener = function () { if (current(t)) { fn(); } };
        htmlListeners.push([name, listener]); video.addEventListener(name, listener);
      }
      listen('loadedmetadata', function () {
        prepared = true;
        time(state.position, isFinite(video.duration) ? video.duration * 1000 : 0);
        var target = queuedSeek !== null ? queuedSeek : start;
        queuedSeek = null;
        if (!state.request.live && target > 0) {
          try { video.currentTime = boundPosition(target) / 1000; time(boundPosition(target), state.duration); }
          catch (ignoreSeek) { report('This stream could not restore its previous position.'); }
        }
        htmlTrackInfo();
        if (wantedPlaying) { htmlPlay(t); } else { clearWait(); emit('paused'); }
      });
      listen('playing', function () {
        if (suspended || !wantedPlaying) { video.pause(); return; }
        clearWait(); emit('playing');
      });
      listen('pause', function () {
        if (prepared && !wantedPlaying) { clearWait(); emit('paused'); }
      });
      listen('waiting', function () {
        if (wantedPlaying && !suspended) { emit('loading'); startWait(t); }
      });
      listen('stalled', function () { if (wantedPlaying && !suspended) { startWait(t); } });
      listen('timeupdate', function () {
        if (suspended) { return; }
        var p = number(video.currentTime * 1000, state.position);
        if (p > state.position && wantedPlaying) { clearWait(); }
        time(p, isFinite(video.duration) ? video.duration * 1000 : 0);
      });
      listen('ended', function () { finish(t); });
      listen('error', function () { if (!suspended) { fail(t, 'This browser cannot play this stream. Try another source.'); } });
      video.preload = 'auto'; video.controls = false;
      video.muted = muted;
      video.src = sources[sourceIndex]; video.load();
    }
    function openSource(position) {
      var t = ++token;
      closeMedia();
      trackCache = { audio: [], subtitles: [] };
      queuedTracks = {};
      ended = false;
      progressConfirmed = false;
      state.position = state.request.live ? 0 : Math.max(0, number(position, 0));
      state.duration = 0;
      emit(wantedPlaying ? 'loading' : 'paused', '');
      displayRect();
      if (suspended) { return; }
      var url = sources[sourceIndex];
      if (!sourceAllowed(url || '')) {
        fail(t, /^(magnet:|torrent:)/i.test(url || '') ?
          'Torrent files need an HTTP or debrid stream on Samsung TV. Choose another source.' :
          'Choose a valid HTTP video stream.');
        return;
      }
      startWait(t);
      if (av) { nativeOpen(t, state.position); } else { htmlOpen(t, state.position); }
    }

    api.play = function (request) {
      request = request || {};
      if (av && !options.multiviewResource && dualOwner) { dualOwner.stop(); }
      if (av && ownership.owner && ownership.owner !== api) { ownership.owner.stop(); }
      if (av) { ownership.owner = api; ownership.dual = !!options.multiviewResource; }
      token += 1;
      closeMedia();
      state.request = request;
      wantedPlaying = true;
      ended = false;
      suspended = false;
      queuedSeek = null;
      sources = [];
      var raw = [request.url].concat(request.backups || []), i, url;
      for (i = 0; i < raw.length; i += 1) {
        url = typeof raw[i] === 'string' ? raw[i].replace(/^\s+|\s+$/g, '') : (raw[i] && raw[i].url);
        if (url && sources.indexOf(url) === -1) { sources.push(url); }
      }
      sourceIndex = 0;
      silentReopenUsed = false;
      openSource(request.startPosition || 0);
    };
    api.pause = function () {
      if (!state.request || state.status === 'error') { return; }
      wantedPlaying = false;
      clearWait();
      clearProgress();
      if (!suspended && prepared && !operation) {
        if (av) { syncIntent(token); } else { video.pause(); }
      }
      if (state.status !== 'error') { emit('paused'); }
    };
    api.resume = function () {
      if (!state.request) { return; }
      if (state.status === 'error') { sourceIndex = 0; silentReopenUsed = false; wantedPlaying = true; openSource(state.position); return; }
      wantedPlaying = true;
      if (suspended) { return; }
      if (ended) { ended = false; api.seekTo(0); }
      startWait(token);
      if (!prepared) { emit('loading'); }
      else if (av) { syncIntent(token); }
      else { htmlPlay(token); }
    };
    api.toggle = function () { if (wantedPlaying) { api.pause(); } else { api.resume(); } };
    api.seek = function (deltaMs) {
      var base = queuedSeek !== null ? queuedSeek : (activeSeek !== null ? activeSeek : state.position);
      api.seekTo(base + number(deltaMs, 0));
    };
    api.seekTo = function (position) {
      if (!state.request || state.request.live || state.status === 'error') { return false; }
      var target = boundPosition(position);
      if (suspended || !prepared || operation) { queuedSeek = target; return true; }
      if (av) { nativeSeek(token, target); }
      else {
        try { video.currentTime = target / 1000; ended = false; time(target, state.duration); }
        catch (ignore) { report('Seeking is not supported at this position.'); return false; }
      }
      return true;
    };
    api.stop = function () {
      token += 1;
      closeMedia();
      if (ownership && ownership.owner === api) { ownership.owner = null; }
      wantedPlaying = false; suspended = false; queuedSeek = null; ended = false;
      sources = []; trackCache = { audio: [], subtitles: [] }; queuedTracks = {};
      state.request = null;
      time(0, 0); emit('idle', ''); displayRect();
    };
    api.setRect = function (value) {
      value = value || {};
      rect.left = Math.min(1919, Math.max(0, Math.round(number(value.left, 0))));
      rect.top = Math.min(1079, Math.max(0, Math.round(number(value.top, 0))));
      rect.width = Math.min(1920 - rect.left, Math.max(1, Math.round(number(value.width, 1920))));
      rect.height = Math.min(1080 - rect.top, Math.max(1, Math.round(number(value.height, 1080))));
      displayRect();
    };
    api.tracks = function () {
      if (prepared && !suspended && !operation) {
        if (av) { nativeTracks(); } else if (video) { htmlTrackInfo(); }
      }
      return { audio: trackCache.audio.slice(), subtitles: trackCache.subtitles.slice() };
    };
    api.setMuted = function (value, quiet) {
      var previousMuted = muted, previousPending = audioPending;
      if (av && state.request && options.mainAudioOnly && options.mainAudioOnly()) {
        var defaultMuted = options.multiviewResource === 'sub';
        if (!!value !== defaultMuted || (prepared && ownership.appliedMuted !== defaultMuted)) { return false; }
      }
      muted = !!value;
      if (!av) { if (video) { video.muted = muted; } return true; }
      audioPending = true;
      if (!prepared || suspended || operation || ownership.owner !== api) { return true; }
      try { applyAudio(false); return true; }
      catch (ignore) {
        muted = previousMuted;
        audioPending = previousPending || ownership.appliedMuted !== muted;
        if (!quiet) { report('This TV could not switch the audio. Please retry.'); }
        return false;
      }
    };
    api.selectTrack = function (type, index) {
      var key = /^(audio|AUDIO)$/.test(type) ? 'audio' : (/^(subtitles|subtitle|TEXT)$/.test(type) ? 'subtitles' : '');
      if (!key || !state.request) { return false; }
      var i, found = key === 'subtitles' && index === -1;
      for (i = 0; i < trackCache[key].length; i += 1) { if (trackCache[key][i].index === index) { found = true; } }
      if (!found) { return false; }
      if (av) { queuedTracks[key] = index; applyTracks(); }
      else {
        var list = key === 'audio' ? video.audioTracks : video.textTracks;
        for (i = 0; list && i < list.length; i += 1) {
          if (key === 'audio') { list[i].enabled = i === index; }
          else { list[i].mode = i === index ? 'showing' : 'disabled'; }
        }
        markTrack(key, index);
      }
      return true;
    };
    api.suspend = function () {
      if (!state.request || suspended || state.status === 'error') { return; }
      rememberPosition();
      suspended = true;
      if (ownership && ownership.owner === api) { ownership.audioActive = false; }
      clearWait();
      clearProgress();
      if (av && prepared && !operation) {
        try { av.suspend(); nativeSuspended = true; }
        catch (ignore) { token += 1; closeMedia(); }
      } else if (av) { token += 1; closeMedia(); }
      else if (video) { video.pause(); }
      emit('paused');
    };
    api.restore = function () {
      if (!state.request || !suspended) { return; }
      suspended = false;
      if (av && nativeSuspended && typeof av.restoreAsync === 'function') {
        var t = token;
        operation = 'restore';
        emit(wantedPlaying ? 'loading' : 'paused'); startWait(t);
        try {
          av.restoreAsync(null, state.request.live ? null : state.position, false, function () {
            if (!current(t) || suspended) { return; }
            operation = ''; nativeSuspended = false; prepared = true;
            ownership.audioActive = true;
            readDuration(); drainNative(t);
          }, function () { if (current(t) && !suspended) { openSource(state.position); } });
        } catch (ignore) { openSource(state.position); }
      } else if (av || !prepared) { openSource(state.position); }
      else if (wantedPlaying) { htmlPlay(token); }
      else { emit('paused'); }
    };

    if (object && object.setAttribute) { object.setAttribute('type', 'application/avplayer'); }
    displayRect();
    return api;
  }

  function platformVersion() {
    var version = '';
    try { version = root.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (ignore) {}
    if (!version && root.navigator) {
      var match = /Tizen[ \/]([\d.]+)/i.exec(root.navigator.userAgent || '');
      if (match) { version = match[1]; }
    }
    return number(parseFloat(version), 0);
  }

  function createDual(options) {
    options = options || {};
    var api = {}, players = [], i;
    var native = !!(root.webapis && root.webapis.avplay);
    var store = root.webapis && root.webapis.avplaystore;
    var version = platformVersion();
    var capability = { supported: true, native: native, reason: '', requiresMainAudio: false, audioReason: '' };
    var audioSlot = 0;
    var closed = false;
    if (native && ((version && version < 7) || !store || typeof store.getPlayer !== 'function')) {
      capability.supported = false;
      capability.reason = 'Dual view needs a Samsung TV with Tizen 7 or later and support for two video surfaces.';
    }
    if (native && capability.supported) {
      try {
        // Retain and reuse exactly two instances. AVPlayStore has an instance
        // quota and no destroyPlayer API; reopening a tab must not allocate more.
        for (i = dualManagers.length; i < 2; i += 1) {
          var manager = store.getPlayer();
          if (manager && typeof manager.open !== 'function' && manager.avplay) { manager = manager.avplay; }
          dualManagers.push(manager);
        }
        for (i = 0; i < 2; i += 1) {
          if (!dualManagers[i] || typeof dualManagers[i].setStreamingProperty !== 'function' ||
              typeof dualManagers[i].enableAudioStream !== 'function' || typeof dualManagers[i].disableAudioStream !== 'function') {
            throw new Error('DualUnsupported');
          }
        }
        if (dualManagers[0] === dualManagers[1]) { throw new Error('DualUnsupported'); }
      } catch (ignoreManagers) {
        capability.supported = false;
        capability.reason = 'This TV could not create two video surfaces. You can watch either channel on its own.';
      }
    }
    api.capability = capability;
    function errorState(slot, request) {
      if (options.onState) { options.onState(slot, { status: 'error', position: 0, duration: 0, request: request, error: capability.reason }); }
      if (options.onError) { options.onError(slot, capability.reason); }
    }
    function makePlayer(slot) {
      return create({ nativePlayer: native ? dualManagers[slot] : null,
        multiviewResource: native ? (slot === 0 ? 'main' : 'sub') : '', mute: slot !== audioSlot,
        mainAudioOnly: function () { return capability.requiresMainAudio; },
        onAudioError: function () {
          capability.requiresMainAudio = true;
          capability.audioReason = 'This TV needs the channel to be the main picture for audio.';
        },
        objectElement: (options.objectElements || [])[slot], videoElement: (options.videoElements || [])[slot],
        onState: function (state) { if (options.onState) { options.onState(slot, state); } },
        onTime: function (position, duration) { if (options.onTime) { options.onTime(slot, position, duration); } },
        onEnded: function () { if (options.onEnded) { options.onEnded(slot); } },
        onError: function (message) { if (options.onError) { options.onError(slot, message); } }
      });
    }
    if (capability.supported) { players = [makePlayer(0), makePlayer(1)]; }
    api.play = function (slot, request) {
      if (slot !== 0 && slot !== 1) { return false; }
      if (!capability.supported) { errorState(slot, request); return false; }
      if (native && dualOwner && dualOwner !== api) { dualOwner.stop(); }
      if (native) {
        for (i = 0; i < nativeOwners.length; i += 1) {
          if (!nativeOwners[i].dual && nativeOwners[i].owner) { nativeOwners[i].owner.stop(); }
        }
        dualOwner = api;
      }
      closed = false;
      players[slot].setMuted(slot !== audioSlot);
      players[slot].play(request);
      return true;
    };
    api.setRects = function (rects) {
      for (var slot = 0; slot < players.length; slot += 1) { players[slot].setRect((rects || [])[slot]); }
    };
    api.selectAudio = function (slot) {
      if ((slot !== 0 && slot !== 1) || !capability.supported) { return false; }
      if (!players[slot].state.request || /^(idle|error)$/.test(players[slot].state.status)) { return false; }
      if (native && capability.requiresMainAudio && slot !== 0) { return false; }
      var previous = audioSlot, enabled;
      // enableAudioStream automatically silences the other active instance.
      // Enable the chosen player first so a failure retains the previous audio.
      enabled = players[slot].setMuted(false, true);
      if (enabled && players[1 - slot].setMuted(true, true)) {
        audioSlot = slot;
        return true;
      }
      // Do not probe or re-enable after native errors. Some firmware applies
      // the route, throws, then freezes its playback clock on further calls.
      if (!native || !capability.requiresMainAudio) {
        if (enabled) { players[1 - previous].setMuted(true, true); }
        players[previous].setMuted(false, true);
      }
      if (options.onError) { options.onError(slot, capability.audioReason || 'This TV could not switch the audio. Please retry.'); }
      return false;
    };
    api.stop = function () {
      if (closed) { return; }
      closed = true;
      for (var slot = 0; slot < players.length; slot += 1) { players[slot].stop(); }
      // Both native streams are closed before resetting audio intent. A safe
      // restart always opens the chosen channel as MAIN with default audio.
      audioSlot = 0;
      if (players.length === 2) { players[0].setMuted(false, true); players[1].setMuted(true, true); }
      if (dualOwner === api) { dualOwner = null; }
    };
    api.suspend = function () { for (var slot = 0; slot < players.length; slot += 1) { players[slot].suspend(); } };
    api.restore = function () {
      for (var slot = 0; slot < players.length; slot += 1) { players[slot].restore(); }
      api.selectAudio(audioSlot);
    };
    return api;
  }

  root.TunerPlayer = { create: create, createDual: createDual };
}(window));
