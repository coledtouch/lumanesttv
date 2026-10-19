'use strict';
// Remote-control navigation: runs the real app.js against a small DOM and a recording player and walks
// it with key codes. Each test is a key sequence and the focus/state it must produce (Back ladder,
// guide zones, the full-screen player, dialogs, text fields, Search, Settings and Multi View setup).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const MIN = 60000;

function realData() {
    const values = new Map();
    const storage = { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
    const window = { Promise, localStorage: storage, XMLHttpRequest: function () {} };
    vm.runInNewContext(dataSource, { window, console });
    return { data: window.TunerData, storage };
}

const KEY = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009, chUp: 427, chDown: 428, yellow: 405, rewind: 412, forward: 417, stop: 413, guide: 458 };

function harness(options = {}) {
    let now = options.now || 1000, timerId = 0;
    const timers = new Map(), documentEvents = {}, windowEvents = {}, rects = {};
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
        blur() { if (document.activeElement === this) { document.activeElement = document.body; if (this.onblur) this.onblur(); } }
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
        // Every element shares one box unless a test lays it out (by id, or a container by its first class),
        // so geometric moves find nothing by default.
        getBoundingClientRect() {
            return rects[this.id] || rects['.' + this.className.split(/\s+/)[0]] || { left: 1398, top: 145, width: 466, height: 263 };
        }
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
    const liveCats = [{ id: 'news', name: 'News' }, { id: 'sports', name: 'Sports' }, { id: 'xxx', name: 'XXX' }];
    // Late Night is adult and hidden, so the guide lists 9 channels; numbers are the provider's.
    const channels = [['CNN', 'news'], ['Cartoons', 'sports'], ['Late Night', 'xxx'], ['BBC News', 'news'], ['ESPN', 'sports'],
        ['ESPN2', 'sports'], ['FS1', 'sports'], ['NBC Sports', 'sports'], ['Fox News', 'news'], ['Sky News', 'news']].map(([name, cat], index) => ({
        id: 'live:' + index, name, number: index + 1, categoryId: cat, categoryIds: [cat], url: 'https://fixture.invalid/' + index + '.m3u8', backups: []
    }));
    const movies = [{ id: 'm:1', name: 'Movie night', categoryIds: ['films'], url: 'https://fixture.invalid/m1.mp4', backups: [] }];
    const settings = { source: options.noSource ? null : { type: 'xtream', server: 'https://fixture.invalid', username: 'fixture', password: 'fixture' }, theme: '', zip: '' };
    const favourites = new Set();
    const store = {
        settings, lastError: '', lastWatched() { return options.lastWatched || null; },
        favourites() { return [...favourites]; }, isFavourite(id) { return favourites.has(id); },
        toggleFavourite(id) { if (favourites.has(id)) favourites.delete(id); else favourites.add(id); },
        mostWatched() { return []; }, recents() { return []; }, recordWatched() {}, saveRecent() {},
        saveSettings(change) { Object.assign(settings, change); return true; },
        adultLock: real.data.createPasscodeLock(real.storage, () => now)
    };
    const calls = [], guideRequests = [];
    let playerOptions, clientOptions, loads = 0;
    const tracks = { audio: options.audio || [], subtitles: options.subtitles || [] };
    const single = {
        state: { status: 'idle' }, showing: false,
        stop() { this.state = { status: 'idle' }; calls.push(['stop']); },
        setRect(rect) { calls.push(['rect', { ...rect }]); },
        suspend() {}, restore() {}, resume() {}, pause() {},
        toggle() { calls.push(['toggle']); }, seek(ms) { calls.push(['seek', ms]); },
        play(request) { this.state = { status: options.startStatus || 'loading', request }; calls.push(['play', request.id]); },
        tracks() {
            return {
                audio: tracks.audio.map(track => ({ ...track, selected: track.index === (this.audio === undefined ? tracks.audio[0].index : this.audio) })),
                subtitles: tracks.subtitles.map(track => ({ ...track, selected: this.showing && track.index === this.chosen }))
            };
        },
        selectTrack(type, index) {
            calls.push(['select', type, index]);
            if (type === 'AUDIO') this.audio = index; else { this.showing = index !== -1; this.chosen = index; }
            return true;
        },
        subtitlesShowing() { return this.showing; }
    };
    const window = {
        innerWidth: 1920, innerHeight: 1080, webapis: { avplay: {} },
        TunerData: {
            createStore() { return store; }, catalogIdentity() { return 'fixture'; },
            adultFilter: real.data.adultFilter, categoryItems: real.data.categoryItems,
            createClient(source, value) {
                clientOptions = value;
                return {
                    catalogIdentity: 'fixture', cancel() {},
                    guide(channel) { return { then(ok) { guideRequests.push({ channel, ok }); } }; },
                    movieInfo() { return { then() {} }; },
                    seriesInfo() { return { then(ok) { if (options.series) ok(options.series.info); } }; },
                    load() {
                        loads++;
                        clientOptions.onStatus('live', { state: 'loading' });
                        if (!options.deferLoad) finishLoad();
                    }
                };
            }
        },
        TunerPlayer: { create(value) { playerOptions = value; return single; } },
        tizen: { tvinputdevice: { getSupportedKeys() { return []; }, registerKey() {} } },
        addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }
    };
    if (options.pairing) window.TunerPairing = { isOpen() { return false; }, open() {} };
    function failLoad(message) { clientOptions.onStatus('live', { state: 'error', message }); }
    function finishLoad() {
        clientOptions.onCatalog('live', channels, liveCats); clientOptions.onStatus('live', { state: 'ready' });
        clientOptions.onCatalog('movies', movies, [{ id: 'films', name: 'Films' }]);
        if (options.series) clientOptions.onCatalog('series', [options.series.item], [{ id: 'shows', name: 'Shows' }]);
    }
    class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    vm.runInNewContext(appSource, {
        window, document, Date: FixtureDate,
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay, every: delay }); return id; }
    }, { filename: 'app.js' });
    function node(id) { const result = document.getElementById(id); assert.ok(result, id + ' exists'); return result; }
    function emit(type, code, extra) {
        const event = { keyCode: code, target: document.activeElement, preventDefault() {}, repeat: false, ...extra };
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
        document, node, calls, settings, single, advance, finishLoad, failLoad, channels,
        key(code, times = 1) { for (let i = 0; i < times; i++) { emit('keydown', typeof code === 'string' ? KEY[code] : code); emit('keyup', typeof code === 'string' ? KEY[code] : code); } },
        // OK held down: the remote repeats keydown until the key is released.
        holdOk() { emit('keydown', 13); advance(700); emit('keydown', 13, { repeat: true }); emit('keyup', 13); },
        type(ch) { emit('keydown', ch.charCodeAt(0), { key: ch }); },
        state(status) { single.state = { ...single.state, status }; playerOptions.onState(single.state); },
        // Lays out a control by id; the box survives re-rendering.
        layout(id, left, top, width, height) { rects[id] = { left, top, width, height }; },
        // Answers the guide requests made so far with programs(channel) (an empty list by default).
        guide(programs) { guideRequests.splice(0).forEach(r => r.ok(programs(r.channel) || [])); },
        get focused() { return document.activeElement.id || document.activeElement.tagName; },
        get dialogOpen() { return !node('dialog-layer').className.includes('hidden'); },
        get fullscreen() { return /fullscreen/.test(document.body.className); },
        get plays() { return calls.filter(call => call[0] === 'play').map(call => call[1]); },
        get loads() { return loads; },
        get highlighted() { return node('main').querySelectorAll('.program').filter(n => /\bfocused\b/.test(n.className)).map(n => n.children[0].textContent); },
        get selectedRow() { const cell = node('main').querySelectorAll('.channel-cell').filter(n => /\bselected\b/.test(n.className))[0]; return cell ? cell.querySelector('.channel-name').textContent : null; },
        get activeChip() { const chip = node('main').querySelectorAll('button').filter(n => /^live-cat-/.test(n.id) && /\bactive\b/.test(n.className))[0]; return chip ? chip.textContent : null; },
        text(id) { return node(id).textContent; },
        now() { return now; }
    };
    return h;
}
const playing = { startStatus: 'playing' };

