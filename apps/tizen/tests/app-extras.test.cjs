'use strict';
// docs/extras.md in the Samsung app: runs the real app.js with the real data.js (TunerData.extras) against a small DOM,
// a recording player, a fake lumanest.tv and a recording tizen.application. The Trailer button, the trailer player (an
// overlay with lumanest.tv's player page in an iframe; a recording frame window stands in for the page) and its
// fallbacks, the YouTube launch and the QR dialog; OpenSubtitles tracks looked up when a movie or episode starts, listed in the subtitle chooser
// with the credit, fetched only when shown and drawn as plain text at the player's position.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');

const API = 'https://lumanest.tv/api/extras/';
const FILE = API + 'subtitles/file/';
const KEY = 'vKQi3bBA1y8';
const QR = Array.from({ length: 21 }, (_, r) => Array.from({ length: 21 }, (_, c) => String((r + c) % 2)).join(''));
const TRACKS = [
    { id: '11-aaaaaaaaaaaaaaaaaaaaaa', lang: 'en', label: 'English (OpenSubtitles)', hi: false, vtt: FILE + '11-aaaaaaaaaaaaaaaaaaaaaa.vtt', srt: FILE + '11-aaaaaaaaaaaaaaaaaaaaaa.srt' },
    { id: '12-bbbbbbbbbbbbbbbbbbbbbb', lang: 'en', label: 'English SDH (OpenSubtitles 2)', hi: true, vtt: FILE + '12-bbbbbbbbbbbbbbbbbbbbbb.vtt', srt: FILE + '12-bbbbbbbbbbbbbbbbbbbbbb.srt' },
    { id: '13-cccccccccccccccccccccc', lang: 'en', label: 'Elsewhere', hi: false, vtt: 'https://example.invalid/13.vtt', srt: 'https://example.invalid/13.srt' }
];
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b>Hello</b> &lt;img src=x onerror=alert(1)&gt;\nsecond line\n\n00:00:03.000 --> 00:00:04.000\nBye\n';

