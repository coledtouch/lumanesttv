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
    const movies = options.movies || [{ id: 'm:1', name: 'Movie night', categoryIds: ['films'], url: 'https://fixture.invalid/m1.mp4', backups: [] }];
    const movieCats = options.movieCats || [{ id: 'films', name: 'Films' }];
    // By default an existing customer who opens on Live TV; startOn: 'home' (or null: decide at launch) for Home.
    const settings = { source: options.noSource ? null : { type: 'xtream', server: 'https://fixture.invalid', username: 'fixture', password: 'fixture' }, theme: '', zip: '' };
    if (options.startOn !== null) settings.startOn = options.startOn || 'live';
    Object.assign(settings, options.settings || {});
    const favourites = new Set(options.favourites || []);
    const seen = [], recents = options.recents || [], upNext = options.upNext || [];
    const store = {
        settings, lastError: '', lastWatched() { return options.lastWatched || null; },
        favourites() { return [...favourites]; }, isFavourite(id) { return favourites.has(id); },
        toggleFavourite(id) { if (favourites.has(id)) favourites.delete(id); else favourites.add(id); },
        mostWatched() { return options.mostWatched || []; }, recents() { return recents.slice(); }, recordWatched() {}, saveRecent() {},
        upNext() { return upNext.slice(); }, seen() { return seen.slice(); },
        clearUpNext(id) { for (let i = upNext.length - 1; i >= 0; i--) if (upNext[i].seriesId === id) upNext.splice(i, 1); return true; },
        recordSeen(id) { const at = seen.findIndex(entry => entry.id === id); if (at >= 0) seen.splice(at, 1); seen.unshift({ id, updated: now }); },
        saveSettings(change) { Object.assign(settings, change); return true; },
        adultLock: real.data.createPasscodeLock(real.storage, () => now)
    };
    // The catalog rows endpoint: options.rows is the saved copy (no network in these tests). With
    // options.rowsLater the app's one refresh waits for h.deliverRows(rows).
    let rowsAnswer = null, rowsAsked = false;
    const browse = Object.assign({}, real.data.browse, {
        createRowsClient() {
            return {
                peek() { return options.rows ? real.data.browse.parseRows(options.rows) : null; },
                refresh(onRows) { if (!options.rowsLater || rowsAsked) return false; rowsAsked = true; rowsAnswer = onRows; return true; }
            };
        }
    });
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
            adultFilter: real.data.adultFilter, categoryItems: real.data.categoryItems, browse,
            createClient(source, value) {
                clientOptions = value;
                return {
                    catalogIdentity: 'fixture', cancel() {},
                    guide(channel) { return { then(ok) { guideRequests.push({ channel, ok }); } }; },
                    movieInfo() { return { then() {} }; },
                    seriesInfo(item) { return { then(ok) { const info = options.seriesInfo ? options.seriesInfo(item) : options.series && options.series.info; if (info) ok(info); } }; },
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
        clientOptions.onCatalog('movies', movies, movieCats); clientOptions.onStatus('movies', { state: 'ready' });
        clientOptions.onCatalog('series', options.seriesList || (options.series ? [options.series.item] : []), options.seriesCats || [{ id: 'shows', name: 'Shows' }]);
        clientOptions.onStatus('series', { state: 'ready' });
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
        document, node, calls, settings, single, advance, finishLoad, failLoad, channels, favourites, seen, store,
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
        now() { return now; },
        deliverRows(rows) { assert.ok(rowsAnswer, 'the app asked for the rows'); const answer = rowsAnswer; rowsAnswer = null; answer(real.data.browse.parseRows(rows)); },
        // Runs the queued timers (index slices) until test() holds, at most 50 rounds of 1 ms.
        until(test) { for (let i = 0; i < 50 && !test(); i++) advance(1); return test(); },
        // Ids that occur more than once on the page (a page drawn twice into itself).
        duplicateIds() { const ids = node('app').querySelectorAll('button').map(n => n.id).filter(Boolean); return ids.filter((id, i) => ids.indexOf(id) !== i); }
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
    // A series poster in Discover (Type: Series) opens the details.
    h.node('tab-1').click(); h.node('discover-type').click(); h.node('dialog-1').click(); h.node('card-0').click();
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

// ---------------------------------------------------------------- Movies & Series (docs/browse.md)
// English, Netflix and French movies, six series, and catalog rows whose Popular list matches eight films.
function vod(extra = {}) {
    const film = (i, cat) => ({ id: 'm:' + cat + i, name: (cat === 'fr' ? 'Film francais ' : cat === 'nf' ? 'Netflix film ' : 'Film ') + String(i).padStart(2, '0'),
        categoryIds: [cat], year: '2020', rating: String(5 + (i % 5)), added: 1000 + i + (cat === 'nf' ? 100 : 0), plot: 'The plot of film ' + i + '.',
        url: 'https://fixture.invalid/' + cat + i + '.mp4', backups: [], image: 'https://fixture.invalid/p/' + cat + i + '.jpg' });
    const movies = [...Array.from({ length: 12 }, (_, i) => film(i + 1, 'en')), ...Array.from({ length: 6 }, (_, i) => film(i + 1, 'nf')), ...Array.from({ length: 3 }, (_, i) => film(i + 1, 'fr'))];
    const seriesList = Array.from({ length: 6 }, (_, i) => ({ id: 's:' + (i + 1), name: 'Show ' + (i + 1), categoryIds: ['shows'], year: '2019', rating: '7', added: 500 + i, url: '', backups: [], image: '' }));
    const rows = { v: 1, source: 'tmdb', movie: { popular: movies.slice(0, 8).map((m, i) => ({ id: 100 + i, title: m.name, year: '2020', origin: ['US'], genres: [28] }))
        .concat([{ id: 300, title: 'Film francais 01', year: '2020', origin: ['FR'], genres: [18] }]) }, tv: {}, genres: { movie: [{ id: 28, name: 'Action' }, { id: 18, name: 'Drama' }], tv: [] } };
    return { movies, movieCats: [{ id: 'en', name: 'EN | Movies' }, { id: 'nf', name: 'NETFLIX Movies' }, { id: 'fr', name: 'FR | Films' }],
        seriesList, seriesCats: [{ id: 'shows', name: 'Shows' }], rows, startOn: 'home', ...extra };
}
function shelfTitles(h) { return h.node('main').querySelectorAll('.shelf-title').map(n => n.textContent); }
function gridNames(h) { return h.node('main').querySelectorAll('.poster-title').filter(n => /^card-/.test(n.parentNode.id)).map(n => n.textContent); }

test('the start section: Home for new customers, Live TV for customers who watch channels; decided once and kept', () => {
    const fresh = harness(vod({ startOn: null }));
    assert.equal(fresh.settings.startOn, 'home'); assert.match(fresh.node('tab-6').className, /active/);
    assert.deepEqual(fresh.node('topbar').querySelectorAll('button').map(n => n.textContent), ['Home', 'Live TV', 'Discover', 'Library', 'Search', 'Settings', 'Multi View']);
    const watcher = harness(vod({ startOn: null, lastWatched: 'live:3' }));
    assert.equal(watcher.settings.startOn, 'live'); assert.match(watcher.node('tab-0').className, /active/);
    assert.equal(watcher.selectedRow, 'BBC News', 'the guide opens as before');
    const h = harness(vod());
    h.key('back'); assert.equal(h.focused, 'tab-6');
    h.key('back'); assert.ok(h.dialogOpen, 'Back on the start section asks to close Tuner');
    h.key('back'); h.key('right'); h.key('down'); h.key('back', 2); assert.equal(h.focused, 'tab-0');
    h.key('back'); assert.equal(h.focused, 'tab-6', 'Back from another section\'s tab returns to Home');
});

test('Home: poster rows of docs/browse.md; arrows move along a row and to the same screen column of the next; only near rows are drawn', () => {
    const h = harness(vod());
    assert.deepEqual(shelfTitles(h), ['Popular – Movies', 'Netflix – Movies'], 'the focused row and the one below are drawn');
    assert.equal(h.focused, 'home-0-0');
    assert.equal(h.text('shelf-eyebrow'), 'Popular – Movies'); assert.equal(h.text('shelf-name'), 'Film 01');
    assert.match(h.text('shelf-meta'), /Movie {2}· {2}2020/); assert.equal(h.text('shelf-plot'), 'The plot of film 1.');
    h.key('right', 3); assert.equal(h.focused, 'home-0-3'); assert.equal(h.text('shelf-name'), 'Film 04');
    h.key('down'); assert.equal(h.focused, 'home-1-3', 'the poster below in the same column');
    assert.deepEqual(shelfTitles(h), ['Netflix – Movies', 'Recently added – Movies'], 'the focused row heads the window');
    assert.equal(h.document.getElementById('home-0-0'), null, 'rows above are not in the DOM');
    h.key('down', 3); assert.equal(h.focused, 'home-4-3');
    h.key('down', 3); assert.equal(h.focused, 'home-5-3', 'Down on the last row stays');
    assert.equal(h.text('shelf-eyebrow'), 'Top rated – Series');
    h.key('up', 5); assert.equal(h.focused, 'home-0-3');
    h.key('left', 5); assert.equal(h.focused, 'home-0-0', 'no wrapping');
    h.key('up'); assert.equal(h.focused, 'tab-6');
    h.key('down'); assert.equal(h.focused, 'home-0-0', 'entering again restores the tile');
    h.key('chDown'); assert.equal(h.focused, 'home-2-0', 'CH- pages two rows down');
    h.key('chUp'); assert.equal(h.focused, 'home-0-0');
});

test('Home rows scroll sideways keeping the column, and posters load only near view', () => {
    const h = harness(vod());
    h.key('down', 2); assert.equal(h.text('shelf-eyebrow'), 'Recently added – Movies');
    const src = id => h.node(id).querySelector('img').src;
    assert.ok(src('home-2-9'), 'posters in and just beyond view are loaded');
    assert.equal(src('home-2-12'), undefined, 'posters further along wait');
    h.key('right', 9); assert.equal(h.focused, 'home-2-9');
    assert.equal(h.node('home-2-0').parentNode.style.transform, 'translateX(-630px)', 'the row scrolled three posters');
    assert.ok(src('home-2-12'));
    h.key('up'); assert.equal(h.focused, 'home-1-6', 'the same screen column (the Netflix row\'s See all)');
    h.key('down'); assert.equal(h.focused, 'home-2-9', 'the row kept its place');
});

test('See all opens Discover on the row\'s type and list; Back returns to the same tile', () => {
    const h = harness(vod());
    h.key('right', 8); assert.equal(h.focused, 'home-0-8'); assert.equal(h.text('shelf-name'), 'See all');
    h.key('ok');
    assert.match(h.node('tab-1').className, /active/);
    assert.equal(h.text('discover-type'), 'Type: Movies'); assert.equal(h.text('discover-list'), 'List: Popular'); assert.equal(h.text('discover-genre'), 'Genre: All');
    assert.equal(h.focused, 'card-0');
    assert.deepEqual(gridNames(h), ['Film 01', 'Film 02', 'Film 03', 'Film 04', 'Film 05', 'Film 06', 'Film 07', 'Film 08'], 'the French film is not shown (USA only)');
    assert.equal(h.text('brand-hint'), 'Back Home');
    h.key('down'); h.key('up'); assert.equal(h.focused, 'discover-list');
    h.key('back');
    assert.match(h.node('tab-6').className, /active/); assert.equal(h.focused, 'home-0-8');
    h.key('down'); h.key('right', 20); assert.equal(h.focused, 'home-1-6');
    h.key('ok'); assert.equal(h.text('discover-list'), 'List: Netflix');
    assert.equal(gridNames(h)[0], 'Netflix film 06');
});

test('Discover: Up from the grid reaches the filters; OK opens a chooser on the current choice; the choice returns to its filter', () => {
    const h = harness(vod());
    h.node('tab-1').click();
    assert.equal(h.focused, 'card-0'); assert.equal(h.text('discover-list'), 'List: Popular');
    assert.equal(h.text('discover-count'), '1 / 8 titles');
    h.key('up'); assert.equal(h.focused, 'discover-list'); assert.equal(h.text('brand-hint'), 'Back Tabs');
    h.key('ok'); assert.ok(h.dialogOpen);
    assert.equal(h.focused, 'dialog-0'); assert.equal(h.text('dialog-0'), '✓ Popular');
    assert.deepEqual(h.node('dialog-layer').querySelectorAll('button').map(n => n.textContent).slice(0, 6), ['✓ Popular', 'Featured', 'Top rated', 'Recently added', 'A–Z', 'Netflix']);
    h.key('down', 4); h.key('ok');
    assert.equal(h.dialogOpen, false); assert.equal(h.focused, 'discover-list'); assert.equal(h.text('discover-list'), 'List: A–Z');
    assert.equal(gridNames(h)[0], 'Film 01'); assert.equal(h.text('discover-count'), '1 / 18 titles');
    h.key('right'); h.key('ok');
    assert.deepEqual(h.node('dialog-layer').querySelectorAll('button').map(n => n.textContent), ['✓ All', 'Action', 'Close'], 'Drama is only on a title USA only hides');
    h.key('down'); h.key('ok');
    assert.equal(h.text('discover-genre'), 'Genre: Action'); assert.equal(gridNames(h).length, 8, 'only titles TMDB files under Action');
    h.key('left', 2); h.key('ok'); h.key('down'); h.key('ok');
    assert.equal(h.text('discover-type'), 'Type: Series'); assert.equal(h.text('discover-genre'), 'Genre: All', 'a new type starts on all genres');
    assert.deepEqual(gridNames(h), ['Show 1', 'Show 2', 'Show 3', 'Show 4', 'Show 5', 'Show 6']);
    h.key('down'); assert.equal(h.focused, 'card-0');
    h.key('back'); assert.equal(h.focused, 'discover-type', 'Back from the grid: its filters');
    h.key('back'); assert.equal(h.focused, 'tab-1');
});

test('Discover grid: moves by poster without wrapping, pages with CH, computes more titles as it scrolls, keeps three rows in the DOM', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: 'm:' + i, name: 'Title ' + String(i).padStart(3, '0'), categoryIds: ['en'], added: 5000 - i, url: 'https://fixture.invalid/' + i + '.mp4', backups: [] }));
    const h = harness(vod({ movies: many, rows: null }));
    h.node('tab-1').click();
    assert.equal(h.text('discover-list'), 'List: Recently added', 'without TMDB data Discover opens on Recently added');
    assert.equal(h.text('discover-count'), '1 / 96+ titles');
    h.key('left'); assert.equal(h.focused, 'card-0');
    h.key('right', 9); assert.equal(h.focused, 'card-7', 'no wrapping to the next row');
    h.key('down'); assert.equal(h.focused, 'card-15');
    h.key('down'); assert.equal(h.focused, 'card-23');
    assert.equal(h.document.getElementById('card-0'), null, 'the first row left the DOM');
    assert.equal(h.node('main').querySelectorAll('.poster').length, 24);
    for (let i = 0; i < 12; i++) h.key('chDown');
    assert.equal(h.focused, 'card-215'); assert.match(h.text('discover-count'), /^216 \/ (288\+|300) titles$/);
    for (let i = 0; i < 20; i++) h.key('chDown');
    assert.equal(h.focused, 'card-299', 'CH- stops on the last poster'); assert.equal(h.text('discover-count'), '300 / 300 titles');
    h.key('down'); assert.equal(h.focused, 'card-299');
    h.key('chUp'); assert.equal(h.focused, 'card-283');
});