test('the guide opens with the first row highlighted: OK alone watches it', () => {
    const h = harness();
    assert.deepEqual(h.highlighted.length, 1);
    assert.equal(h.document.activeElement, h.document.body, 'the list highlight is the only focus');
    h.key('ok');
    assert.ok(h.fullscreen); assert.deepEqual(h.plays, ['live:0']);
});

test('while channels load, focus waits on the categories with no reload button, then moves to the list', () => {
    const h = harness({ deferLoad: true });
    assert.equal(h.focused, 'live-cat-0');
    assert.match(h.text('main'), /Loading your channels/);
    assert.equal(h.document.getElementById('empty-action'), null, 'nothing that restarts the download');
    h.key('ok');
    assert.equal(h.loads, 1);
    h.finishLoad();
    assert.equal(h.highlighted.length, 1, 'channels arrive: the first row is highlighted');
    assert.equal(h.document.activeElement, h.document.body);
});

test('Back climbs the guide one level at a time: list -> categories -> tabs -> Close Tuner? (Cancel focused)', () => {
    const h = harness();
    h.key('down', 2); assert.equal(h.selectedRow, 'BBC News');
    h.key('back');
    assert.equal(h.focused, 'live-cat-0'); assert.equal(h.activeChip, 'All Channels');
    assert.equal(h.highlighted.length, 0, 'no stale program highlight next to the focused chip');
    assert.equal(h.text('brand-hint'), 'Back Tabs');
    h.key('back'); assert.equal(h.focused, 'tab-0'); assert.equal(h.text('brand-hint'), 'OK Open');
    h.key('back');
    assert.ok(h.dialogOpen); assert.match(h.text('dialog-layer'), /Close Tuner\?/);
    assert.equal(h.focused, 'dialog-close'); assert.equal(h.text('dialog-close'), 'Cancel');
    h.key('left'); assert.equal(h.text(h.focused), 'Exit', 'the two choices sit in a row');
    h.key('back'); assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'tab-0');
    h.key('down'); assert.equal(h.selectedRow, 'BBC News', 'the list keeps its row');
});