function harness(options = {}) {
    let now = 1000, timerId = 0;
    const timers = new Map(), documentEvents = {}, windowEvents = {};
    const document = { hidden: false };
    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
            this.className = ''; this.id = ''; this.style = {}; this.attributes = {};
            this.value = ''; this.disabled = false; this.scrollLeft = 0; this.scrollTop = 0; this._text = '';
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        removeChild(child) {
            assert.ok(this.children.includes(child), 'removeChild of a child');
            if (child.contains(document.activeElement)) document.activeElement = document.body;
            this.children = this.children.filter(node => node !== child); child.parentNode = null; return child;
        }
        insertBefore(child, before) {
            const at = this.children.indexOf(before);
            if (at < 0) return this.appendChild(child);
            child.parentNode = this; this.children.splice(at, 0, child); return child;
        }
        get nextSibling() { if (!this.parentNode) return null; const list = this.parentNode.children; return list[list.indexOf(this) + 1] || null; }
        set textContent(value) {
            if (this.contains(document.activeElement)) document.activeElement = document.body;
            this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = String(value);
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
        // Subtitle text and labels are untrusted: app.js must never parse them as markup.
        set innerHTML(value) { throw new Error('innerHTML used: ' + value); }
        get firstChild() { return this.children[0] || null; }
        contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] || null; }
        focus() { assert.ok(this.offsetWidth > 0, 'A hidden control must not receive focus'); document.activeElement = this; if (this.onfocus) this.onfocus(); }
        blur() { if (document.activeElement === this) document.activeElement = document.body; }
        click() { if (!this.disabled && this.onclick) this.onclick({ target: this, preventDefault() {} }); }
        get offsetWidth() {
            for (let node = this; node; node = node.parentNode) {
                if (node.className.split(/\s+/).includes('hidden') || node.style.display === 'none') return 0;
            }
            return 200;
        }
        get offsetHeight() { return this.offsetWidth ? 60 : 0; }
        get offsetLeft() { return 0; }
        get offsetTop() { return 0; }
        get clientWidth() { return 1920; }
        get clientHeight() { return 1080; }
        getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 60 }; }
        querySelectorAll(selector) {
            const parts = selector.split(',').map(value => value.trim()); const results = [];
            function matches(node, value) {
                if (value.startsWith('#')) return node.id === value.slice(1);
                if (value.startsWith('.')) return node.className.split(/\s+/).includes(value.slice(1));
                return node.tagName.toLowerCase() === value;
            }
            (function visit(node) { for (const child of node.children) { if (parts.some(part => matches(child, part))) results.push(child); visit(child); } })(this);
            return results;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    document.body = new Element('body'); document.activeElement = document.body;
    document.documentElement = new Element('html');
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.body.querySelector('#' + id);
    document.addEventListener = (type, fn) => { (documentEvents[type] ||= []).push(fn); };
    for (const id of ['background', 'av-player', 'html-player', 'app']) { const node = new Element('div'); node.id = id; document.body.appendChild(node); }
    for (const id of ['topbar', 'main', 'player-overlay', 'dialog-layer', 'toast']) {
        const node = new Element(id === 'main' ? 'main' : 'div'); node.id = id;
        if (id.includes('layer') || id.includes('overlay') || id === 'toast') node.className = 'hidden';
        document.getElementById('app').appendChild(node);
    }

    // The real data.js: its TunerData.extras (and the browse rules); the provider, store and rows are fixtures.
    const dataWindow = { Promise, localStorage: { getItem: () => null, setItem() {} }, XMLHttpRequest: function () {} };
    vm.runInNewContext(dataSource, { window: dataWindow, console });
    const real = dataWindow.TunerData;
    const settings = { source: { type: 'xtream', server: 'https://fixture.invalid', username: 'fixture', password: 'fixture' }, theme: '', zip: '', startOn: 'live', subtitles: !!options.subtitles };
    const store = {
        settings, lastError: '', lastWatched() { return null; }, favourites() { return []; }, isFavourite() { return false; }, toggleFavourite() {},
        mostWatched() { return []; }, recents() { return []; }, recordWatched() {}, saveRecent() {}, recordSeen() {}, upNext() { return []; }, seen() { return []; },
        saveSettings(change) { Object.assign(settings, change); return true; }, adultLock: real.createPasscodeLock({ getItem: () => null, setItem() {} }, () => now)
    };
    // A year in the name: if live channels were looked up, this one could be.
    const channels = [{ id: 'live:1', name: 'CNN (2024)', number: 1, categoryId: 'news', categoryIds: ['news'], url: 'https://fixture.invalid/1.m3u8', backups: [] }];
    const movie = (id, name, extra) => ({ id, name, categoryId: 'films', categoryIds: ['films'], url: 'https://fixture.invalid/' + id + '.mp4', backups: [], year: '', rating: '7', added: 1, tmdb: '', genre: '', ...extra });
    const movies = [movie('m:1', 'The Matrix', { tmdb: '603', year: '1999' }), movie('m:2', 'Heat (1995)'), movie('m:3', 'Home video')];
    const series = [{ id: 's:1', name: 'Game of Thrones', categoryId: 'shows', categoryIds: ['shows'], url: '', backups: [], tmdb: '1399', year: '2011', rating: '9', added: 1, genre: '' }];
    const seriesInfo = { seasons: [{ number: 2, episodes: [{ id: 'e:23', episode: 3, season: 2, name: 'Episode 3', url: 'https://fixture.invalid/e23.mp4' }] }] };
    let clientOptions;

    // lumanest.tv
    const requests = [];
    class FakeXhr {
        constructor() { requests.push(this); this.readyState = 0; }
        open(method, url) { this.method = method; this.url = url; }
        send() { this.sent = true; }
        abort() {}
    }
    function answer(prefix, status, body) {
        const request = requests.find(r => !r.done && r.url.startsWith(prefix));
        assert.ok(request, 'a request to ' + prefix);
        request.done = true; request.status = status; request.readyState = 4;
        request.responseText = typeof body === 'string' ? body : JSON.stringify(body);
        request.onreadystatechange();
        return request;
    }

    // The player: records what the app asks; the test plays its automatic choice (js/player.js) through playerOptions.
    const calls = [];
    let playerOptions;
    const embedded = options.embedded || [];
    const single = {
        state: { status: 'idle' }, showing: false, chosen: -1, position: 0, refreshes: 0,
        stop() { this.state = { status: 'idle' }; calls.push(['stop']); },
        setRect() {}, suspend() {}, restore() {}, resume() {}, pause() {}, toggle() {}, seek() {},
        play(request) { this.state = { status: 'playing', request, position: 0, duration: 600000 }; calls.push(['play', request.id]); },
        tracks() { return { audio: [], subtitles: embedded.map(track => ({ ...track, selected: this.showing && this.chosen === track.index })) }; },
        selectTrack(type, index) { calls.push(['select', type, index]); this.showing = index !== -1; this.chosen = index; return true; },
        subtitlesShowing() { return this.showing; },
        currentTime() { return this.position; },
        refreshSubtitles() { this.refreshes++; }
    };
    const launches = [];
    const tizen = options.noTizen ? { tvinputdevice: { getSupportedKeys() { return []; }, registerKey() {} } } : {
        tvinputdevice: { getSupportedKeys() { return []; }, registerKey() {} },
        ApplicationControl: function (operation, uri, mime, category, data) { Object.assign(this, { operation, uri, mime, category, data }); },
        ApplicationControlData: function (key, value) { Object.assign(this, { key, value }); },
        application: {
            launchAppControl(control, id, ok, fail) {
                launches.push({ control, id, ok, fail });
                if (options.launchThrows) throw new Error('NotFoundError');
            }
        }
    };
    const drawn = [];
    const window = {
        innerWidth: 1920, innerHeight: 1080, webapis: { avplay: {} }, XMLHttpRequest: FakeXhr, tizen,
        TunerData: Object.assign({}, real, {
            createStore() { return store; },
            catalogIdentity() { return 'fixture'; },
            browse: Object.assign({}, real.browse, { createRowsClient() { return { peek() { return null; }, refresh() { return false; } }; } }),
            createClient(source, value) {
                clientOptions = value;
                return {
                    catalogIdentity: 'fixture', cancel() {}, guide() { return { then() {} }; }, movieInfo() { return { then() {} }; },
                    seriesInfo() { return { then(ok) { ok(seriesInfo); } }; },
                    load() {
                        value.onCatalog('live', channels, [{ id: 'news', name: 'News' }]); value.onStatus('live', { state: 'ready' });
                        value.onCatalog('movies', movies, [{ id: 'films', name: 'Films' }]); value.onStatus('movies', { state: 'ready' });
                        value.onCatalog('series', series, [{ id: 'shows', name: 'Shows' }]); value.onStatus('series', { state: 'ready' });
                    }
                };
            }
        }),
        TunerPlayer: { create(value) { playerOptions = value; return single; } },
        TunerPairing: { isOpen() { return false; }, open() {}, drawQr(canvas, rows) { drawn.push({ width: canvas.width, rows }); } },
        addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }
    };
    class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    vm.runInNewContext(appSource, {
        window, document, Date: FixtureDate,
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay, every: delay }); return id; },
        clearInterval(id) { timers.delete(id); }
    }, { filename: 'app.js' });
    function node(id) { const result = document.getElementById(id); assert.ok(result, id + ' exists'); return result; }
    function emit(type, code) {
        const event = { keyCode: code, target: document.activeElement, preventDefault() {}, repeat: false };
        (documentEvents[type] || []).forEach(fn => fn(event));
    }
    function advance(ms) {
        const end = now + ms;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            if (next[1].every) next[1].at += next[1].every; else timers.delete(next[0]);
            next[1].fn();
        }
        now = end;
    }
    const h = {
        document, node, calls, single, settings, requests, answer, launches, drawn, advance,
        get playerOptions() { return playerOptions; },
        get focused() { return document.activeElement.id; },
        get dialogOpen() { return !node('dialog-layer').className.includes('hidden'); },
        get pending() { return requests.filter(r => !r.done && r.url.startsWith(API)).map(r => r.url); },
        // Repeating timers of 200 ms: the OpenSubtitles cue reader (the clock and guide timers repeat every 15 and 60 s).
        get intervals() { return [...timers.values()].filter(timer => timer.every === 200).length; },
        // Returns whether the keydown's default was prevented.
        key(code, repeat) {
            const make = () => ({ keyCode: code, target: document.activeElement, repeat: !!repeat, prevented: false, preventDefault() { this.prevented = true; } });
            const down = make();
            (documentEvents.keydown || []).forEach(fn => fn(down));
            const up = make();
            (documentEvents.keyup || []).forEach(fn => fn(up));
            return down.prevented;
        },
        // The trailer player: its layer and frame (null when closed), a frame window that records what the app posts,
        // a message as the browser delivers it, and window or document events.
        get layerShown() { return document.getElementById('trailer-layer'); },
        get frame() { return document.getElementById('trailer-frame'); },
        frameWindow() { const win = { posted: [], postMessage(data, origin) { win.posted.push([data, origin]); } }; node('trailer-frame').contentWindow = win; return win; },
        message(data, from = {}) {
            const event = { data: typeof data === 'string' ? data : JSON.stringify({ tuner: 'trailer', v: 1, ...data }), origin: 'origin' in from ? from.origin : 'https://lumanest.tv',
                source: 'source' in from ? from.source : document.getElementById('trailer-frame').contentWindow };
            (windowEvents.message || []).forEach(fn => fn(event));
        },
        windowEvent(type) { (windowEvents[type] || []).forEach(fn => fn({ type })); },
        documentEvent(type) { (documentEvents[type] || []).forEach(fn => fn({ type })); },
        text(id) { return node(id).textContent; },
        ids(parent) { return node(parent).children.filter(child => child.id).map(child => child.id); },
        // Search, then OK on the first result: the movie or series page, or live playback.
        open(query) {
            node('tab-3').click();
            const input = node('search-input'); input.value = query; input.oninput(); advance(200);
            node('result-0').click();
        },
        layer() { const layer = node('subtitle-layer'); return layer.className.includes('hidden') ? null : layer; }
    };
    return h;
}