test('details round trip: OK on a poster opens its details; Back returns to the same poster on Home, Discover and Library', () => {
    const h = harness(vod({ favourites: ['m:en2'] }));
    h.key('down', 2); h.key('right', 2); assert.equal(h.focused, 'home-2-2');
    h.key('ok');
    assert.equal(h.focused, 'detail-play'); assert.equal(h.text('detail-back'), '← Back to Home'); assert.equal(h.text('brand-hint'), 'Back Home');
    h.key('back'); assert.equal(h.focused, 'home-2-2'); assert.equal(h.text('shelf-eyebrow'), 'Recently added – Movies');
    h.node('tab-1').click(); h.key('right', 5); h.key('ok');
    assert.equal(h.text('detail-back'), '← Back to Discover');
    h.key('back'); assert.equal(h.focused, 'card-5');
    h.node('tab-2').click(); assert.equal(h.focused, 'lib-0-0');
    h.key('ok'); assert.equal(h.text('detail-back'), '← Back to Library'); assert.equal(h.text('detail-fav'), '✓ In Library');
    h.key('back'); assert.equal(h.focused, 'lib-0-0');
});

test('Library: Continue watching, favorites with check badges, Recently watched; + Add to Library and Hold OK save titles', () => {
    const recents = [{ id: 'm:en5', name: 'Film 05', position: 1500000, duration: 6000000, updated: 50 }];
    const h = harness(vod({ favourites: ['m:en2', 's:3'], recents }));
    h.node('tab-2').click();
    assert.deepEqual(shelfTitles(h), ['Continue watching', 'Favorite movies']);
    assert.equal(h.focused, 'lib-0-0'); assert.equal(h.text('shelf-name'), 'Film 05'); assert.match(h.text('shelf-meta'), /In progress/);
    assert.equal(h.node('lib-0-0').querySelector('.poster-progress').children[0].style.width, '25%');
    assert.ok(h.node('lib-1-0').querySelector('.poster-check'), 'favorites carry the check badge');
    h.key('down'); assert.equal(h.text('lib-2-0'), 'Show 3✓Show 3'); h.key('up');
    // Playing a title adds it to Recently watched.
    h.key('ok'); h.node('detail-play').click(); h.key('back'); h.key('back');
    assert.equal(h.focused, 'lib-0-0'); assert.deepEqual(shelfTitles(h), ['Continue watching', 'Favorite movies']);
    h.key('down', 3); assert.equal(h.text('shelf-eyebrow'), 'Recently watched'); assert.equal(h.text('shelf-name'), 'Film 05');
    // + Add to Library on the details, and Hold OK on a poster.
    h.node('tab-1').click(); h.key('ok');
    assert.equal(h.text('detail-fav'), '+ Add to Library');
    h.node('detail-fav').focus(); h.key('ok');
    assert.equal(h.text('detail-fav'), '✓ In Library'); assert.equal(h.focused, 'detail-fav'); assert.match(h.text('toast'), /Film 01 added to your Library/);
    h.key('back'); assert.ok(h.node('card-0').querySelector('.poster-check'));
    h.key('right'); h.holdOk();
    assert.match(h.text('toast'), /Film 02 removed from your Library/); assert.equal(h.focused, 'card-1');
    assert.equal(h.node('card-1').querySelector('.poster-check'), null);
    assert.equal(h.dialogOpen, false); assert.equal(h.text('brand-hint'), 'Back Filters', 'a held OK does not open the details');
    assert.deepEqual([...h.favourites].sort(), ['m:en1', 's:3']);
});