test('the hero row sits above the categories: Up reaches the preview, Left the Favorite button, Down returns', () => {
    const h = harness();
    h.key('up'); assert.equal(h.focused, 'live-cat-0');
    h.key('up'); assert.equal(h.focused, 'preview-frame');
    assert.equal(h.document.getElementById('guide-watch'), null, 'no separate Watch stop');
    h.key('left'); assert.equal(h.focused, 'guide-fav');
    h.key('ok'); assert.match(h.text('guide-fav'), /Saved/); assert.equal(h.focused, 'guide-fav');
    h.key('right'); assert.equal(h.focused, 'preview-frame');
    h.key('up'); assert.equal(h.focused, 'tab-0');
    h.key('down'); h.key('up'); h.key('up'); h.key('down');
    assert.equal(h.focused, 'live-cat-0');
    h.key('down'); assert.equal(h.highlighted.length, 1); assert.equal(h.selectedRow, 'CNN');
});

test('Down on a focused category shows its channels; Down on the chosen one returns to the same row', () => {
    const h = harness();
    h.key('down', 3); h.key('back');
    while (!/Sports/.test(h.text(h.focused))) h.key('right');
    h.key('down');
    assert.equal(h.activeChip, 'Sports'); assert.equal(h.selectedRow, 'Cartoons');
    h.key('down'); h.key('back'); h.key('down');
    assert.equal(h.selectedRow, 'ESPN', 'the chosen category keeps its row');
});

test('Down from a tab that is not open opens that tab instead of entering the guide', () => {
    const h = harness();
    h.key('back', 2); h.key('right');
    assert.equal(h.focused, 'tab-1');
    h.key('down');
    assert.match(h.node('tab-1').className, /active/);
    assert.notEqual(h.focused, 'tab-1');
});

test('Right and Left walk the schedule program by program, through a gap, and Back returns to now', () => {
    const h = harness();
    // CNN: 15-minute programs, then a 15-minute hole, then an hour-long show.
    h.guide(channel => channel.id === 'live:0' ? [
        { title: 'Early', start: 0, end: 15 * MIN }, { title: 'Second', start: 15 * MIN, end: 30 * MIN },
        { title: 'Late', start: 45 * MIN, end: 60 * MIN }, { title: 'Night', start: 60 * MIN, end: 120 * MIN }
    ] : []);
    assert.deepEqual(h.highlighted, ['Early']);
    const seen = [];
    for (let i = 0; i < 4; i++) { h.key('right'); seen.push(h.highlighted[0]); }
    assert.deepEqual(seen, ['Second', 'No information', 'Late', 'Night']);
    assert.match(h.text('main'), /Back Now/);
    h.key('left'); assert.deepEqual(h.highlighted, ['Late']);
    h.key('left'); assert.deepEqual(h.highlighted, ['No information']);
    h.key('down'); assert.equal(h.highlighted.length, 1, 'another row highlights the same time');
    h.key('up');
    h.key('back'); assert.deepEqual(h.highlighted, ['Early'], 'Back first returns to now, still in the list');
    h.key('back'); assert.equal(h.focused, 'live-cat-0');
});

test('OK on a future program opens its details as a button row; Down does nothing, Back keeps the time', () => {
    const h = harness();
    h.guide(channel => channel.id === 'live:0' ? [{ title: 'Now', start: 0, end: 30 * MIN }, { title: 'Next', start: 30 * MIN, end: 60 * MIN }] : []);
    h.key('right'); h.key('ok');
    assert.ok(h.dialogOpen); assert.equal(h.focused, 'dialog-0');
    h.key('down'); assert.equal(h.focused, 'dialog-0');
    h.key('right'); assert.equal(h.focused, 'dialog-1');
    h.key('back'); assert.equal(h.dialogOpen, false); assert.deepEqual(h.highlighted, ['Next']);
});