test('Trailer: one lookup per page, added after Add to Library in place without taking focus; no button without a trailer', () => {
    const h = harness();
    h.open('matrix');
    assert.deepEqual(h.pending, [API + 'trailer?v=1&type=movie&tmdb=603'], 'the provider TMDB id');
    assert.equal(h.document.getElementById('detail-trailer'), null, 'no button while loading');
    assert.equal(h.focused, 'detail-play');
    h.node('detail-back').focus();
    h.answer(API + 'trailer', 200, { v: 1, status: 'ok', tmdb: 603, trailer: { key: KEY, name: 'Official Trailer', url: 'https://www.youtube.com/watch?v=' + KEY, short: 'youtu.be/' + KEY, qr: QR } });
    const copy = h.node('detail-trailer').parentNode;
    assert.deepEqual(copy.children.filter(child => child.tagName === 'BUTTON').map(child => child.id), ['detail-back', 'detail-play', 'detail-fav', 'detail-trailer']);
    assert.equal(h.text('detail-trailer'), '\u25b6 Trailer');
    assert.equal(h.focused, 'detail-back', 'focus did not move');
    h.key(10009); h.open('matrix');
    assert.deepEqual(h.pending, [], 'the answer is kept for the session');
    assert.ok(h.node('detail-trailer'), 'the button is there at once');
    // No TMDB id: name and year; a "none" answer, a failure or no year: no button.
    h.key(10009); h.open('heat');
    assert.deepEqual(h.pending, [API + 'trailer?v=1&type=movie&name=Heat%20(1995)&year=1995']);
    h.answer(API + 'trailer', 200, { v: 1, status: 'unmatched', tmdb: null, trailer: null });
    assert.equal(h.document.getElementById('detail-trailer'), null);
    h.key(10009); h.open('home video');
    assert.deepEqual(h.pending, [], 'no TMDB id and no year: no lookup');
    h.key(10009); h.open('heat');
    assert.equal(h.document.getElementById('detail-trailer'), null);
    // A series: type tv, the button after Add to Library and before the episodes.
    h.key(10009); h.open('thrones');
    assert.deepEqual(h.pending, [API + 'trailer?v=1&type=tv&tmdb=1399']);
    h.answer(API + 'trailer', 500, 'oops');
    assert.equal(h.document.getElementById('detail-trailer'), null, 'a failure shows nothing');
    h.key(10009); h.open('thrones');
    h.answer(API + 'trailer', 200, { v: 1, status: 'ok', tmdb: 1399, trailer: { key: 'BdJKm16Co6M', name: 'Trailer', qr: QR } });
    const ids = h.node('detail-trailer').parentNode.children.map(child => child.id || child.className);
    assert.ok(ids.indexOf('detail-trailer') === ids.indexOf('detail-fav') + 1 && ids.indexOf('detail-trailer') < ids.indexOf('episodes'), ids.join(','));
    assert.equal(h.focused, 'episode-0');
});