test('Continue watching on Home (5 titles or more): a series opens on the episode in progress or the next one; See all opens the Library', () => {
    const episodes = season => [1, 2, 3].map(e => ({ id: 'e:' + season + e, episode: e, name: 'Episode ' + e, url: 'https://fixture.invalid/e.mp4' }));
    const info = { seasons: [1, 2].map(number => ({ number, episodes: episodes(number) })) };
    const recents = [{ id: 'e:12', seriesId: 's:1', season: 1, episode: 2, position: 600000, duration: 2400000, updated: 90 },
        ...[1, 2, 3].map(i => ({ id: 'm:en' + i, position: 600000, duration: 6000000, updated: 80 - i }))];
    const h = harness(vod({ recents, upNext: [{ seriesId: 's:2', season: 1, episode: 3, updated: 85 }], seriesInfo: () => info }));
    assert.deepEqual(shelfTitles(h), ['Continue watching', 'Popular – Movies']);
    assert.equal(h.text('shelf-name'), 'Show 1');
    h.key('ok'); assert.equal(h.focused, 'episode-1', 'Show 1 resumes episode 2');
    h.key('back'); h.key('right'); assert.equal(h.text('shelf-name'), 'Show 2'); assert.match(h.text('shelf-meta'), /Next episode ready/);
    h.key('ok'); assert.match(h.node('season-1').className, /active/); assert.equal(h.focused, 'episode-0', 'after S1 E3 comes S2 E1');
    h.key('back'); h.key('right', 4); assert.equal(h.focused, 'home-0-5'); h.key('ok');
    assert.match(h.node('tab-2').className, /active/); assert.equal(h.text('shelf-eyebrow'), 'Continue watching'); assert.equal(h.focused, 'lib-0-0');
    h.key('back'); assert.match(h.node('tab-6').className, /active/); assert.equal(h.focused, 'home-0-5');
});