test('CH+ and CH- page the guide by four rows and keep the highlight in its slot', () => {
    const h = harness();
    h.key('down'); h.key('chDown');
    assert.equal(h.selectedRow, 'FS1');
    h.key('chUp'); assert.equal(h.selectedRow, 'Cartoons');
    h.key('back', 2); h.key('chDown');
    assert.equal(h.document.activeElement, h.document.body, 'paging from the tabs moves focus into the list');
    assert.equal(h.text('brand-hint'), 'Back Categories');
});

test('number keys jump the guide to a channel, and tune it while watching', () => {
    const h = harness(playing);
    h.key(52);
    assert.match(h.text('channel-entry'), /CH 4/);
    h.advance(1500);
    assert.equal(h.selectedRow, 'BBC News');
    assert.match(h.node('channel-entry').className, /hidden/);
    h.key('ok'); assert.deepEqual(h.plays, ['live:3']);
    h.key(53); h.key('ok');
    assert.deepEqual(h.plays, ['live:3', 'live:4'], 'OK confirms the number at once');
    h.key(57); h.key(57); h.advance(1500);
    assert.match(h.text('toast'), /No channel 99/);
});

test('OK on the channel already playing in the preview opens it without restarting the stream', () => {
    const h = harness({ ...playing, lastWatched: 'live:3' });
    assert.equal(h.selectedRow, 'BBC News', 'the guide opens on the channel last watched');
    assert.deepEqual(h.plays, ['live:3']);
    h.key('ok');
    assert.ok(h.fullscreen); assert.deepEqual(h.plays, ['live:3']);
});

test('the player bar: CH+ is the next higher channel, focus stays on the button, Up/Down change channel, Left/Right move', () => {
    const h = harness(playing);
    h.key('ok'); h.key('ok');
    assert.equal(h.focused, 'play-toggle');
    h.key('right', 2); assert.equal(h.focused, 'play-subtitles');
    h.key('chUp');
    assert.deepEqual(h.plays, ['live:0', 'live:1']); assert.equal(h.focused, 'play-subtitles');
    h.advance(1000); h.key('up'); assert.deepEqual(h.plays.at(-1), 'live:0');
    h.advance(1000); h.key('down'); assert.deepEqual(h.plays.at(-1), 'live:1');
    assert.equal(h.focused, 'play-subtitles');
    h.key('left'); assert.equal(h.focused, 'play-fav');
    assert.match(h.text('player-hint'), /← → Choose/);
    h.key('back'); assert.equal(h.document.activeElement, h.document.body, 'Back hides the bar');
    assert.ok(h.fullscreen);
    h.key('back'); assert.equal(h.fullscreen, false);
    assert.equal(h.selectedRow, 'Cartoons', 'the guide follows the channel being watched');
});

test('rapid channel presses tune once at once and once more 500 ms after the last', () => {
    const h = harness(playing);
    h.key('ok'); h.advance(1000);
    h.key('down'); h.key('down'); h.key('down');
    assert.deepEqual(h.plays, ['live:0', 'live:1']);
    assert.match(h.text('player-overlay'), /5 {2}ESPN/, 'the banner shows the channel that will tune');
    assert.match(h.text('player-hint'), /^OK Watch now/, 'the hint says what OK does now');
    h.advance(500);
    assert.deepEqual(h.plays, ['live:0', 'live:1', 'live:4']);
});

test('the subtitle list opens on the chosen track, moves with Up/Down only and returns focus to its button', () => {
    const h = harness({ ...playing, subtitles: [{ index: 2, label: 'English' }, { index: 3, label: 'Spanish' }] });
    h.single.showing = true; h.single.chosen = 3;
    h.key('ok'); h.key('ok'); h.key('right', 2); h.key('ok');
    assert.equal(h.focused, 'dialog-2'); assert.match(h.text('dialog-2'), /✓ Spanish/);
    h.key('right'); assert.equal(h.focused, 'dialog-2', 'Right does nothing in a list');
    h.key('up'); assert.equal(h.focused, 'dialog-1');
    h.key('back'); assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'play-subtitles');
});

test('choosing an audio track returns focus to the Audio button', () => {
    const h = harness({ ...playing, audio: [{ index: 0, label: 'English' }, { index: 1, label: 'Spanish' }] });
    h.key('ok'); h.key('ok'); h.key('right', 3);
    assert.equal(h.focused, 'play-tracks');
    h.key('ok'); assert.equal(h.focused, 'dialog-0');
    h.key('down'); h.key('ok');
    assert.deepEqual(h.calls.filter(call => call[0] === 'select').at(-1), ['select', 'AUDIO', 1]);
    assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'play-tracks');
});