const FRAME = 'https://lumanest.tv/embed/trailer?v=1&k=' + KEY;
const OK_ANSWER = { v: 1, status: 'ok', tmdb: 603, trailer: { key: KEY, name: 'Official Trailer', qr: QR } };
const command = (type, by) => [JSON.stringify(by === undefined ? { tuner: 'trailer', v: 1, type } : { tuner: 'trailer', v: 1, type, by }), 'https://lumanest.tv'];
// The Matrix's page with Trailer focused and its answer in.
function trailerPage(options) {
    const h = harness(options);
    h.open('matrix');
    h.answer(API + 'trailer', 200, OK_ANSWER);
    h.node('detail-trailer').focus();
    return h;
}

test('Trailer plays in Tuner: a full-screen overlay with lumanest.tv\'s player page; Back closes it and focus returns to Trailer', () => {
    const h = trailerPage();
    h.key(13);
    const layer = h.layerShown, frame = h.frame;
    assert.ok(layer, 'the overlay is open');
    assert.equal(layer.parentNode, h.document.body, 'over everything, outside the scaled stage');
    assert.equal(layer.className, 'trailer-layer');
    assert.equal(frame.parentNode.parentNode, layer);
    assert.equal(frame.tagName, 'IFRAME');
    assert.equal(frame.src, FRAME);
    // Sandboxed: scripts and its own origin (lumanest.tv, which the app checks), but no popups and no top navigation.
    assert.deepEqual({ ...frame.attributes }, { tabindex: '-1', allow: 'autoplay; encrypted-media', sandbox: 'allow-scripts allow-same-origin allow-presentation', title: 'Trailer' });
    assert.equal(h.document.activeElement, layer, 'focus stays in the app document, on the overlay');
    // The app's lines are in a bar above the frame, never in front of the player.
    assert.deepEqual(layer.children.map(child => [child.className, child.children.map(line => [line.className, line.textContent])]), [
        ['trailer-bar', [['trailer-status', 'Loading Official Trailer\u2026'], ['trailer-hint', 'OK pause/play \u00b7 Left/Right 10 s \u00b7 Back close']]],
        ['trailer-stage', [['trailer-frame', '']]]]);
    assert.equal(h.launches.length, 0, 'not the YouTube app');
    assert.equal(h.dialogOpen, false);
    h.frameWindow();
    h.message({ type: 'ready' });
    assert.equal(h.text('trailer-layer').includes('Loading'), false, 'the loading line goes at "ready"');
    assert.equal(h.key(10009), true);
    assert.equal(h.layerShown, null, 'Back closes it');
    assert.equal(frame.parentNode, null, 'the frame is removed');
    assert.equal(frame.src, 'about:blank', 'and emptied first, so its sound stops at once');
    assert.equal(h.focused, 'detail-trailer');
    assert.ok(h.node('detail-play'), 'still on the details page');
    // Escape, Backspace and LG's Back (461) close it as well; a held Back's repeats do not.
    for (const code of [27, 8, 461]) {
        h.key(13); assert.ok(h.layerShown);
        h.key(code, true); assert.ok(h.layerShown, code + ' repeat');
        h.key(code); assert.equal(h.layerShown, null, String(code)); assert.equal(h.focused, 'detail-trailer');
    }
    assert.equal(h.launches.length, 0);
    // Opened again: a new frame; the old one's timer is gone with it.
    h.key(13);
    const again = h.frame;
    assert.notEqual(again, frame);
    // Trailer pressed under an open player (only a pointer could): one player, the new one.
    h.node('detail-trailer').click();
    assert.equal(again.parentNode, null); assert.equal(again.src, 'about:blank');
    assert.equal(h.document.body.querySelectorAll('.trailer-layer').length, 1);
    h.advance(11999); assert.ok(h.layerShown);
});

test('the trailer player\'s keys: OK, media keys and Left/Right go to the frame once it is ready; nothing reaches the page', () => {
    const h = trailerPage();
    h.key(13);
    const win = h.frameWindow();
    h.key(13); h.key(39);
    assert.deepEqual(win.posted, [], 'nothing is sent before "ready"');
    h.message({ type: 'ready' });
    // Until the trailer has played, OK and Play/Pause send "play" (a toggle would pause one that is still loading).
    assert.equal(h.key(13), true);
    h.key(10252);
    assert.deepEqual(win.posted.splice(0), [command('play'), command('play')]);
    h.message({ type: 'state', state: 'playing' });
    assert.equal(h.key(13), true);
    assert.equal(h.key(37), true);
    h.key(39); h.key(39, true); h.key(10252); h.key(179); h.key(415); h.key(19);
    // Rewind and FastForward step 10 s as Left and Right do.
    assert.equal(h.key(412), true); assert.equal(h.key(417), true);
    assert.deepEqual(win.posted, [command('toggle'), command('seek', -10), command('seek', 10), command('seek', 10), command('toggle'), command('toggle'), command('play'), command('pause'),
        command('seek', -10), command('seek', 10)]);
    h.key(13, true);
    assert.equal(win.posted.length, 10, 'a held OK toggles once');
    // Other keys do nothing while it is open: no favourite, no tab, no guide, no subtitles dialog, no page focus move.
    for (const code of [38, 40, 48, 53, 458, 405, 10221, 427, 428, 65]) assert.equal(h.key(code), false, String(code));
    // A PC keyboard's Tab: its default (focus to the page behind the overlay) is prevented, and nothing is sent.
    assert.equal(h.key(9), true, 'Tab moves no focus behind the overlay');
    assert.deepEqual(win.posted.length, 10);
    assert.ok(h.layerShown); assert.equal(h.document.activeElement, h.layerShown);
    assert.equal(h.dialogOpen, false);
    assert.equal(h.calls.filter(call => call[0] === 'play').length, 0, 'the movie never started');
    // OK's release does not press Trailer under the overlay (that would open a second player).
    const frame = h.frame;
    h.key(13); assert.equal(h.frame, frame);
    // MediaStop stops it and closes.
    h.key(413);
    assert.deepEqual(win.posted.at(-1), command('stop'));
    assert.equal(h.layerShown, null); assert.equal(h.focused, 'detail-trailer');
    // Closed: keys are the page's again (OK on Trailer opens it).
    h.key(13); assert.ok(h.layerShown);
});