test('Settings: Movies & Series USA only / All changes Home and Discover; Open on picks the start section', () => {
    const h = harness(vod());
    h.node('tab-4').click();
    assert.equal(h.text('vod-region-setting'), 'Movies & Series: USA only'); assert.equal(h.text('lineup-setting'), 'Channels: All', 'separate from the channels switch');
    h.node('vod-region-setting').focus(); h.key('ok');
    assert.equal(h.text('vod-region-setting'), 'Movies & Series: All'); assert.equal(h.settings.vodUsOnly, false); assert.equal(h.focused, 'vod-region-setting');
    assert.equal(h.settings.usOnly, undefined);
    h.node('tab-1').click(); h.key('up'); h.key('ok'); h.key('down', 4); h.key('ok');
    assert.ok(gridNames(h).includes('Film francais 01'), 'All shows the French films');
    h.node('tab-4').click(); h.node('vod-region-setting').click();
    h.node('tab-1').click(); assert.ok(!gridNames(h).includes('Film francais 01'));
    h.node('tab-4').click(); assert.equal(h.text('start-setting'), 'Open on: Home');
    h.node('start-setting').focus(); h.key('ok');
    assert.equal(h.text('start-setting'), 'Open on: Live TV'); assert.equal(h.settings.startOn, 'live');
    h.key('back'); h.key('back'); assert.equal(h.focused, 'tab-0', 'Back now returns to Live TV');
});