test('a failed stream shows Retry focused; OK retries and Back leaves', () => {
    const h = harness({ startStatus: 'error' });
    h.key('ok');
    assert.equal(h.focused, 'play-toggle'); assert.match(h.text('play-toggle'), /Retry/);
    assert.equal(h.document.getElementById('play-retry'), null);
    h.key('ok'); assert.deepEqual(h.plays, ['live:0', 'live:0']);
    h.key('back'); assert.equal(h.fullscreen, false);
});

test('movies: the seek bar is reachable, Rewind/Fast forward seek, Back hides then returns to the details', () => {
    const h = harness(playing);
    h.node('tab-1').click(); h.node('card-0').click(); h.node('detail-play').click();
    assert.ok(h.fullscreen);
    h.key('right'); assert.deepEqual(h.calls.at(-1), ['seek', 10000]);
    h.key('ok'); assert.equal(h.focused, 'play-toggle');
    h.key('up'); assert.equal(h.focused, 'play-seek');
    assert.match(h.text('player-hint'), /Seek 10 seconds/);
    h.key('left'); assert.deepEqual(h.calls.at(-1), ['seek', -10000]);
    h.key('down'); assert.equal(h.focused, 'play-toggle');
    h.key('forward'); assert.deepEqual(h.calls.at(-1), ['seek', 30000]);
    h.key('back'); h.key('back');
    assert.equal(h.fullscreen, false); assert.equal(h.focused, 'detail-play');
});

test('a live channel opened from Search returns to that result, with Search remembered', () => {
    const h = harness(playing);
    h.node('tab-3').click();
    const input = h.node('search-input'); input.value = 'news'; input.oninput(); h.advance(200);
    assert.equal(h.text('result-1'), 'Fox NewsLive TV');
    h.node('result-1').focus(); h.key('ok');
    assert.ok(h.fullscreen); assert.deepEqual(h.plays, ['live:8']);
    h.key('down'); assert.deepEqual(h.plays, ['live:8', 'live:9'], 'from Search, channels step through the full list');
    h.key('back');
    assert.equal(h.fullscreen, false); assert.match(h.node('tab-3').className, /active/);
    assert.equal(h.focused, 'result-1');
    h.key('back'); assert.equal(h.focused, 'tab-3');
    h.key('down'); assert.equal(h.focused, 'result-1', 'entering Search again restores the last result');
});

test('Search moves spatially: Down from a result goes to the one below; Up from the field reaches the tabs', () => {
    const h = harness();
    h.node('tab-3').click();
    const input = h.node('search-input'); input.value = 'n'; input.oninput(); h.advance(200);
    h.layout('search-input', 56, 244, 1808, 88);
    for (let i = 0; i < 6; i++) h.layout('result-' + i, 61 + (i % 3) * 583, 390 + Math.floor(i / 3) * 114, 565, 98);
    h.node('result-0').focus();
    h.key('down'); assert.equal(h.focused, 'result-3');
    h.key('right'); assert.equal(h.focused, 'result-4');
    h.key('up'); assert.equal(h.focused, 'result-1');
    h.key('up'); assert.equal(h.focused, 'search-input');
    h.key('down'); assert.equal(h.focused, 'result-0', 'ties go to the first result');
    h.key('up'); h.key('up'); assert.equal(h.focused, 'tab-3');
});

test('text fields are read-only until OK; Back ends editing first, then leaves the field', () => {
    const h = harness();
    h.node('tab-4').click();
    const user = h.node('source-user');
    assert.equal(user.readOnly, true);
    user.focus(); h.key('ok');
    assert.equal(user.readOnly, false); assert.match(user.className, /editing/); assert.equal(h.focused, 'source-user');
    h.key('back');
    assert.equal(user.readOnly, true); assert.equal(h.focused, 'source-user', 'Back closes the keyboard, focus stays');
    h.key('ok'); h.key(65376);
    assert.equal(h.focused, 'source-password', 'Done moves to the next field');
    h.type('x'); assert.equal(h.node('source-password').readOnly, false, 'typing starts editing');
    h.key('back'); h.key('back');
    assert.equal(h.focused, 'tab-4');
});

test('Settings keeps unsaved typing and the last focused control across Back and Down', () => {
    const h = harness();
    h.node('tab-4').click();
    assert.equal(h.focused, 'source-type');
    const user = h.node('source-user'); user.value = 'typed'; user.oninput();
    h.node('theme-setting').focus();
    h.key('back'); assert.equal(h.focused, 'tab-4');
    h.key('down');
    assert.equal(h.node('source-user').value, 'typed'); assert.equal(h.focused, 'theme-setting');
    h.key('back'); h.key('back');
    assert.equal(h.focused, 'tab-0', 'Back from another tab bar lands on Live TV');
});