test('frame messages: only lumanest.tv\'s, only from this frame, only the documented shape; ended closes; a key forwarded from the frame acts as the remote', () => {
    const h = trailerPage();
    h.key(13);
    const win = h.frameWindow(), other = { postMessage() {} };
    // Not from the frame or not from lumanest.tv: ignored, so "ready" never arrives.
    h.message({ type: 'ready' }, { origin: 'https://example.invalid' });
    h.message({ type: 'ready' }, { origin: 'null' });
    h.message({ type: 'ready' }, { origin: 'https://lumanest.tv.example.invalid' });
    h.message({ type: 'ready' }, { source: other });
    h.message({ type: 'ready' }, { source: null });
    h.message({ type: 'key', key: 'back' }, { source: other });
    h.message({ type: 'state', state: 'ended' }, { origin: 'http://lumanest.tv' });
    h.message('{"tuner":"trailer","v":2,"type":"ready"}');
    h.message('{"type":"ready"}');
    h.message('ready');
    h.message({ type: 'error', code: '150' });
    assert.ok(h.layerShown, 'still open');
    assert.match(h.text('trailer-layer'), /Loading/);
    h.key(13); assert.deepEqual(win.posted, [], 'still not ready');
    // A frame without a window yet: a message with no source is not its.
    h.frame.contentWindow = null;
    h.message({ type: 'ready' }, { source: null });
    h.frame.contentWindow = win;
    assert.match(h.text('trailer-layer'), /Loading/);
    h.message({ type: 'ready' });
    assert.doesNotMatch(h.text('trailer-layer'), /Loading/);
    // Keys forwarded by the frame: as the remote's (once it has played: OK before that is "play", as on the remote).
    h.message({ type: 'key', key: 'enter' });
    assert.deepEqual(win.posted.splice(0), [command('play')]);
    h.message({ type: 'state', state: 'playing' });
    h.message({ type: 'key', key: 'enter' }); h.message({ type: 'key', key: 'right' }); h.message({ type: 'key', key: 'left' });
    h.message({ type: 'key', key: 'playpause' }); h.message({ type: 'key', key: 'play' }); h.message({ type: 'key', key: 'pause' });
    h.message({ type: 'key', key: 'up' }); h.message({ type: 'key', key: 'down' });
    assert.deepEqual(win.posted, [command('toggle'), command('seek', 10), command('seek', -10), command('toggle'), command('play'), command('pause')]);
    h.message({ type: 'key', key: 'back' });
    assert.equal(h.layerShown, null); assert.equal(h.focused, 'detail-trailer');
    // A closed player ignores its old frame's messages, and "ended" closes an open one.
    h.message({ type: 'key', key: 'enter' }, { source: win });
    h.key(13);
    const second = h.frameWindow();
    h.message({ type: 'ready' }, { source: win });
    assert.match(h.text('trailer-layer'), /Loading/, 'the old frame cannot speak for the new one');
    h.message({ type: 'ready' }); h.message({ type: 'state', state: 'playing' });
    h.message({ type: 'state', state: 'ended' });
    assert.equal(h.layerShown, null); assert.equal(h.focused, 'detail-trailer');
    assert.equal(h.launches.length, 0); assert.equal(h.dialogOpen, false);
    assert.deepEqual(second.posted, []);
    h.message({ type: 'key', key: 'stop' }, { source: second });
    h.key(13);
    h.frameWindow(); h.message({ type: 'ready' });
    h.message({ type: 'key', key: 'stop' });
    assert.equal(h.layerShown, null, 'a forwarded Stop closes too');
});