test('About shows the TMDB notice only while TMDB data is in use', () => {
    const h = harness(vod());
    h.node('tab-4').click(); h.node('about-tuner').click();
    assert.match(h.text('dialog-layer'), /This product uses the TMDB API but is not endorsed or certified by TMDB\./);
    const none = harness(vod({ rows: { v: 1, source: 'none', movie: {}, tv: {}, genres: {} } }));
    assert.deepEqual(shelfTitles(none).slice(0, 2), ['Netflix – Movies', 'Recently added – Movies'], 'without TMDB: no Popular row');
    none.node('tab-4').click(); none.node('about-tuner').click();
    assert.doesNotMatch(none.text('dialog-layer'), /TMDB/);
});

test('a large catalogue is prepared in slices: the arrows keep working and the rows appear when it is ready', () => {
    const many = Array.from({ length: 7000 }, (_, i) => ({ id: 'm:' + i, name: 'Title ' + i, categoryIds: ['en'], added: 9000 - i, rating: '7', url: 'https://fixture.invalid/' + i + '.mp4', backups: [] }));
    const h = harness(vod({ movies: many }));
    assert.match(h.text('main'), /Preparing your movies and series/);
    h.key('up'); assert.equal(h.focused, 'tab-6', 'keys work while preparing');
    for (let i = 0; i < 20 && /Preparing/.test(h.text('main')); i++) h.advance(1);
    assert.deepEqual(shelfTitles(h), ['Recently added – Movies', 'Recently added – Series']);
    assert.equal(h.focused, 'tab-6', 'focus stays on the tabs');
    h.key('down'); assert.equal(h.text('shelf-name'), 'Title 0');
});