test('Playlist type is a button: arrows never change it, OK switches it and keeps focus', () => {
    const h = harness();
    h.node('tab-4').click();
    assert.equal(h.focused, 'source-type'); assert.equal(h.node('source-type').value, 'xtream');
    h.key('right'); h.key('left'); assert.equal(h.node('source-type').value, 'xtream');
    h.node('source-type').focus(); h.key('ok');
    assert.equal(h.node('source-type').value, 'm3u'); assert.equal(h.focused, 'source-type');
    assert.ok(h.document.getElementById('source-m3u'));
});

test('closing About returns focus to About Tuner', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('about-tuner').focus();
    h.key('ok'); assert.ok(h.dialogOpen); assert.equal(h.focused, 'dialog-close');
    h.key('back'); assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'about-tuner');
});

test('focus lost to nothing is restored on the next key', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('theme-setting').focus();
    h.document.activeElement = h.document.body;
    h.key('right');
    assert.equal(h.focused, 'theme-setting');
});

test('a toast keeps clear of a focused control in the lower half', () => {
    const h = harness();
    h.node('tab-4').click();
    h.layout('subtitles-setting', 56, 933, 187, 59);
    h.node('subtitles-setting').focus();
    h.key('ok');
    assert.match(h.node('toast').className, /top/);
});

test('Multi View setup: Up/Down move between the channel row and the audio row, Up from the top reaches the tabs', () => {
    const h = harness();
    h.key('back', 2); h.key('right', 5); h.key('down');
    assert.equal(h.focused, 'dual-pick-0', 'Down from the Multi View tab enters it the first time');
    h.key('down'); assert.equal(h.focused, 'dual-audio-0');
    h.key('up'); h.key('right'); assert.equal(h.focused, 'dual-pick-1');
    h.key('down'); assert.equal(h.focused, 'dual-audio-1');
    h.key('up'); h.key('up'); assert.equal(h.focused, 'tab-5');
    h.key('down'); assert.equal(h.focused, 'dual-pick-1', 'entering again restores the last control');
});

test('Multi View picker: the full numbered list, Up from the first result reaches search, CH pages, Back returns', () => {
    const h = harness();
    h.node('tab-5').click(); h.key('ok');
    assert.equal(h.focused, 'dual-result-0'); assert.equal(h.text('dual-result-0'), '1  CNN');
    assert.equal(h.node('dialog-layer').querySelectorAll('.episode').length, 9);
    h.key('up'); assert.equal(h.focused, 'dual-channel-query');
    h.key('down'); h.key('chDown'); assert.equal(h.focused, 'dual-result-8');
    h.key('chUp'); assert.equal(h.focused, 'dual-result-0');
    h.key('ok'); assert.equal(h.focused, 'dual-pick-1', 'after the first pick, the other slot is next');
    assert.match(h.text('dual-pick-0'), /CNN/);
    h.key('ok'); h.key('back'); assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'dual-pick-1');
});

test('coming back to Live TV keeps the row and category, even with a channel in the preview', () => {
    const h = harness(playing);
    h.key('ok'); h.key('back');
    assert.equal(h.fullscreen, false); assert.equal(h.selectedRow, 'CNN');
    h.key('down', 3); assert.equal(h.selectedRow, 'ESPN');
    h.node('tab-1').click(); h.node('tab-0').click();
    assert.equal(h.selectedRow, 'ESPN');
    assert.deepEqual(h.plays, ['live:0', 'live:0'], 'the preview resumes the watched channel');
});

// Settings as laid out on the TV (stage pixels): the form on the left, the side panel on the right.
function layoutSettings(h) {
    h.layout('.settings-main', 56, 233, 1030, 760); h.layout('.settings-side', 1136, 233, 700, 760);
    h.layout('pair-phone', 747, 252, 319, 65);
    h.layout('source-type', 56, 404, 1030, 75); h.layout('source-server', 56, 545, 1030, 75);
    h.layout('source-user', 56, 686, 491, 75); h.layout('source-password', 571, 686, 491, 75);
    h.layout('save-source', 56, 786, 268, 65); h.layout('refresh-source', 342, 786, 147, 65);
    h.layout('subtitles-setting', 56, 933, 187, 59); h.layout('adult-setting', 261, 933, 284, 59);
    h.layout('local-setting', 1163, 394, 646, 59); h.layout('lineup-setting', 1163, 471, 646, 59);
    h.layout('category-order-setting', 1163, 548, 646, 59); h.layout('theme-setting', 1163, 625, 646, 59);
    h.layout('about-tuner', 1163, 891, 199, 65);
}
function chooseChip(h, name) {
    for (let i = 0; i < 12 && h.text(h.focused) !== name; i++) h.key('right');
    assert.equal(h.text(h.focused), name);
}

