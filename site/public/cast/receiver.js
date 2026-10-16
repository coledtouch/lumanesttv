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
  function screenShown() {return screen.className === 'screen';}
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
  // mpegts.js is loaded once the Cast framework has started (receiver.html preloads it), so a launch never waits for
  // its 275 KB to download and compile. A cast that arrives sooner waits in openEngine().
  var mpegts = null;
  var library = 'loading';    // 'ready' or 'failed' once the script has run

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

  // ------------------------------------------------------------------ joining connections into one stream
  // The loader below reconnects without restarting mpegts.js, so one demuxer gets the bytes of several connections.
  // A cut can fall anywhere, and the next connection may resend what came before it (a provider's start-up burst) or
  // start later. Fed as it is, mpegts.js 1.8.2 loses packet sync for good after a partial packet, gives the last frame
  // a negative duration when time goes back, and holds it frozen over the whole gap when time jumps ahead. So this
  // filter passes only whole 188-byte packets, holds each audio or video PES back until the next one starts (a cut
  // never leaves half a frame), drops PES the demuxer already has and, after a jump, shifts the new connection's
  // timestamps so it continues right after the last frame, from a keyframe where the stream marks them. A connection
  // that carries other streams (the provider switched source or encoder) can't continue the timeline: it is flagged
  // as changed, and the receiver starts mpegts.js over.
  var PACKET = 188;
  var TICKS = 90000;               // the MPEG-TS clock: 90 kHz, 33 bits
  var WRAP = 8589934592;
  var KEYFRAME_WAIT = 1.5 * TICKS; // most new video dropped while waiting for a keyframe
  // Content on other streams without the anchor stream: the streams changed. Longer than a GOP, because a restarted
  // stream-copy relay sends audio at once and video only from the next keyframe.
  var ANCHOR_WAIT = 6 * TICKS;
  var ANCHOR_BYTES = 2097152;      // the same in bytes, for streams without timestamps
  var RESENT_LIMIT = 60 * TICKS;   // a clock further back than this restarted; it isn't a resend
  var SMALL_GAP = TICKS / 2;       // a gap mpegts.js may bridge by showing the last frame a little longer
  var RAW_PROBE = 4096;            // unaligned bytes on the first connection before mpegts.js gets them as they are
  function wrap(ticks) {ticks %= WRAP; return ticks < 0 ? ticks + WRAP : ticks;}
  function ticksAfter(a, b) {var d = wrap(a - b); return d > WRAP / 2 ? d - WRAP : d;}
  function readStamp(p, i) {
    return (p[i] & 0x0e) * 536870912 + p[i + 1] * 4194304 + (p[i + 2] & 0xfe) * 16384 + p[i + 3] * 128 + (p[i + 4] >>> 1);
  }
  function writeStamp(p, i, ticks) {
    p[i] = (p[i] & 0xf0) | ((Math.floor(ticks / 1073741824) & 0x07) << 1) | 1;
    p[i + 1] = Math.floor(ticks / 4194304) & 0xff;
    p[i + 2] = ((Math.floor(ticks / 32768) & 0x7f) << 1) | 1;
    p[i + 3] = Math.floor(ticks / 128) & 0xff;
    p[i + 4] = ((ticks & 0x7f) << 1) | 1;
  }
  function hasPcr(p) {return (p[3] & 0x20) !== 0 && p[4] >= 7 && (p[5] & 0x10) !== 0;}
  // mpegts.js reads the PCR to detect the 33-bit wrap, so it moves with the timestamps.
  function shiftPcr(p, ticks) {
    var base = wrap(p[6] * 33554432 + p[7] * 131072 + p[8] * 512 + p[9] * 2 + (p[10] >>> 7) - ticks);
    p[6] = Math.floor(base / 33554432) & 0xff;
    p[7] = Math.floor(base / 131072) & 0xff;
    p[8] = Math.floor(base / 512) & 0xff;
    p[9] = Math.floor(base / 2) & 0xff;
    p[10] = (p[10] & 0x7f) | ((base & 1) << 7);
  }
  function findSync(data, from) {
    for (var i = from; i + 2 * PACKET < data.length; i++) {
      if (data[i] === 0x47 && data[i + PACKET] === 0x47 && data[i + 2 * PACKET] === 0x47) return i;
    }
    return -1;
  }
  function wholeBuffer(view) {
    return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view.buffer : view.slice().buffer;
  }
  function joinPackets(list) {
    var bytes = new Uint8Array(list.length * PACKET);
    for (var i = 0; i < list.length; i++) bytes.set(list[i], i * PACKET);
    return bytes.buffer;
  }

  function TsSplicer() {
    this.streams = {};           // pid -> the last PES passed on for that audio or video stream, over all connections
    this.offset = 0;             // ticks taken off this connection's timestamps and PCR
    this.raw = false;            // not 188-byte TS: bytes go to mpegts.js untouched, and a cut ends the stream
    this.aligned = false;        // a packet boundary was ever found
    this.connections = 0;
  }
  /** Starts a new connection; whatever was half received on the last one is dropped. */
  TsSplicer.prototype.connect = function () {
    var streams = this.streams;
    var anchor = null;
    Object.keys(streams).forEach(function (pid) {
      var stream = streams[pid];
      if (stream.last < 0) return;
      if (!anchor || (stream.video && !anchor.video) || (stream.video === anchor.video && stream.count > anchor.count)) anchor = stream;
    });
    this.connections++;
    this.anchor = anchor;        // the stream (video if there is one) that places this connection on the timeline
    this.placed = !anchor;
    this.keyWait = -1;
    this.units = {};             // pid -> the PES being received
    this.carry = null;           // the start of a packet that continues in the next chunk
    this.synced = false;
    this.wasted = 0;             // bytes dropped before this connection was placed
    this.found = false;          // the anchor stream came on this connection
    this.probe = null;           // the first timed PES of another stream, to measure content while the anchor is missing
    this.programs = null;        // PMT pid -> read yet, from this connection's PAT
    this.listed = {};            // pids the PMTs of this connection list
    this.changed = false;        // this connection carries other streams: mpegts.js has to start over
  };
  /** Takes one chunk off the network; returns whole packets for mpegts.js, or null. */
  TsSplicer.prototype.push = function (chunk) {
    var data = chunk;
    if (this.carry) {
      data = new Uint8Array(this.carry.length + chunk.length);
      data.set(this.carry);
      data.set(chunk, this.carry.length);
      this.carry = null;
    }
    if (this.raw) return wholeBuffer(data);
    var first = this.connections === 1 && !this.aligned;
    var out = [];
    var i = 0;
    while (i + PACKET <= data.length) {
      if (!this.synced || data[i] !== 0x47) {
        if (this.synced) log('ts_resync');
        this.synced = false;
        var found = findSync(data, i);
        if (found < 0) {
          // A first connection that never lines up is left to mpegts.js: 192/204-byte TS, or not TS at all.
          if (first && data.length >= RAW_PROBE) {this.raw = true; log('ts_raw'); return wholeBuffer(data);}
          var keep = first ? i : Math.max(i, data.length - 2 * PACKET);
          this.wasted += keep - i;
          i = keep;
          break;
        }
        this.wasted += found - i;
        i = found;
        this.synced = this.aligned = true;
        first = false;
      }
      this.packet(data.subarray(i, i + PACKET), out);
      i += PACKET;
    }
    if (i < data.length) this.carry = data.slice(i);
    return out.length && !this.changed ? joinPackets(out) : null;
  };
  /** At the end of a first connection that never lined up, its bytes go to mpegts.js so it can tell what they are. */
  TsSplicer.prototype.finish = function () {
    if (this.connections !== 1 || this.aligned || !this.carry) return null;
    var rest = this.carry;
    this.carry = null;
    this.raw = true;
    return wholeBuffer(rest);
  };
  TsSplicer.prototype.packet = function (p, out) {
    if (this.changed) return;
    var pid = ((p[1] & 0x1f) << 8) | p[2];
    var control = (p[3] >>> 4) & 3;
    var at = control & 2 ? 5 + p[4] : 4;
    if (!this.placed && (p[1] & 0x40) && (control & 1) && (pid === 0 || (this.programs && this.programs[pid] === false))) {
      this.table(p, pid, at);
      if (this.changed) return;
    }
    var unit = this.units[pid];
    if ((p[1] & 0x40) && (control & 1) && at + 9 <= PACKET && p[at] === 0 && p[at + 1] === 0 && p[at + 2] === 1) {
      var id = p[at + 3];
      if (id === 0xbd || (id >= 0xc0 && id <= 0xef)) {
        if (unit) this.release(unit, out);
        var stream = this.streams[pid];
        if (!stream) stream = this.streams[pid] = {video: id >= 0xe0, last: -1, out: -1, step: 0, count: 0, marked: false};
        var flags = p[at + 7] >>> 6;
        var key = (control & 2) !== 0 && p[4] > 0 && (p[5] & 0x40) !== 0;
        unit = this.units[pid] = {stream: stream, packets: [p], at: at, flags: flags, dts: -1, key: key};
        if (flags === 3 && at + 19 <= PACKET) unit.dts = readStamp(p, at + 14);
        else if ((flags & 2) && at + 14 <= PACKET) unit.dts = readStamp(p, at + 9);
        return;
      }
    }
    if (unit) unit.packets.push(p);
    else if (!this.streams[pid]) this.emit(p, out);
    // Otherwise it is the end of a PES that began before this connection, which the demuxer can't use.
  };
  /** Passes on one whole PES, unless the demuxer already has it or this connection isn't placed yet. */
  TsSplicer.prototype.release = function (unit, out) {
    var stream = unit.stream;
    if (unit.key) stream.marked = true;
    if (!this.placed && !this.place(unit)) {
      this.wasted += unit.packets.length * PACKET;
      if (!this.found && this.wasted > ANCHOR_BYTES) this.change('splice_anchor_missing');
      return;
    }
    if (unit.dts >= 0) {
      var time = wrap(unit.dts - this.offset);
      if (stream.out >= 0) {
        var step = ticksAfter(time, stream.out);
        if (step <= 0) return;   // resent
        if (step < TICKS) stream.step = step;
      }
      stream.out = time;
      stream.last = unit.dts;
      if (this.offset) {
        var first = unit.packets[0];
        if ((unit.flags & 2) && unit.at + 14 <= PACKET) writeStamp(first, unit.at + 9, wrap(readStamp(first, unit.at + 9) - this.offset));
        if (unit.flags === 3 && unit.at + 19 <= PACKET) writeStamp(first, unit.at + 14, time);
      }
    }
    stream.count++;
    for (var i = 0; i < unit.packets.length; i++) this.emit(unit.packets[i], out);
  };
  /** Finds where a new connection continues the stream, from the first PES of the anchor stream. */
  TsSplicer.prototype.place = function (unit) {
    var anchor = this.anchor;
    if (unit.stream !== anchor || unit.dts < 0) {
      // The other streams wait for the anchor. If it hasn't come with this much of them, the streams changed.
      if (unit.dts >= 0 && !this.found) {
        var probe = this.probe;
        if (!probe) this.probe = {stream: unit.stream, dts: unit.dts};
        else if (unit.stream === probe.stream && ticksAfter(unit.dts, probe.dts) > ANCHOR_WAIT) this.change('splice_anchor_missing');
      }
      return false;
    }
    this.found = true;
    var gap = ticksAfter(unit.dts, anchor.last);
    if (gap > -RESENT_LIMIT && gap <= Math.max(anchor.step * 1.5, SMALL_GAP)) {
      // The same clock, resent or just after the last frame: release() drops whatever the demuxer already has.
      this.placed = true;
      log('splice_same', Math.round(gap / 900) / 100);
      return true;
    }
    // A jump ahead, or a restarted clock: continue right after the last frame, from a keyframe if one comes soon.
    if (anchor.video && anchor.marked && !unit.key) {
      if (this.keyWait < 0) this.keyWait = unit.dts;
      if (ticksAfter(unit.dts, this.keyWait) < KEYFRAME_WAIT) return false;
    }
    this.offset = wrap(unit.dts - anchor.out - (anchor.step || TICKS / 25));
    this.placed = true;
    log('splice_jump', Math.round(gap / 900) / 100);
    return true;
  };
  TsSplicer.prototype.emit = function (p, out) {
    if (hasPcr(p)) {
      if (!this.placed) return;
      if (this.offset) shiftPcr(p, this.offset);
    }
    out.push(p);
  };
  /**
   * Reads the PAT and PMTs of a connection that isn't placed yet. If they no longer list a stream that played, the
   * provider switched source or encoder, and this connection can't continue the demuxer's timeline. Only a whole,
   * single section in one packet is read; a longer map is left to the anchor checks in place() and release().
   */
  TsSplicer.prototype.table = function (p, pid, at) {
    if (at >= PACKET) return;
    var s = at + 1 + p[at];      // after the pointer field
    if (s + 12 > PACKET) return;
    var end = s + 3 + (((p[s + 1] & 0x0f) << 8) | p[s + 2]);
    if (end > PACKET || !(p[s + 5] & 1) || p[s + 6] !== 0 || p[s + 7] !== 0) return;
    end -= 4;                    // the CRC
    var programs = this.programs;
    var i;
    if (pid === 0) {
      if (p[s] !== 0 || programs) return;
      programs = this.programs = {};
      for (i = s + 8; i + 4 <= end; i += 4) {
        if (p[i] || p[i + 1]) programs[((p[i + 2] & 0x1f) << 8) | p[i + 3]] = false;   // program 0 is the network
      }
      return;
    }
    if (p[s] !== 2) return;
    var listed = this.listed;
    for (i = s + 12 + (((p[s + 10] & 0x0f) << 8) | p[s + 11]); i + 5 <= end; i += 5 + (((p[i + 3] & 0x0f) << 8) | p[i + 4])) {
      listed[((p[i + 1] & 0x1f) << 8) | p[i + 2]] = true;
    }
    programs[pid] = true;
    if (Object.keys(programs).some(function (key) {return !programs[key];})) return;
    var streams = this.streams;
    if (Object.keys(streams).some(function (key) {return streams[key].last >= 0 && !listed[key];})) this.change('splice_map_changed');
  };
  TsSplicer.prototype.change = function (event) {
    if (!this.changed) log(event);
    this.changed = true;
  };

  // ------------------------------------------------------------------ the upstream connection
  // mpegts.js's own fetch loader doesn't cancel a read on Chrome until another chunk arrives, so closing a stalled
  // stream would leave the provider connection open while the next one starts. This loader always aborts the request.
  // It also rejoins the stream by itself when a connection ends, breaks or goes quiet, while the picture already
  // buffered keeps playing; only repeated failures and changed streams reach mpegts.js, and so the receiver's retry()
  // below.
  var IDLE = 0, CONNECTING = 1, BUFFERING = 2, ERROR = 3, COMPLETE = 4;
  var QUIET_MS = 8000;             // no bytes for this long: the connection is dead even if it is still open
  var STARVED_MS = 2000;           // the same once the picture has run out and waits for data
  var FIRST_BYTE_MS = 15000;       // a new connection that has sent nothing by then
  var REJOIN_WINDOW_MS = 20000;
  var REJOIN_DELAYS = [0, 500, 1500];  // one per failure within the window; the next failure is reported
  var REJOIN_SPAN_MS = 120000;
  var REJOIN_LIMIT = 6;            // rejoins within REJOIN_SPAN_MS: a line that keeps dropping goes to retry()
  var WASTE_LIMIT = 8388608;       // bytes a new connection may drop while finding its place
  var FINAL_STATUS = {400: true, 401: true, 403: true, 404: true, 410: true};
  var starved = false;             // the picture ran out and waits for data (set by hold())
  function ignore() { /* no listener */ }
  function cancelBody(response) {
    try {if (response.body) response.body.cancel().catch(ignore);} catch { /* already closed */ }
  }
  function CastStreamLoader() {
    this.type = 'lumanest-cast-stream';
    this.status = IDLE;
    this.needStashBuffer = false;
    this.generation = 0;         // bumped by every connection and by abort(), so a replaced one never reports back
    this.controller = null;
    this.reader = null;
    this.timer = 0;              // the wait before rejoining
    this.watchdog = 0;           // checks the current connection for quiet
    this.openedAt = 0;           // when the current connection started, and when it last sent bytes (0: not yet)
    this.lastByteAt = 0;
    this.href = '';
    this.splicer = null;
    this.sent = 0;               // bytes handed to mpegts.js over all connections
    this.failures = [];          // when connections failed, for the rejoin limit
    this.rejoins = [];           // when this loader rejoined, for REJOIN_LIMIT
    this.onContentLengthKnown = ignore;
    this.onURLRedirect = ignore;
    this.onDataArrival = ignore;
    this.onError = ignore;
    this.onComplete = ignore;
  }
  CastStreamLoader.prototype.isWorking = function () {return this.status === CONNECTING || this.status === BUFFERING;};
  CastStreamLoader.prototype.close = function () {
    var controller = this.controller;
    var reader = this.reader;
    this.generation++;
    this.controller = null;
    this.reader = null;
    clearTimeout(this.timer); this.timer = 0;
    clearInterval(this.watchdog); this.watchdog = 0;
    if (controller) {try {controller.abort();} catch { /* already aborted */ }}
    if (reader) {try {reader.cancel().catch(ignore);} catch { /* already released */ }}
  };
  CastStreamLoader.prototype.abort = function () {
    this.close();
    this.status = IDLE;
  };
  CastStreamLoader.prototype.destroy = function () {
    this.abort();
    this.onContentLengthKnown = this.onURLRedirect = this.onDataArrival = this.onError = this.onComplete = ignore;
  };
  CastStreamLoader.prototype.open = function (dataSource, range) {
    this.abort();
    var parsed = parseLink(dataSource && dataSource.url);
    this.href = parsed && parsed.ts ? parsed.href : '';
    this.splicer = new TsSplicer();
    this.sent = range && range.from > 0 ? range.from : 0;
    this.failures = [];
    this.rejoins = [];
    this.status = CONNECTING;
    this.connect();
  };
  CastStreamLoader.prototype.connect = function () {
    var generation = ++this.generation;
    var controller = new window.AbortController();
    var splicer = this.splicer;
    var current = () => generation === this.generation;
    this.controller = controller;
    this.reader = null;
    this.openedAt = Date.now();
    this.lastByteAt = 0;
    splicer.connect();
    this.watchdog = setInterval(() => this.checkQuiet(generation), 500);
    (async () => {
      if (!this.href) throw new Error('not a cast link');
      // Same-origin credentials let the request reuse the page's own connection (the receiver has no cookies).
      var response = await window.fetch(this.href, {
        method: 'GET', signal: controller.signal, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store',
        referrerPolicy: 'no-referrer', redirect: 'error'
      });
      if (!current()) {cancelBody(response); return;}
      if (!response.ok) {cancelBody(response); this.failed(generation, 'status', response.status); return;}
      if (!response.body) throw new Error('empty response');
      var reader = response.body.getReader();
      this.reader = reader;
      for (;;) {
        var result;
        try {result = await reader.read();} catch {this.failed(generation, 'read'); return;}
        if (!current()) return;
        if (result.done) {
          var rest = splicer.finish();
          if (rest) this.deliver(rest);
          this.failed(generation, 'end');
          return;
        }
        var value = result.value;
        if (!value || !value.byteLength) continue;
        this.lastByteAt = Date.now();
        this.status = BUFFERING;
        var data = splicer.push(value);
        if (splicer.changed) {this.failed(generation, 'changed'); return;}
        if (data) this.deliver(data);
        if (!current()) return;  // mpegts.js closed the loader while taking the data
        if (splicer.wasted > WASTE_LIMIT) {this.failed(generation, 'lost'); return;}
      }
    })().catch(() => this.failed(generation, 'error'));
  };
  CastStreamLoader.prototype.checkQuiet = function (generation) {
    var limit = QUIET_MS;
    if (!this.lastByteAt) limit = FIRST_BYTE_MS;
    else if (starved) limit = STARVED_MS;
    if (Date.now() - (this.lastByteAt || this.openedAt) >= limit) this.failed(generation, 'quiet');
  };
  CastStreamLoader.prototype.deliver = function (data) {
    var start = this.sent;
    this.sent += data.byteLength;
    this.onDataArrival(data, start, this.sent);
  };
  /** A connection ended, broke or went quiet: rejoin the stream, or tell mpegts.js (and so the receiver) it's over. */
  CastStreamLoader.prototype.failed = function (generation, reason, code) {
    if (generation !== this.generation) return;
    this.close();
    var now = Date.now();
    this.failures = this.failures.filter(function (at) {return now - at < REJOIN_WINDOW_MS;});
    this.failures.push(now);
    var tries = this.failures.length;
    this.rejoins = this.rejoins.filter(function (at) {return now - at < REJOIN_SPAN_MS;});
    // Only a stream that has delivered something rejoins here: there is a picture to keep. Start-up failures,
    // refusals, changed streams (they need a new demuxer) and a line that keeps dropping go to the receiver's
    // retry(), which knows about refused lines, backs off and gives up in the end.
    var rejoin = this.sent && !this.splicer.raw && reason !== 'changed' && !(reason === 'status' && FINAL_STATUS[code]) &&
      tries <= REJOIN_DELAYS.length;
    if (rejoin && this.rejoins.length >= REJOIN_LIMIT) {rejoin = false; log('rejoin_limit', this.rejoins.length);}
    if (rejoin) {
      this.rejoins.push(now);
      log('rejoin_' + reason, tries);
      this.status = CONNECTING;
      var next = this.generation;
      this.timer = setTimeout(() => {
        if (next !== this.generation) return;
        this.timer = 0;
        this.connect();
      }, REJOIN_DELAYS[tries - 1]);
      return;
    }
    // Reported as the library's loader does, so onEngineError still gets 401/403/404 as NETWORK_STATUS_CODE_INVALID,
    // and a clean end becomes LOADING_COMPLETE.
    if (reason === 'end') {this.status = COMPLETE; this.onComplete(0, this.sent - 1); return;}
    this.status = ERROR;
    var errors = mpegts.LoaderErrors;
    if (reason === 'status') this.onError(errors.HTTP_STATUS_CODE_INVALID, {code: code, msg: ''});
    else if (reason === 'error') this.onError(errors.EXCEPTION, {code: -1, msg: ''});
    else this.onError(errors.EARLY_EOF, {code: -1, msg: ''});
  };

  // ------------------------------------------------------------------ mpegts.js session
  var CONFIG = {
    customLoader: CastStreamLoader,
    // Transmux on the page: the web player does the same, and MSE in workers needs a far newer Chrome.
    enableWorker: false,
    enableWorkerForMSE: false,
    enableStashBuffer: false,
    lazyLoad: false,
    // A live stream arrives at playback speed, so the picture never gets further ahead than it was when playback
    // started; hold() builds that cushion, and chasing the live edge would only eat it. Chasing stays on for a pile-up
    // (a provider's start-up burst, or a pause while the TV showed another input) and trims it back to 8 s ahead.
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 20,
    liveBufferLatencyMinRemain: 8,
    // Cast builds cap MSE buffers (about 30 MB of H.264 on CastOS Chromecasts), so keep little behind playback.
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 8,
    autoCleanupMinBackwardDuration: 4
  };
  var CUSHION = 4.5;               // seconds buffered ahead before playback starts or resumes
  var CUSHION_MIN = 1.5;           // enough once a hold has lasted HOLD_MS
  var HOLD_MS = 10000;
  var UNDERRUN = 1;                // 'waiting' with less than this ahead ran out of picture (more is a seek)
  var RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 10000];  // then every 10 s
  var RETRY_BUDGET_MS = 180000;    // a channel that has played keeps reconnecting this long
  var START_BUDGET_MS = 60000;     // one that never started gives up sooner
  var RELEASE_MS = 60000;          // after a LOAD or a drop, a 403 is the provider still releasing the line
  var HEALTHY_MS = 15000;          // clean playback that ends an outage
  var PAUSE_SUSPEND_MS = 5000;
  var HIDDEN_SUSPEND_MS = 30000;   // a pause because the TV showed something else (still within CastOS's MSE cap)

  var engine = null;          // the one mpegts.js player; never more than one upstream connection
  var link = '';              // the cast link mpegts.js plays, kept in memory only
  var owned = false;          // mpegts.js (not CAF's own player) is playing this element
  var internal = 0;           // > 0 while this script or mpegts.js changes the element itself
  var passError = false;      // lets our own "error" event through to CAF
  var autoplay = true;        // the LOAD asked to start playing
  var wantPlaying = true;     // false after a PAUSE
  var hiddenPause = false;    // that PAUSE came from CAF because the receiver stopped being visible
  var suspended = false;      // paused long enough that the download was closed
  var failure = '';           // shown error; cleared by the next LOAD
  var generation = 0;         // counts LOAD requests, so a delayed stop never hits a newer channel
  var attempts = 0;           // reconnects in the current outage
  var refusals = 0;
  var outageAt = 0;           // when the current outage started
  var releaseUntil = 0;
  var played = false;         // something played since the LOAD; reconnects don't reset it
  var expiresAt = 0;          // when this cast link stops being accepted (from the sender), 0 if unknown
  var everPlayed = false;     // this mpegts.js player showed a picture
  var holding = false;        // playback waits for the cushion
  var holdSince = 0;
  var lastTime = -1;
  var lastProgressAt = 0;
  var retryTimer = 0;
  var healthyTimer = 0;
  var suspendTimer = 0;
  var holdTimer = 0;
  var watchdog = 0;

  function clearTimers() {
    clearTimeout(retryTimer); retryTimer = 0;
    clearTimeout(healthyTimer); healthyTimer = 0;
    clearTimeout(suspendTimer); suspendTimer = 0;
    clearInterval(watchdog); watchdog = 0;
    stopHold();
  }

  function closeEngine() {
    stopHold();
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
    if (library === 'loading') return;  // libraryLoaded() opens it
    if (library === 'failed') {fail('startup'); return;}
    if (typeof mpegts.isSupported !== 'function' || !mpegts.isSupported()) {fail('unsupported'); return;}
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
      // A live stream never completes; the loader gave up rejoining it, so start over before the picture runs out.
      player.on(mpegts.Events.LOADING_COMPLETE, function () {
        setTimeout(function () {if (engine === player) retry('complete');}, 0);
      });
      player.attachMediaElement(video);
      // CAF turns autoplay on, and loading the new source re-arms it. pause() disarms it, so playback starts only
      // when hold() has its cushion.
      video.pause();
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
    if (!watchdog) watchdog = setInterval(checkProgress, 1000);
    hold('start');
  }

  var nativePlay = window.HTMLMediaElement.prototype.play;
  function playQuietly() {
    try {
      var started = nativePlay.call(video);
      if (started && typeof started.catch === 'function') started.catch(function () { /* CAF reports state */ });
    } catch { /* not ready yet */ }
  }

  // ------------------------------------------------------------------ the cushion
  /** The buffered stretch playback can use now: the range it is in, or the next one across a small hole. */
  function bufferedAhead() {
    var ranges = video.buffered;
    var time = video.currentTime;
    for (var i = 0; i < ranges.length; i++) {
      var start = ranges.start(i);
      var end = ranges.end(i);
      if (end > time + 0.04 && start < time + 1) return {seconds: end - Math.max(start, time), start: start};
    }
    return {seconds: 0, start: time};
  }
  function playableAhead() {
    var ranges = video.buffered;
    var time = video.currentTime;
    for (var i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= time + 0.04 && ranges.end(i) > time) return ranges.end(i) - time;
    }
    return 0;
  }

  /**
   * Keeps the picture still until a few seconds are buffered, at the start and after the picture ran out. The stream
   * arrives at playback speed, so whatever is buffered when playback starts is all the slack there will be. The pause
   * is kept from CAF (see the 'pause' listener), so the phone shows buffering rather than paused.
   */
  function hold(reason) {
    if (!owned || !engine || holding) return;
    holding = true;
    holdSince = Date.now();
    // The picture ran out, so the playback before it wasn't the clean stretch that ends an outage.
    clearTimeout(healthyTimer); healthyTimer = 0;
    log('hold_' + reason);
    if (!video.paused) video.pause();
    if (!screenShown()) showPill('Buffering\u2026');
    holdTimer = setInterval(checkHold, 250);
    starved = reason !== 'start';
  }
  function checkHold() {
    var ahead = bufferedAhead();
    var waited = Date.now() - holdSince;
    if (ahead.seconds < CUSHION && (waited < HOLD_MS || ahead.seconds < CUSHION_MIN)) return;
    stopHold();
    log('resume', Math.round(waited / 100) / 10);
    // Playback sits before the first frame or at a small hole: start at the buffered picture.
    if (ahead.start > video.currentTime + 0.1) video.currentTime = ahead.start;
    if (wantPlaying && !suspended) playQuietly();
    else showPill('Paused');
  }
  function stopHold() {
    holding = false;
    starved = false;
    clearInterval(holdTimer); holdTimer = 0;
  }

  function startSession(url) {
    endSession();
    owned = true;
    link = url;
    wantPlaying = autoplay;
    hiddenPause = false;
    suspended = false;
    attempts = 0;
    refusals = 0;
    played = false;
    // The phone's own stream may still hold the line for a moment.
    releaseUntil = Date.now() + RELEASE_MS;
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

  /** Closes the download while paused; PLAY reopens it at the live edge. */
  function suspend() {
    clearTimeout(retryTimer); retryTimer = 0;
    clearTimeout(suspendTimer); suspendTimer = 0;
    suspended = true;
    closeEngine();
    showPill('Paused');
    log('suspended');
  }

  /** Starts mpegts.js over, after the loader gave up rejoining the stream. */
  function retry(reason, delay) {
    if (!owned || failure || retryTimer || suspended) return;
    // Reconnecting while paused would start playing again (CAF leaves autoplay on), so suspend instead.
    if (!wantPlaying) {suspend(); return;}
    var now = Date.now();
    if (!attempts) {
      outageAt = now;
      releaseUntil = Math.max(releaseUntil, now + RELEASE_MS);
    }
    if (now - outageAt > (played ? RETRY_BUDGET_MS : START_BUDGET_MS)) {
      // An outage that ends on refusals is a busy line, not a lost connection.
      if (reason === 'releasing' || reason === 'refused') fail(expiresAt ? 'refused' : 'expired');
      else fail('unreachable');
      return;
    }
    // A channel that was playing reconnects at once; repeated failures back off.
    if (typeof delay !== 'number') delay = !attempts && played ? 0 : RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)];
    attempts++;
    clearTimeout(healthyTimer); healthyTimer = 0;
    // Close the old connection now; the next one opens only after the delay.
    closeEngine();
    log('reconnect_' + reason, attempts);
    showPill('Reconnecting\u2026');
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      if (!owned || failure || suspended) return;
      if (!wantPlaying) {suspend(); return;}  // paused while this reconnect was waiting
      openEngine();
    }, delay);
  }

  /** A decoder or Media Source failure that repeats before anything has played is a format this TV can't play. */
  function mediaFailed(reason) {
    if (attempts >= 2 && !played) fail('format');
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
        // Right after a LOAD or a drop the provider may still count the previous connection: try again shortly,
        // without counting it as a refusal.
        if (!attempts || Date.now() < releaseUntil) {retry('releasing', Math.min(2000 + attempts * 1000, 5000)); return;}
        if (++refusals > 3) {fail(expiresAt ? 'refused' : 'expired'); return;}
        retry('refused');
        return;
      } else if (code === 400 || code === 404 || code === 410) {fail('unavailable'); return;}
    } else if (type === mpegts.ErrorTypes.MEDIA_ERROR) {
      // Once this channel has played, its format is fine: a reconnect that got something else is retried.
      if ((detail === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED || detail === mpegts.ErrorDetails.MEDIA_CODEC_UNSUPPORTED) && !played) {fail('format'); return;}
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
    var frozen = now - lastProgressAt;
    if (!holding && frozen >= 2000 && playableAhead() < UNDERRUN) hold('stuck');
    // Nothing on screen within 30 s of connecting, or frozen for 15 s after playing although the loader rejoins a
    // quiet stream after 8 s and the cushion refills within seconds: start over.
    if (frozen > (everPlayed ? 15000 : 30000)) retry('stall');
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
  // CAF's play() (on PLAY, or a seek) waits while the cushion builds; hold() starts playback itself.
  video.play = function () {
    if (owned && holding) return Promise.resolve();
    return nativePlay.call(video);
  };

  // Registered before CAF registers its own listeners, so these run first and can keep mpegts.js's internal
  // reconnects and the cushion's pauses from looking like the end of the programme or a pause by the viewer.
  // mpegts.js itself does not listen to these events.
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
    // Pauses the viewer didn't ask for come from hold() or reconnecting. CAF would report a pause event as PAUSED;
    // without it, CAF sees the picture stand still and reports BUFFERING.
    if (owned && wantPlaying) event.stopImmediatePropagation();
  }, true);
  video.addEventListener('waiting', function () {
    if (owned && engine && wantPlaying && !holding && playableAhead() < UNDERRUN) hold('underrun');
  }, true);

  // ------------------------------------------------------------------ screen follows playback
  video.addEventListener('playing', function () {
    hideScreen();
    hidePill();
    if (failure === 'playback') failure = '';
    if (!owned) return;
    everPlayed = true;
    played = true;
    lastProgressAt = Date.now();
    clearTimeout(healthyTimer);
    healthyTimer = setTimeout(function () {attempts = 0; refusals = 0;}, HEALTHY_MS);
  });
  video.addEventListener('waiting', function () {if (!retryTimer && !holding) showPill('Buffering\u2026', 1500);});
  video.addEventListener('pause', function () {if (!wantPlaying) showPill('Paused');});

  // ------------------------------------------------------------------ CAF
  var context = framework.CastReceiverContext.getInstance();
  var playerManager = context.getPlayerManager();
  var messages = framework.messages;
  var events = framework.events;
  var system = framework.system;
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
  function receiverHidden() {
    try {
      return Boolean(system) && context.getVisibilityState() === system.VisibilityState.NOT_VISIBLE;
    } catch {return false;}
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
    autoplay = request.autoplay !== false;
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
    // CAF itself pauses when the TV stops showing the receiver (another input, Home, a screensaver, HDMI-CEC), through
    // this same request. Such a pause resumes on its own when the receiver is visible again (see VISIBILITY_CHANGED).
    if (wantPlaying) hiddenPause = receiverHidden();
    wantPlaying = false;
    if (holding) showPill('Paused');
    if (owned) {
      clearTimeout(suspendTimer);
      // mpegts.js keeps downloading a paused live stream. At high bitrates that fills Cast's small MSE buffer within
      // seconds, after which it never resumes the download, and it keeps the line busy: close the download soon and
      // reopen it at the live edge on PLAY. A TV showing another input for a moment keeps the stream.
      suspendTimer = setTimeout(function () {
        if (!owned || wantPlaying || failure) return;
        suspend();
      }, hiddenPause ? HIDDEN_SUSPEND_MS : PAUSE_SUSPEND_MS);
    }
    return request;
  });
  playerManager.setMessageInterceptor(messages.MessageType.PLAY, function (request) {
    wantPlaying = true;
    hiddenPause = false;
    clearTimeout(suspendTimer); suspendTimer = 0;
    // During a hold, playback starts once the cushion is there: the 'Paused' pill becomes 'Buffering\u2026', or goes
    // when a card (such as 'Tuning in') already covers the screen.
    if (!holding || screenShown()) hidePill();
    else showPill('Buffering\u2026');
    if (owned && suspended) {
      suspended = false;
      attempts = 0;
      openEngine();
    }
    return request;
  });
  if (system && system.EventType && system.EventType.VISIBILITY_CHANGED) {
    context.addEventListener(system.EventType.VISIBILITY_CHANGED, function (event) {
      if (!event || !event.isVisible || !hiddenPause || wantPlaying) return;
      hiddenPause = false;
      if (!owned) return;
      log('visible_resume');
      try {playerManager.play();} catch { /* nothing loaded */ }
    });
  }

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

  // ------------------------------------------------------------------ mpegts.js, after CAF is up
  function libraryLoaded() {
    mpegts = window.mpegts || null;
    library = mpegts && typeof mpegts.createPlayer === 'function' ? 'ready' : 'failed';
    if (library === 'ready' && mpegts.LoggingControl) {
      try {mpegts.LoggingControl.enableAll = false;} catch { /* older build */ }
    }
    if (library === 'failed') log('library_failed');
    // A cast that arrived while the script loaded starts now.
    if (owned && !engine && !retryTimer && !suspended && !failure) openEngine();
  }
  if (window.mpegts) {
    libraryLoaded();
  } else {
    // The address, with its version for caching, comes from the page's preload link.
    var preload = document.getElementById('mpegts-preload');
    var script = document.createElement('script');
    script.src = (preload && preload.getAttribute('href')) || '/cast/mpegts.js';
    script.onload = libraryLoaded;
    script.onerror = libraryLoaded;
    document.head.appendChild(script);
  }
})();