test('locking adult content again hides adult titles at once, also on a catalogue indexed in slices', () => {
    const base = vod();
    const adult = { id: 'm:x', name: 'Late Film', categoryIds: ['xxx'], added: 99999, url: 'https://fixture.invalid/x.mp4', backups: [] };
    const h = harness({ ...base, movies: manyMovies(7000).concat([adult]), movieCats: base.movieCats.concat([{ id: 'xxx', name: 'XXX' }]), rows: null });
    assert.ok(h.until(() => shelfTitles(h).length));
    h.node('tab-4').click(); h.node('adult-setting').click();
    for (const pin of ['2', '4', '6', '8', '2', '4', '6', '8']) h.node('pin-' + pin).click();
    assert.match(h.text('adult-setting'), /Unlocked/);
    h.node('tab-6').click(); assert.ok(h.until(() => h.text('main').includes('Late Film')), 'unlocked: the adult film is in Recently added');
    assert.equal(h.text('home-0-0'), 'Late FilmLate Film');
    h.node('tab-4').click(); h.node('adult-setting').click(); assert.match(h.text('adult-setting'), /Locked/);
    h.node('tab-6').click();
    assert.ok(!h.text('main').includes('Late Film'), 'locked: gone at once, not after the new index is ready');
    assert.ok(h.until(() => shelfTitles(h).length)); assert.ok(!h.text('main').includes('Late Film'));
});

test('adult titles stay out of Home and Discover until the passcode unlocks them', () => {
    const base = vod();
    const h = harness({ ...base, movies: base.movies.concat([{ id: 'm:x', name: 'Late Film', categoryIds: ['xxx'], added: 99999, url: 'https://fixture.invalid/x.mp4', backups: [] }]),
        movieCats: base.movieCats.concat([{ id: 'xxx', name: 'XXX' }]) });
    h.node('tab-1').click(); h.key('up'); h.key('ok'); h.key('down', 3); h.key('ok');
    assert.equal(h.text('discover-list'), 'List: Recently added'); assert.notEqual(gridNames(h)[0], 'Late Film');
    assert.ok(!h.text('main').includes('Late Film'));
});

// Regression tests for the review of the Movies & Series screens.
function manyMovies(n, extra = {}) {
    return Array.from({ length: n }, (_, i) => ({ id: 'm:' + i, name: 'Title ' + i, categoryIds: ['en'], added: 9000 - i, rating: '7', url: 'https://fixture.invalid/' + i + '.mp4', backups: [], ...extra }));
}
function statusTitles(h) { return h.node('main').querySelectorAll('h2').filter(n => /browse-status/.test(n.parentNode.className)).map(n => n.textContent); }
function searchFor(h, query) { h.node('tab-3').click(); const input = h.node('search-input'); input.value = query; input.oninput(); h.advance(200); return h.node('search-results').querySelectorAll('.search-result').map(n => n.textContent); }

test('holding OK on the last Library title removes it and the release opens nothing', () => {
    const h = harness(vod({ favourites: ['m:en2'] }));
    h.node('tab-2').click(); assert.equal(h.focused, 'lib-0-0'); assert.equal(h.text('shelf-name'), 'Film 02');
    h.holdOk();
    assert.match(h.text('toast'), /Film 02 removed from your Library/);
    assert.match(h.node('tab-2').className, /active/, 'still in the Library');
    assert.equal(h.focused, 'empty-action'); assert.deepEqual(statusTitles(h), ['Your Library is empty']);
    assert.equal(h.document.getElementById('discover-list'), null, 'the release did not press Browse Discover');
    h.key('back'); assert.equal(h.focused, 'tab-2', 'Back goes up one level from the Library');
});

