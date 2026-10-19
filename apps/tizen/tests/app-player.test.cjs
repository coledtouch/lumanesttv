'use strict';
// Runs the real app.js against a small DOM and a recording player: playback controls timer,
// full-screen geometry, subtitles, and the passcode-protected adult content lock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const FULL = { left: 0, top: 0, width: 1920, height: 1080 };

function realData() {
    const values = new Map();
    const storage = { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
    const window = { Promise, localStorage: storage, XMLHttpRequest: function () {} };
    vm.runInNewContext(dataSource, { window, console });
    return { data: window.TunerData, storage, values };
}

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
        insertBefore(child) { return this.appendChild(child); }
        set textContent(value) {
            if (this.contains(document.activeElement)) document.activeElement = document.body;
            this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = String(value);
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
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
        getBoundingClientRect() { return { left: 1398, top: 145, width: 466, height: 263 }; }
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
    document.createElement = tag => new Element(tag);
    document.createTextNode = value => { const node = new Element('text'); node.textContent = value; return node; };
    document.getElementById = id => document.body.querySelector('#' + id);
    document.addEventListener = (type, fn) => { (documentEvents[type] ||= []).push(fn); };
    for (const id of ['background', 'av-player', 'html-player', 'app']) { const node = new Element('div'); node.id = id; document.body.appendChild(node); }
    for (const id of ['topbar', 'main', 'player-overlay', 'dialog-layer', 'toast']) {
        const node = new Element(id === 'main' ? 'main' : 'div'); node.id = id;
        if (id.includes('layer') || id.includes('overlay') || id === 'toast') node.className = 'hidden';
        document.getElementById('app').appendChild(node);
    }
    const real = realData();
    const liveCats = [{ id: 'news', name: 'News' }, { id: 'swim', name: 'Adult Swim' }, { id: 'xxx', name: 'XXX' }];
    const channels = [['CNN', 'news'], ['Cartoons', 'swim'], ['Late Night', 'xxx'], ['BBC', 'news']].map(([name, cat], index) => ({
        id: 'live:' + index, name, number: index + 1, categoryId: cat, categoryIds: [cat], url: 'https://fixture.invalid/' + index + '.m3u8', backups: []
    }));
    const movies = [{ id: 'm:1', name: 'Movie night', categoryIds: ['films'], url: 'https://fixture.invalid/m1.mp4', backups: [] },
        { id: 'm:2', name: 'Flagged film', categoryIds: ['films'], adult: true, url: 'https://fixture.invalid/m2.mp4', backups: [] }];
    // An existing customer who opens on Live TV (the setting Tuner keeps for people who watch channels).
    const settings = { source: { type: 'xtream', server: 'https://fixture.invalid', username: 'fixture', password: 'fixture' }, theme: '', zip: '', startOn: 'live' };
    const store = {
        settings, lastError: '', lastWatched() { return null; }, favourites() { return []; }, isFavourite() { return false; }, mostWatched() { return []; },
        recents() { return []; }, recordWatched() {}, saveRecent() {},
        saveSettings(change) { Object.assign(settings, change); return true; },
        adultLock: real.data.createPasscodeLock(real.storage, () => now)
    };
    const calls = [];
    let playerOptions;
    const tracks = { audio: [], subtitles: options.subtitles || [] };
    const single = {
        state: { status: 'idle' }, showing: false,
        stop() { this.state = { status: 'idle' }; calls.push(['stop']); },
        setRect(rect) { calls.push(['rect', { ...rect }]); },
        suspend() {}, restore() {}, toggle() {}, resume() {}, pause() {}, seek() {},
        play(request) { this.state = { status: options.startStatus || 'loading', request }; calls.push(['play', request.id]); },
        tracks() { return { audio: tracks.audio.slice(), subtitles: tracks.subtitles.map(track => ({ ...track, selected: this.showing && track.index === this.chosen })) }; },
        selectTrack(type, index) { calls.push(['select', type, index]); this.showing = index !== -1; this.chosen = index; return true; },
        subtitlesShowing() { return this.showing; }
    };
    const window = {
        innerWidth: 1920, innerHeight: 1080, webapis: { avplay: {} },
        TunerData: {
            createStore() { return store; }, catalogIdentity() { return 'fixture'; },
            adultFilter: real.data.adultFilter,
            categoryItems: real.data.categoryItems,
            // Movies & Series browsing with no catalog rows (no network in these tests).
            browse: { ...real.data.browse, createRowsClient() { return { peek() { return null; }, refresh() { return false; } }; } },
            createClient(source, clientOptions) {
                return { catalogIdentity: 'fixture', cancel() {}, guide() { return { then() {} }; }, movieInfo() { return { then() {} }; }, load() {
                    clientOptions.onCatalog('live', channels, liveCats); clientOptions.onStatus('live', { state: 'ready' });
                    clientOptions.onCatalog('movies', movies, [{ id: 'films', name: 'Films' }]);
                } };
            }
        },
        TunerPlayer: { create(value) { playerOptions = value; return single; } },
        tizen: { tvinputdevice: { getSupportedKeys() { return ['Caption', 'ColorF2Yellow', '1'].map((name, code) => ({ name, code })); }, registerKey() {} } },
        addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }
    };
    class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    vm.runInNewContext(appSource, {
        window, document, Date: FixtureDate,
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, setInterval() { return ++timerId; }
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
            now = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        now = end;
    }
    return {
        document, node, calls, settings, single, values: real.values, advance,
        key(code) { emit('keydown', code); emit('keyup', code); },
        resize(width, height) { window.innerWidth = width; window.innerHeight = height; (windowEvents.resize || []).forEach(fn => fn({})); },
        state(status) { single.state = { ...single.state, status }; playerOptions.onState(single.state); },
        subtitle(text, duration) { playerOptions.onSubtitle(text, duration); },
        get playerOptions() { return playerOptions; },
        get controlsVisible() { return !!node('player-overlay').querySelector('.player-bottom'); },
        get dialogOpen() { return !node('dialog-layer').className.includes('hidden'); },
        text(id) { return node(id).textContent; }
    };
}

// The guide opens with row 0 highlighted, so OK alone watches the first channel.
function watchFirstChannel(h) { h.key(13); assert.match(h.document.body.className, /fullscreen/); }

test('live controls hide after 5 seconds even when the stream was still connecting', () => {
    const h = harness();
    watchFirstChannel(h);
    assert.equal(h.controlsVisible, true);
    h.advance(4900); assert.equal(h.controlsVisible, true);
    h.advance(200); assert.equal(h.controlsVisible, false, 'loading no longer pins the controls');
    h.state('playing'); assert.equal(h.controlsVisible, false);
    assert.equal(h.node('player-overlay').querySelector('.player-top'), null, 'the channel name hides too');
});

test('OK reveals controls with focus and they still hide; every key restarts the one timer', () => {
    const h = harness({ startStatus: 'playing' });
    watchFirstChannel(h); h.advance(5000); assert.equal(h.controlsVisible, false);
    h.key(13); assert.equal(h.controlsVisible, true); assert.equal(h.document.activeElement.id, 'play-toggle');
    h.advance(4000); h.key(39); assert.equal(h.document.activeElement.id, 'play-fav');
    h.advance(4000); assert.equal(h.controlsVisible, true, 'the arrow key restarted the timer');
    h.advance(1100); assert.equal(h.controlsVisible, false, 'controls focused on a button still hide');
    h.key(38); h.advance(5000); assert.equal(h.controlsVisible, false, 'channel changes do not leave controls behind');
});

test('controls wait for an open dialog or a pause, then hide once playback continues', () => {
    const h = harness({ startStatus: 'playing' });
    watchFirstChannel(h);
    h.key(405); assert.equal(h.dialogOpen, true);
    h.advance(20000); assert.equal(h.controlsVisible, true);
    h.key(10009); assert.equal(h.dialogOpen, false);
    h.advance(5100); assert.equal(h.controlsVisible, false);
    h.key(13); h.state('paused'); h.advance(20000); assert.equal(h.controlsVisible, true);
    h.state('playing'); h.advance(5100); assert.equal(h.controlsVisible, false);
});

test('full-screen playback sets the whole stage before opening, including channel changes', () => {
    const h = harness({ startStatus: 'playing' });
    watchFirstChannel(h);
    const before = (id) => { const i = h.calls.findIndex(call => call[0] === 'play' && call[1] === id); return h.calls.slice(0, i).filter(call => call[0] === 'rect').at(-1)[1]; };
    assert.deepEqual(before('live:0'), FULL);
    h.key(40);
    assert.deepEqual(before('live:1'), FULL, 'the next visible channel opens full screen');
    assert.deepEqual(h.calls.filter(call => call[0] === 'rect').at(-1)[1], FULL);
});

test('the on-screen keyboard shortening the window does not shrink the app', () => {
    const h = harness();
    h.resize(1920, 1080); assert.equal(h.node('app').style.transform, 'scale(1)');
    h.resize(1920, 560); assert.equal(h.node('app').style.transform, 'scale(1)', 'keyboard open: still full width');
    h.resize(1280, 720); assert.equal(h.node('app').style.transform, 'scale(' + 1280 / 1920 + ')', 'a 720p browser still fits');
});

test('subtitles: the chooser lists tracks for live TV, an empty stream says so, cues are drawn', () => {
    const empty = harness({ startStatus: 'playing' });
    watchFirstChannel(empty); empty.key(10221);
    assert.match(empty.text('dialog-layer'), /No subtitles in this stream/);
    const h = harness({ startStatus: 'playing', subtitles: [{ index: 2, language: 'eng', label: 'English' }, { index: 3, language: 'spa', label: '' }] });
    watchFirstChannel(h); h.key(13);
    h.node('play-subtitles').click();
    assert.match(h.text('dialog-layer'), /✓ Off/); assert.match(h.text('dialog-layer'), /English/); assert.match(h.text('dialog-layer'), /spa/);
    h.node('dialog-1').click();
    assert.deepEqual(h.calls.at(-1), ['select', 'TEXT', 2]);
    h.subtitle('Hello <i>there</i><br/>friend', 2000);
    assert.equal(h.text('subtitle-layer'), 'Hello there\nfriend');
    assert.doesNotMatch(h.node('subtitle-layer').className, /hidden/);
    h.advance(2300); assert.match(h.node('subtitle-layer').className, /hidden/);
    h.key(405); assert.match(h.text('dialog-layer'), /✓ English/);
    h.node('dialog-0').click(); assert.deepEqual(h.calls.at(-1), ['select', 'TEXT', -1]);
});

test('the Subtitles setting is saved and read by the player for each stream', () => {
    const h = harness();
    h.node('tab-4').click();
    assert.equal(h.playerOptions.subtitles(), false);
    assert.match(h.text('subtitles-setting'), /Subtitles: Off/);
    h.node('subtitles-setting').click();
    assert.equal(h.settings.subtitles, true); assert.equal(h.playerOptions.subtitles(), true);
    assert.match(h.text('subtitles-setting'), /Subtitles: On/);
});

function guideNames(h) { return h.node('main').querySelectorAll('.channel-name').map(n => n.textContent); }
function digits(h, value) { for (const ch of value) h.key(48 + Number(ch)); }

test('adult categories and items stay hidden until a passcode unlocks them, and locking needs none', () => {
    const h = harness();
    assert.deepEqual(guideNames(h), ['CNN', 'Cartoons', 'BBC']);
    assert.ok(!h.text('main').includes('XXX'), 'the adult category chip is hidden');
    h.node('tab-4').click();
    assert.match(h.text('adult-setting'), /Adult content: Locked/);
    assert.equal(h.document.getElementById('adult-passcode'), null, 'no passcode to change yet');
    h.node('adult-setting').click();
    assert.match(h.text('dialog-layer'), /Create a passcode/);
    assert.match(h.text('dialog-layer'), /Forgot the passcode\? Remove and reinstall the app, or clear its data\./);
    digits(h, '2468'); assert.match(h.text('dialog-layer'), /same passcode again/);
    digits(h, '2460'); assert.match(h.text('dialog-layer'), /did not match/);
    digits(h, '2468'); digits(h, '2468');
    assert.equal(h.dialogOpen, false);
    assert.match(h.text('adult-setting'), /Unlocked/);
    assert.ok(![...h.values.values()].some(value => value.includes('2468')), 'the digits are never stored');
    h.node('tab-0').click();
    assert.deepEqual(guideNames(h), ['CNN', 'Cartoons', 'Late Night', 'BBC']);
    h.node('tab-4').click(); h.node('adult-setting').click();
    assert.equal(h.dialogOpen, false, 'locking asks for nothing');
    assert.match(h.text('adult-setting'), /Locked/);
    h.node('tab-3').click(); const input = h.node('search-input'); input.value = 'night'; input.oninput();
    h.advance(200);
    assert.deepEqual(h.node('search-results').querySelectorAll('.search-result').map(n => n.textContent), ['Movie nightMovie']);
});

test('the passcode pad works with arrows and OK; five wrong tries wait 60 seconds', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('adult-setting').click();
    digits(h, '1111'); digits(h, '1111');
    h.node('adult-setting').click();
    h.node('adult-setting').click();
    assert.match(h.text('dialog-layer'), /Unlock adult content/);
    assert.equal(h.document.activeElement.id, 'pin-1');
    h.key(39); assert.equal(h.document.activeElement.id, 'pin-2');
    h.key(40); assert.equal(h.document.activeElement.id, 'pin-5');
    h.key(40); h.key(40); assert.equal(h.document.activeElement.id, 'pin-0');
    h.key(13); h.key(13); h.key(13); h.key(13);
    assert.match(h.text('pin-message'), /Wrong passcode\. 4 tries left/);
    for (let i = 0; i < 4; i++) digits(h, '9999');
    assert.match(h.text('pin-message'), /Too many wrong tries\. Try again in 60 s/);
    assert.equal(h.node('pin-1').disabled, true); assert.equal(h.document.activeElement.id, 'pin-cancel');
    digits(h, '1111'); assert.match(h.text('adult-setting'), /Locked/);
    h.advance(30000); assert.match(h.text('pin-message'), /30 s/);
    h.advance(30000); assert.equal(h.node('pin-1').disabled, false);
    digits(h, '1111');
    assert.equal(h.dialogOpen, false); assert.match(h.text('adult-setting'), /Unlocked/);
    h.node('adult-setting').click(); h.node('adult-passcode').click();
    digits(h, '1111'); digits(h, '4321'); digits(h, '4321');
    assert.equal(h.dialogOpen, false);
    h.node('adult-setting').click(); digits(h, '1111'); assert.match(h.text('pin-message'), /Wrong passcode/);
    digits(h, '4321'); assert.match(h.text('adult-setting'), /Unlocked/);
});