test('the trailer player\'s lines: "Press OK to play" when the trailer has not started 3 s after "ready"; the key hint stays', () => {
    const h = trailerPage();
    h.key(13);
    const win = h.frameWindow();
    const status = () => h.node('trailer-layer').children[0].children[0], hint = () => h.node('trailer-layer').children[0].children[1];
    assert.equal(status().className, 'trailer-status');
    h.message({ type: 'state', state: 'unstarted' });
    assert.equal(status().textContent, 'Loading Official Trailer\u2026', 'a state before "ready" leaves the loading line');
    h.message({ type: 'ready' });
    assert.equal(status().className, 'trailer-status hidden');
    h.message({ type: 'state', state: 'buffering' });
    assert.equal(status().className, 'trailer-status hidden', 'buffering is not a refusal');
    h.advance(2999); assert.equal(status().className, 'trailer-status hidden');
    h.advance(1);
    assert.equal(status().className, 'trailer-status'); assert.equal(status().textContent, 'Press OK to play');
    h.message({ type: 'state', state: 'buffering' });
    assert.equal(status().textContent, 'Press OK to play');
    // OK as the prompt says: "play", never a toggle that would pause a trailer still loading (a slow TV network).
    h.key(13); h.key(13);
    assert.deepEqual(win.posted, [command('play'), command('play')]);
    h.message({ type: 'state', state: 'playing' });
    assert.equal(status().className, 'trailer-status hidden');
    h.key(13);
    assert.deepEqual(win.posted.at(-1), command('toggle'), 'once it has played, OK pauses and plays');
    h.advance(60000);
    assert.equal(hint().className, 'trailer-hint', 'the hint stays (it is beside the player, not over it)');
    assert.equal(hint().textContent, 'OK pause/play \u00b7 Left/Right 10 s \u00b7 Back close');
    for (const state of ['paused', 'cued', 'unstarted', 'buffering']) {
        h.message({ type: 'state', state });
        assert.equal(status().className, 'trailer-status hidden', state + ' after it started is not "Press OK to play"');
    }
    h.message({ type: 'ready' });
    h.advance(3000);
    assert.equal(status().className, 'trailer-status hidden', 'a second "ready" after it started asks for nothing');
    // "Unstarted" after "ready" is how a trailer that will autoplay begins too (it buffers next): no prompt until the
    // timer, so a viewer on a slow network never sees "Press OK to play" before the trailer starts by itself.
    h.key(10009); h.key(13);
    h.frameWindow(); h.message({ type: 'ready' });
    h.message({ type: 'state', state: 'unstarted' });
    assert.equal(status().className, 'trailer-status hidden', 'unstarted alone is not a refusal');
    h.message({ type: 'state', state: 'buffering' });
    h.advance(2999); assert.equal(status().className, 'trailer-status hidden');
    h.advance(1);
    assert.equal(status().textContent, 'Press OK to play'); assert.equal(status().className, 'trailer-status');
    h.message({ type: 'state', state: 'playing' });
    assert.equal(status().className, 'trailer-status hidden');
    // Autoplay refused at once (paused or cued before it ever played): the prompt shows without waiting.
    for (const state of ['paused', 'cued']) {
        h.key(10009); h.key(13);
        h.frameWindow(); h.message({ type: 'ready' });
        h.message({ type: 'state', state });
        assert.equal(status().textContent, 'Press OK to play', state); assert.equal(status().className, 'trailer-status', state);
    }
    h.message({ type: 'state', state: 'playing' });
    assert.equal(status().className, 'trailer-status hidden');
    h.advance(5000); assert.equal(status().className, 'trailer-status hidden', 'no prompt once it started');
    // A second "ready" before it started: one prompt, 3 s after the last.
    h.key(10009); h.key(13);
    h.frameWindow(); h.message({ type: 'ready' }); h.advance(2000); h.message({ type: 'ready' });
    h.advance(2999); assert.equal(status().className, 'trailer-status hidden');
    h.advance(1); assert.equal(status().textContent, 'Press OK to play');
    // A closed player's timers change nothing.
    h.key(10009); h.advance(20000); assert.equal(h.layerShown, null);
});

test('in-app playback fails (player error, no "ready" in 12 s, the frame cannot load): the YouTube app by application control, then the QR dialog', () => {
    const h = trailerPage();
    // A player error (150: embedding not allowed).
    h.key(13); h.frameWindow(); h.message({ type: 'ready' });
    h.message({ type: 'error', code: 150 });
    assert.equal(h.layerShown, null, 'never a black screen');
    assert.equal(h.focused, 'detail-trailer');
    assert.equal(h.launches.length, 1);
    const first = h.launches[0];
    assert.equal(first.id, '111299001912');
    assert.equal(first.control.operation, 'http://tizen.org/appcontrol/operation/view');
    assert.deepEqual(JSON.parse(JSON.stringify(first.control.data.map(d => [d.key, d.value]))), [['PAYLOAD', ['{"values":"v=' + KEY + '"}']]]);
    first.fail(new Error('NotFoundError'));
    assert.deepEqual(h.launches.map(l => l.id), ['111299001912', '9Ur5IzDKqV.TizenYouTube']);
    h.launches[1].ok();
    first.fail(new Error('late'));
    assert.equal(h.launches.length, 2, 'a late error does not launch again');
    assert.equal(h.dialogOpen, false, 'YouTube opened: no dialog');
    // Every error the contract names falls back the same way, as does an unknown one.
    for (const code of [2, 5, 100, 101, 152, 153, 999]) {
        h.key(13); h.frameWindow(); h.message({ type: 'error', code });
        assert.equal(h.layerShown, null, String(code));
        h.launches.at(-1).ok();
    }
    assert.equal(h.launches.length, 9);
    // No "ready" within 12 seconds: the YouTube app; both ids fail: the QR dialog, and Close returns to Trailer.
    h.key(13); h.frameWindow();
    h.advance(11999); assert.ok(h.layerShown); assert.equal(h.launches.length, 9);
    h.advance(1);
    assert.equal(h.layerShown, null);
    h.launches[9].fail(new Error('x')); h.launches[10].fail(new Error('x'));
    assert.equal(h.dialogOpen, true);
    assert.match(h.text('dialog-layer'), /^Watch the trailer on your phone/);
    assert.match(h.text('dialog-layer'), new RegExp('youtu\\.be/' + KEY + "Scan the code with your phone's camera\\."));
    assert.deepEqual(JSON.parse(JSON.stringify(h.drawn)), [{ width: 360, rows: QR }]);
    assert.equal(h.focused, 'dialog-close');
    h.key(13);
    assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'detail-trailer');
    // "ready" in time: no timeout later.
    h.key(13); h.frameWindow(); h.advance(11000); h.message({ type: 'ready' });
    h.advance(60000); assert.ok(h.layerShown); assert.equal(h.launches.length, 11);
    h.key(10009);
    // The frame cannot load (its error event): at once.
    h.key(13); h.frame.onerror();
    assert.equal(h.layerShown, null); assert.equal(h.launches.length, 12);
});