test('while titles load or are prepared, focus waits on the section\'s tab and moves to the rows once they arrive', () => {
    const h = harness(vod({ deferLoad: true }));
    assert.deepEqual(statusTitles(h), ['Loading your movies and series']);
    assert.equal(h.focused, 'tab-6', 'focus is visible on the Home tab, not on nothing');
    h.key('ok'); assert.equal(h.focused, 'tab-6');
    h.key('down'); assert.equal(h.focused, 'tab-6', 'Down tries the rows and waits on the tab again');
    h.finishLoad();
    assert.equal(h.focused, 'home-0-0', 'the rows arrive: focus enters them');
    const moved = harness(vod({ deferLoad: true }));
    moved.key('right'); assert.equal(moved.focused, 'tab-0');
    moved.finishLoad(); assert.equal(moved.focused, 'tab-0', 'a key pressed while waiting keeps focus where it went');
    const big = harness(vod({ movies: manyMovies(7000) }));
    assert.deepEqual(statusTitles(big), ['Preparing your movies and series']); assert.equal(big.focused, 'tab-6');
    assert.ok(big.until(() => big.focused === 'home-0-0'), 'prepared: focus enters the rows'); assert.equal(big.text('shelf-name'), 'Title 0');
    const slow = harness(vod({ movies: manyMovies(7000), deferLoad: true }));
    assert.deepEqual(statusTitles(slow), ['Loading your movies and series']); assert.equal(slow.focused, 'tab-6');
    slow.key('down'); assert.equal(slow.focused, 'tab-6');
    slow.finishLoad();
    assert.deepEqual(statusTitles(slow), ['Preparing your movies and series'], 'loaded: prepared, not shown as empty'); assert.equal(slow.focused, 'tab-6');
    assert.ok(slow.until(() => slow.focused === 'home-0-0'));
    const library = harness(vod({ deferLoad: true, startOn: 'live' }));
    library.node('tab-2').click(); assert.equal(library.focused, 'tab-2');
    library.finishLoad(); assert.equal(library.focused, 'empty-action', 'nothing to show: focus moves to the status action');
});

test('Search applies Movies & Series: USA only, from the index or the category check; live channels are unchanged', () => {
    const base = vod();
    const amelie = { id: 'm:am', name: 'Amelie (2001)', categoryIds: ['en'], year: '2001', url: 'https://fixture.invalid/am.mp4', backups: [] };
    const rows = { ...base.rows, movie: { popular: base.rows.movie.popular.concat([{ id: 400, title: 'Amelie', year: '2001', origin: ['FR'] }]) } };
    const h = harness({ ...base, movies: base.movies.concat([amelie]), rows, startOn: 'live' });
    assert.deepEqual(searchFor(h, 'francais'), [], 'films filed under FR | Films are hidden');
    assert.deepEqual(searchFor(h, 'amelie'), [], 'a matched title whose TMDB origin is not US is hidden');
    assert.deepEqual(searchFor(h, 'film 0'), ['Film 01Movie', 'Film 02Movie', 'Film 03Movie', 'Film 04Movie', 'Film 05Movie', 'Film 06Movie', 'Film 07Movie', 'Film 08Movie', 'Film 09Movie',
        'Netflix film 01Movie', 'Netflix film 02Movie', 'Netflix film 03Movie', 'Netflix film 04Movie', 'Netflix film 05Movie', 'Netflix film 06Movie']);
    assert.deepEqual(searchFor(h, 'news'), ['BBC NewsLive TV', 'Fox NewsLive TV', 'Sky NewsLive TV'], 'channels as before');
    h.node('tab-4').click(); h.node('vod-region-setting').click(); assert.equal(h.settings.vodUsOnly, false);
    assert.deepEqual(searchFor(h, 'francais'), ['Film francais 01Movie', 'Film francais 02Movie', 'Film francais 03Movie'], 'All shows every title');
    assert.deepEqual(searchFor(h, 'amelie'), ['Amelie (2001)Movie']);
});

test('Home with no title that passes USA only points to the Movies & Series switch', () => {
    const base = vod();
    const h = harness({ ...base, movies: base.movies.map(m => ({ ...m, categoryIds: ['fr'] })), seriesList: base.seriesList.map(s => ({ ...s, categoryIds: ['de'] })), seriesCats: [{ id: 'de', name: 'DE | Serien' }] });
    assert.deepEqual(statusTitles(h), ['Browse your movies and series']);
    assert.match(h.text('main'), /USA only\. Open Discover, or show all titles with Settings › Movies & Series\./);
    assert.equal(h.focused, 'empty-action');
    h.node('tab-4').click(); h.node('vod-region-setting').click(); h.node('tab-6').click();
    assert.ok(shelfTitles(h).length, 'All: the rows appear');
});

test('a playlist with only live channels: Home offers Live TV instead of another download', () => {
    const h = harness({ startOn: 'home', movies: [], seriesList: [] });
    assert.match(h.text('main'), /The playlist has no movies or series\./);
    assert.equal(h.focused, 'empty-action'); assert.equal(h.text('empty-action'), 'Open Live TV');
    h.key('ok'); assert.match(h.node('tab-0').className, /active/); assert.equal(h.selectedRow, 'CNN');
    assert.equal(h.loads, 1, 'nothing was downloaded again');
});