test('Settings: Down from Password reaches Save and connect; Left/Right keep to their row; Up never crosses columns', () => {
    const h = harness({ pairing: true });
    h.node('tab-4').click(); layoutSettings(h);
    h.node('source-password').focus();
    h.key('down'); assert.equal(h.focused, 'save-source', 'nothing in line below: the next row, from its first control');
    h.key('right'); assert.equal(h.focused, 'refresh-source');
    h.key('right'); assert.equal(h.focused, 'refresh-source', 'no jump up-right to Password');
    h.node('source-user').focus(); h.key('down'); assert.equal(h.focused, 'save-source');
    h.node('pair-phone').focus();
    h.key('left'); assert.equal(h.focused, 'pair-phone', 'nothing on its row to the left: no jump to Username');
    h.key('down'); assert.equal(h.focused, 'source-type');
    h.key('right'); assert.equal(h.focused, 'local-setting');
    h.node('about-tuner').focus(); h.key('left'); assert.equal(h.focused, 'adult-setting');
    h.node('local-setting').focus(); h.key('up'); assert.equal(h.focused, 'tab-4', 'Up from the side panel goes to the tabs');
});

test('first launch: Pair, Down to Username, Right to Password, Down reaches Save and connect', () => {
    const h = harness({ pairing: true, noSource: true });
    assert.match(h.node('tab-4').className, /active/);
    layoutSettings(h);
    assert.equal(h.focused, 'pair-phone');
    h.key('down', 3); assert.equal(h.focused, 'source-user');
    h.key('right'); assert.equal(h.focused, 'source-password');
    h.key('down'); assert.equal(h.focused, 'save-source');
});

test('series details: Up from the episodes lands on the chosen season, Up from a far season reaches Back, Right from Back stays', () => {
    const episodes = n => [1, 2].map(e => ({ id: 'e' + n + e, episode: e, name: 'Episode ' + e, url: 'https://fixture.invalid/e.mp4' }));
    const h = harness({ series: { item: { id: 's:1', name: 'Quiz Show', categoryIds: ['shows'] },
        info: { seasons: [1, 2, 3].map(number => ({ number, episodes: episodes(number) })) } } });
    h.node('tab-2').click(); h.node('card-0').click();
    h.layout('detail-back', 476, 447, 240, 65); h.layout('.chip-row', 476, 547, 1300, 65);
    [0, 1, 2].forEach(i => h.layout('season-' + i, 480 + i * 189, 547, 171, 65));
    [0, 1].forEach(i => h.layout('episode-' + i, 476, 668 + i * 124, 1300, 106));
    assert.equal(h.focused, 'episode-0');
    h.key('up'); assert.equal(h.focused, 'season-0');
    h.key('right', 2); h.key('ok');
    assert.match(h.node('season-2').className, /active/); assert.equal(h.focused, 'episode-0');
    h.key('up'); assert.equal(h.focused, 'season-2', 'entering the season row lands on the chosen season');
    h.key('up'); assert.equal(h.focused, 'detail-back', 'nothing in line above: the row above in the same column');
    h.key('right'); assert.equal(h.focused, 'detail-back', 'no diagonal jump to a season');
    h.key('down'); assert.equal(h.focused, 'season-2');
});

test('channels that arrive while another tab is open, or after Refresh, still open the guide on the watched channel', () => {
    const h = harness({ ...playing, deferLoad: true, lastWatched: 'live:5' });
    h.node('tab-1').click();
    h.finishLoad();
    h.node('tab-0').click();
    assert.equal(h.selectedRow, 'ESPN2'); assert.deepEqual(h.plays, ['live:5'], 'the preview and the row agree');
    h.node('tab-4').click(); h.node('refresh-source').click();
    h.finishLoad();
    h.key('back', 2);
    assert.match(h.node('tab-0').className, /active/);
    assert.equal(h.selectedRow, 'ESPN2'); assert.equal(h.plays.at(-1), 'live:5');
});

test('when the channels fail to load, focus moves from the categories to Refresh playlist', () => {
    const h = harness({ deferLoad: true });
    assert.equal(h.focused, 'live-cat-0');
    h.failLoad('Unable to load from the provider');
    assert.equal(h.focused, 'empty-action'); assert.equal(h.text('empty-action'), 'Refresh playlist');
});

test('a toast raised from the guide list goes to the top, clear of the highlighted rows', () => {
    const h = harness();
    h.key('down', 3); h.holdOk();
    assert.match(h.text('toast'), /ESPN saved to Favorites/);
    assert.match(h.node('toast').className, /top/);
});