test('without the YouTube app control (or when it throws), a failed trailer player shows the QR dialog at once', () => {
    for (const options of [{ noTizen: true }, { launchThrows: true }]) {
        const h = trailerPage(options);
        h.node('detail-trailer').click();
        assert.ok(h.layerShown, 'the trailer player first');
        h.frameWindow(); h.message({ type: 'error', code: 153 });
        assert.equal(h.launches.length, options.launchThrows ? 2 : 0);
        assert.equal(h.dialogOpen, true, JSON.stringify(options));
        assert.match(h.text('dialog-layer'), /youtu\.be\/vKQi3bBA1y8/);
    }
});

test('the frame taking focus gives it back to the app; leaving the app ends the trailer', () => {
    const h = trailerPage();
    h.key(13);
    const layer = h.layerShown;
    h.frame.focus();
    h.windowEvent('blur');
    assert.equal(h.document.activeElement, h.frame, 'not before the blur has finished');
    h.advance(0);
    assert.equal(h.document.activeElement, layer, 'focus is back in the app document');
    h.windowEvent('blur'); h.advance(0);
    assert.equal(h.document.activeElement, layer);
    // Home or Source: the app is hidden, the trailer stops there and then.
    h.document.hidden = true; h.documentEvent('visibilitychange');
    assert.equal(h.layerShown, null);
    h.document.hidden = false; h.documentEvent('visibilitychange');
    assert.equal(h.focused, 'detail-trailer');
    assert.equal(h.launches.length, 0, 'not a failure: no fallback');
    // A blur with the player closed changes nothing.
    h.windowEvent('blur'); h.advance(0);
    assert.equal(h.focused, 'detail-trailer');
    // The app closing (beforeunload) removes the frame too.
    h.key(13); const frame = h.frame;
    h.windowEvent('beforeunload');
    assert.equal(h.layerShown, null); assert.equal(frame.src, 'about:blank');
});

test('Subtitles: a movie or an episode looks up its OpenSubtitles tracks when it starts; live channels never do', () => {
    const h = harness();
    h.open('matrix'); h.answer(API + 'trailer', 200, { v: 1, status: 'none', trailer: null });
    h.node('detail-play').click();
    assert.deepEqual(h.pending, [API + 'subtitles?v=1&type=movie&tmdb=603']);
    assert.equal(h.playerOptions.externalSubtitles(), 'pending');
    h.answer(API + 'subtitles', 200, { v: 1, status: 'ok', tmdb: 603, tracks: TRACKS, credit: 'Subtitles provided by OpenSubtitles.com' });
    assert.equal(h.single.refreshes, 1, 'the player is told the answer is in');
    assert.equal(h.playerOptions.externalSubtitles(), 'available');
    assert.deepEqual(h.pending, [], 'no subtitle file is fetched before it is shown');
    h.key(10009); h.key(10009);
    h.open('thrones'); h.answer(API + 'trailer', 200, { v: 1, status: 'none', trailer: null });
    h.node('episode-0').click();
    assert.deepEqual(h.pending, [API + 'subtitles?v=1&type=episode&tmdb=1399&season=2&episode=3'], 'the series id with the episode numbers');
    h.answer(API + 'subtitles', 200, { v: 1, status: 'none', tmdb: 1399, tracks: [] });
    assert.equal(h.playerOptions.externalSubtitles(), '');
    h.key(10009); h.key(10009);
    h.open('cnn');
    assert.deepEqual(h.calls.filter(c => c[0] === 'play').map(c => c[1]), ['m:1', 'e:23', 'live:1']);
    assert.deepEqual(h.pending, []); assert.equal(h.playerOptions.externalSubtitles(), '');
});

test('the automatic choice: the first track is fetched only then and drawn as plain text at the player position', () => {
    const h = harness({ subtitles: true });
    h.open('matrix'); h.answer(API + 'trailer', 200, { v: 1, status: 'none', trailer: null });
    h.node('detail-play').click();
    h.answer(API + 'subtitles', 200, { v: 1, status: 'ok', tmdb: 603, tracks: TRACKS });
    h.playerOptions.onExternalSubtitles();
    assert.equal(h.playerOptions.externalSubtitles(), 'showing');
    assert.deepEqual(h.pending, [TRACKS[0].vtt]);
    h.answer(TRACKS[0].vtt, 200, VTT);
    assert.equal(h.intervals, 1, 'the position is read every 200 ms while the track is shown');
    assert.equal(h.layer(), null, 'nothing at 0 s');
    h.single.position = 1500; h.advance(200);
    const span = h.layer().children[0];
    assert.equal(span.tagName, 'SPAN'); assert.equal(span.children.length, 0, 'text, not markup');
    assert.equal(span.textContent, 'Hello <img src=x onerror=alert(1)>\nsecond line');
    h.single.position = 2500; h.advance(200);
    assert.equal(h.layer(), null);
    h.advance(10000); assert.equal(h.layer(), null, 'paused between cues: still nothing');
    // A seek redraws at once (the player's time callback), without waiting for the next tick.
    h.single.position = 3500; h.playerOptions.onTime(3500, 600000);
    assert.equal(h.layer().textContent, 'Bye');
    // The stream's own cue events cannot overwrite it.
    h.playerOptions.onSubtitle('Embedded', 2000);
    assert.equal(h.layer().textContent, 'Bye');
    // Leaving playback clears the text and stops reading the position.
    h.key(10009);
    assert.equal(h.layer(), null); assert.equal(h.intervals, 0);
    // Playing it again: the file is kept in memory, no new download.
    h.node('detail-play').click();
    h.playerOptions.onExternalSubtitles();
    assert.deepEqual(h.pending, []);
    h.single.position = 1000; h.advance(200);
    assert.match(h.layer().textContent, /^Hello/);
});