test('timestamps in milliseconds sort Recently added like seconds and never break Home', () => {
    const base = vod();
    const h = harness({ ...base, movies: base.movies.map(m => ({ ...m, added: m.added * 1000 + 1700000000000 })) });
    assert.equal(h.focused, 'home-0-0');
    h.key('down', 2); assert.equal(h.text('shelf-eyebrow'), 'Recently added – Movies');
    assert.equal(h.text('shelf-name'), 'Netflix film 06', 'newest first');
    h.node('tab-1').click(); h.key('up'); h.key('ok'); h.key('down', 3); h.key('ok');
    assert.equal(h.text('discover-list'), 'List: Recently added'); assert.equal(gridNames(h)[0], 'Netflix film 06');
});

test('a large catalogue delivered again (saved copy, then the network) keeps Home and its focus while it is indexed again', () => {
    const h = harness(vod({ movies: manyMovies(7000) }));
    assert.ok(h.until(() => shelfTitles(h).length));
    h.key('down'); h.key('right', 3); assert.equal(h.focused, 'home-1-3');
    h.finishLoad();
    assert.equal(h.focused, 'home-1-3', 'focus stays on the poster');
    assert.ok(shelfTitles(h).length, 'the rows stay on screen'); assert.deepEqual(statusTitles(h), []);
    h.key('right'); assert.equal(h.focused, 'home-1-4', 'keys work while the new index is built');
    h.advance(50);
    assert.equal(h.focused, 'home-1-4'); assert.deepEqual(statusTitles(h), []);
    h.node('tab-1').click(); h.finishLoad();
    assert.equal(h.focused, 'card-0'); assert.equal(h.document.getElementById('discover-grid') !== null, true, 'Discover keeps its grid too');
});

test('a series whose last episode was finished leaves Continue watching once its details show there is no next one', () => {
    const episodes = season => [1, 2, 3].map(e => ({ id: 'e:' + season + e, episode: e, name: 'Episode ' + e, url: 'https://fixture.invalid/e.mp4' }));
    const info = { seasons: [1, 2].map(number => ({ number, episodes: episodes(number) })) };
    const upNext = [{ seriesId: 's:2', season: 2, episode: 3, updated: 85 }];
    const h = harness(vod({ upNext, seriesInfo: () => info }));
    h.node('tab-2').click(); assert.deepEqual(shelfTitles(h), ['Continue watching']); assert.equal(h.text('shelf-name'), 'Show 2');
    h.key('ok'); assert.equal(h.focused, 'episode-0');
    assert.deepEqual(upNext, [], 'the marker is cleared');
    h.key('back'); assert.deepEqual(statusTitles(h), ['Your Library is empty']);
});

test('a catalogue indexed in slices is never drawn into a page that is still being built', () => {
    for (const tab of ['tab-6', 'tab-1']) {
        const h = harness(vod({ movies: manyMovies(3001), startOn: 'live' }));
        h.node(tab).click();
        assert.deepEqual(h.duplicateIds(), []);
        assert.ok(h.until(() => !statusTitles(h).length && (tab === 'tab-1' || shelfTitles(h).length)));
        assert.deepEqual(h.duplicateIds(), []);
        assert.equal(h.node('main').querySelectorAll('.browse-status').length, 0);
    }
});

test('rows that arrive from lumanest.tv are matched in the app: Popular appears, also on a large catalogue', () => {
    const base = vod();
    const h = harness({ ...base, rows: null, rowsLater: true });
    assert.ok(!shelfTitles(h).includes('Popular – Movies'));
    h.deliverRows(base.rows);
    assert.equal(shelfTitles(h)[0], 'Popular – Movies'); assert.equal(h.focused, 'home-0-0');
    h.node('tab-4').click(); h.node('about-tuner').click(); assert.match(h.text('dialog-layer'), /TMDB API/);
    const titles = manyMovies(7000), rows = { v: 1, source: 'tmdb', movie: { popular: Array.from({ length: 8 }, (_, i) => ({ id: 500 + i, title: 'Title ' + (i * 10), origin: ['US'] })) }, tv: {}, genres: {} };
    const big = harness(vod({ movies: titles, rows: null, rowsLater: true }));
    assert.ok(big.until(() => big.focused === 'home-0-0')); assert.equal(big.text('shelf-eyebrow'), 'Recently added – Movies');
    big.deliverRows(rows);
    assert.equal(big.text('shelf-eyebrow'), 'Recently added – Movies', 'the old matches stay while the new rows are matched');
    assert.ok(big.until(() => shelfTitles(big)[0] === 'Popular – Movies'));
    assert.equal(big.focused, 'home-0-0'); assert.equal(big.text('shelf-name'), 'Title 0');
});