test('in a one-channel category, channel keys and the channel\'s own number do not restart the stream', () => {
    const h = harness(playing);
    h.holdOk(); h.key('back'); chooseChip(h, 'Favorites');
    h.key('down'); assert.equal(h.selectedRow, 'CNN');
    h.key('ok'); assert.ok(h.fullscreen); assert.deepEqual(h.plays, ['live:0']);
    h.advance(1000); h.key('down'); h.advance(1000); h.key('chUp');
    assert.deepEqual(h.plays, ['live:0']); assert.match(h.text('toast'), /No other channels in Favorites/);
    h.key(49); h.key('ok');
    assert.deepEqual(h.plays, ['live:0'], 'typing the number being watched keeps it playing');
});

test('full screen opened from the guide preview: zapping stays in the list and Back returns to the preview', () => {
    const h = harness({ ...playing, lastWatched: 'live:3' });
    h.key('back'); h.key('up'); assert.equal(h.focused, 'preview-frame');
    h.key('ok'); assert.ok(h.fullscreen); assert.deepEqual(h.plays, ['live:3']);
    h.advance(1000); h.key('down'); assert.deepEqual(h.plays, ['live:3', 'live:4']);
    h.key('back');
    assert.equal(h.fullscreen, false); assert.equal(h.focused, 'preview-frame'); assert.equal(h.selectedRow, 'ESPN');
});

test('a channel tuned by number outside the chosen category: Back shows its row under All Channels', () => {
    const h = harness(playing);
    h.key('back'); chooseChip(h, 'News');
    h.key('down'); assert.equal(h.selectedRow, 'CNN');
    h.key('ok'); h.key(53); h.key('ok');
    assert.deepEqual(h.plays, ['live:0', 'live:4']);
    h.advance(1000); h.key('down'); assert.equal(h.plays.at(-1), 'live:5');
    h.key('back');
    assert.equal(h.fullscreen, false); assert.equal(h.activeChip, 'All Channels'); assert.equal(h.selectedRow, 'ESPN2');
});

test('CH pages Search results only within the results; a short last row is reached from above', () => {
    const h = harness();
    h.node('tab-3').click();
    const input = h.node('search-input'); input.value = 'n'; input.oninput(); h.advance(200);
    h.layout('search-input', 56, 244, 1808, 88);
    for (let i = 0; i < 5; i++) h.layout('result-' + i, 61 + (i % 3) * 583, 390 + Math.floor(i / 3) * 114, 565, 98);
    h.node('result-2').focus();
    h.key('down'); assert.equal(h.focused, 'result-4', 'the nearest result in the short row below');
    h.key('chUp'); assert.equal(h.focused, 'result-1', 'CH+ stops at the first row');
    h.key('chUp'); assert.equal(h.focused, 'result-1');
    h.key('chDown'); assert.equal(h.focused, 'result-4');
});

test('Guide, CH and color keys work on a text field that is not being edited', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('source-server').focus();
    h.key('guide'); assert.match(h.node('tab-0').className, /active/);
    h.node('tab-3').click(); assert.equal(h.focused, 'search-input');
    h.key('ok'); h.key('guide');
    assert.match(h.node('tab-3').className, /active/, 'while typing, keys belong to the keyboard');
    h.key('back'); h.key('guide'); assert.match(h.node('tab-0').className, /active/);
});

test('the guide refreshes every minute without moving focus in the categories, the hero or the tab bar', () => {
    const h = harness();
    h.guide(channel => channel.id === 'live:0' ? [{ title: 'Early', start: 0, end: 15 * MIN }, { title: 'Second', start: 15 * MIN, end: 60 * MIN }] : []);
    h.key('back'); assert.equal(h.focused, 'live-cat-0');
    assert.equal(h.node('main').querySelector('h1').textContent, 'Early');
    h.advance(16 * MIN);
    assert.equal(h.node('main').querySelector('h1').textContent, 'Second', 'the guide moved on to the program on now');
    assert.equal(h.focused, 'live-cat-0');
    h.key('up'); h.advance(MIN); assert.equal(h.focused, 'preview-frame');
    h.key('up'); h.advance(MIN); assert.equal(h.focused, 'tab-0');
});

test('focus left on a hidden element is restored on the next key, and focus never scrolls the stage', () => {
    const h = harness();
    h.node('tab-4').click(); h.node('theme-setting').focus();
    h.document.activeElement = h.node('channel-entry');
    assert.equal(h.node('channel-entry').offsetWidth, 0, 'the channel-number badge is hidden');
    h.key('right'); assert.equal(h.focused, 'theme-setting');
    h.document.documentElement.scrollTop = 120;
    h.key('back'); assert.equal(h.focused, 'tab-4');
    assert.equal(h.document.documentElement.scrollTop, 0);
});