test('the chooser: Off, the stream tracks, then OpenSubtitles tracks and the credit; a failed pick says so and leaves Off', () => {
    const h = harness({ embedded: [{ index: 2, language: 'spa', label: 'Spanish' }] });
    h.open('matrix'); h.answer(API + 'trailer', 200, { v: 1, status: 'none', trailer: null });
    h.node('detail-play').click();
    h.key(405);
    assert.match(h.text('dialog-layer'), /Spanish/);
    assert.doesNotMatch(h.text('dialog-layer'), /OpenSubtitles/, 'still looking: only the stream tracks');
    h.key(10009);
    h.answer(API + 'subtitles', 200, { v: 1, status: 'ok', tmdb: 603, tracks: TRACKS, credit: 'Subtitles provided by OpenSubtitles.com' });
    h.key(405);
    const dialog = h.node('dialog-layer').children[0];
    assert.deepEqual(dialog.children.filter(c => c.tagName === 'BUTTON').map(c => c.textContent),
        ['\u2713 Off', 'Spanish', 'English (OpenSubtitles)', 'English SDH (OpenSubtitles 2)', 'Close'], 'the track elsewhere is not offered');
    const note = dialog.children.find(c => c.className === 'dialog-note footnote');
    assert.equal(note.textContent, 'Subtitles provided by OpenSubtitles.com');
    assert.ok(dialog.children.indexOf(note) > dialog.children.indexOf(h.node('dialog-3')), 'under the tracks, not a choice');
    h.node('dialog-2').click();
    assert.deepEqual(h.calls.at(-1), ['select', 'TEXT', -1], 'the stream subtitles go off');
    assert.deepEqual(h.pending, [TRACKS[0].vtt]);
    h.answer(TRACKS[0].vtt, 404, '{"v":1,"error":{"code":"not_found","message":"x"}}');
    assert.equal(h.text('toast'), "These subtitles couldn't be loaded.");
    assert.equal(h.playerOptions.externalSubtitles(), '', 'the viewer chose: no automatic choice any more');
    h.key(405); assert.match(h.text('dialog-0'), /^\u2713 Off/);
    h.node('dialog-3').click();
    h.answer(TRACKS[1].vtt, 200, VTT);
    h.single.position = 1200; h.advance(200);
    assert.match(h.layer().textContent, /^Hello/); assert.equal(h.intervals, 1);
    h.key(405);
    assert.equal(h.text('dialog-3'), '\u2713 English SDH (OpenSubtitles 2)'); assert.equal(h.focused, 'dialog-3');
    assert.equal(h.text('dialog-0'), 'Off');
    // The stream's track: the OpenSubtitles text goes.
    h.node('dialog-1').click();
    assert.deepEqual(h.calls.at(-1), ['select', 'TEXT', 2]);
    assert.equal(h.layer(), null); assert.equal(h.intervals, 0);
});

test('an automatic choice that cannot load fails silently; with nothing found the chooser says so', () => {
    const h = harness({ subtitles: true });
    h.open('matrix'); h.answer(API + 'trailer', 200, { v: 1, status: 'none', trailer: null });
    h.node('detail-play').click();
    h.key(405);
    assert.match(h.text('dialog-layer'), /Looking for subtitles for this title/);
    h.key(10009);
    h.answer(API + 'subtitles', 200, { v: 1, status: 'ok', tmdb: 603, tracks: TRACKS.slice(0, 1) });
    h.playerOptions.onExternalSubtitles();
    h.answer(TRACKS[0].vtt, 200, 'WEBVTT\n');
    assert.equal(h.node('toast').className, 'hidden', 'no toast');
    assert.equal(h.playerOptions.externalSubtitles(), '');
    const none = harness();
    none.open('heat'); none.node('detail-play').click();
    assert.deepEqual(none.pending, [API + 'trailer?v=1&type=movie&name=Heat%20(1995)&year=1995', API + 'subtitles?v=1&type=movie&name=Heat%20(1995)&year=1995']);
    none.answer(API + 'subtitles', 200, { v: 1, status: 'unmatched', tmdb: null, tracks: [] });
    none.key(405);
    assert.match(none.text('dialog-layer'), /No subtitles in this stream/);
});

test('Settings > About shows the OpenSubtitles credit', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('about-tuner').click();
    assert.match(h.text('dialog-layer'), /Subtitles provided by OpenSubtitles\.com/);
});

test('Settings > About shows the privacy policy and the YouTube Terms of Service addresses (YouTube API Services III.A)', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('about-tuner').click();
    const text = h.text('dialog-layer');
    assert.match(text, /Privacy policy: tunertv\.app\/privacy/);
    assert.match(text, /Trailers play in YouTube's embedded player \(YouTube API Services\)\. By using Tuner, you agree to the YouTube Terms of Service: www\.youtube\.com\/t\/terms/);
});
