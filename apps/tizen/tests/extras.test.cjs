'use strict';
// docs/extras.md in js/data.js: the shared cases (live_category and vtt_cues of docs/extras-cases.json), the hidden
// live category in the catalogue the app receives (new and saved), and TunerData.extras: the lookup queries, the
// checks on lumanest.tv's answers and the client with its session cache. No network: a recording XMLHttpRequest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/extras-cases.json'), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const provider = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
const FILE = 'https://lumanest.tv/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw';
const QR = Array.from({ length: 21 }, (_, r) => Array.from({ length: 21 }, (_, c) => String((r * c + r) % 2)).join(''));

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}
function load(options = {}) {
    const requests = [];
    class Xhr {
        constructor() { if (options.xhrThrows) throw new Error('No network'); }
        open(method, url) { this.method = method; this.url = url; }
        send() { requests.push(this); }
        abort() { if (this.onabort) this.onabort(); }
    }
    const window = { Promise, XMLHttpRequest: Xhr, localStorage: options.storage || memoryStorage(), setTimeout, clearTimeout };
    vm.runInNewContext(sourceText, { window, console });
    function respond(request, status, body) {
        assert.ok(request && !request.done, 'an outstanding request');
        request.done = true; request.status = status; request.readyState = 4;
        request.responseText = typeof body === 'string' ? body : JSON.stringify(body);
        request.onreadystatechange();
    }
    return { data: window.TunerData, requests, respond, Xhr };
}

test('docs/extras-cases.json: every live_category and vtt_cues case passes in js/data.js', () => {
    const { data } = load();
    const ran = { live_category: 0, vtt_cues: 0 };
    for (const c of cases) {
        if (c.kind === 'live_category') {
            assert.equal(data.isHiddenLiveCategory(c.name), c.hidden, JSON.stringify(c.name));
            assert.equal(data.extras.isHiddenLiveCategory(c.name), c.hidden);
            ran.live_category++;
        } else if (c.kind === 'vtt_cues') {
            const cues = data.parseVtt(c.vtt);
            assert.deepEqual(plain(cues), c.cues, c.note);
            for (const [ms, text] of c.at) assert.equal(data.vttTextAt(cues, ms), text, c.note + ' at ' + ms);
            ran.vtt_cues++;
        }
    }
    assert.ok(ran.live_category >= 30 && ran.vtt_cues >= 6, JSON.stringify(ran));
    // Not a string: never hidden, never a cue.
    for (const value of [null, undefined, 42, ['Most watched now']]) assert.equal(data.isHiddenLiveCategory(value), false);
    assert.deepEqual(plain(data.parseVtt(null)), []);
    assert.equal(data.vttTextAt(null, 1000), '');
});

test('WebVTT: equal starts keep file order, a timing line may follow a cue id, cue text never keeps a tag', () => {
    const { data } = load();
    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nsecond\n\n00:00:01.000 --> 00:00:03.000\nfirst\n\n' +
        'id\n00:00:02.000 --> 00:00:04.000 align:start\n<script>alert(1)</script>third\n\n' +
        'a\nb\n00:00:05.000 --> 00:00:06.000\nthe timing line must be first or second\n\n' +
        '00:00:07.000 --> 00:00:08.000\n \t spaces &nbsp;\t\n\t\n  and tabs go at both ends  \n\n' +
        '00:00:05.000 --> 00:00:06.000 \u2028\nsettings with a line separator';
    const cues = data.parseVtt(vtt);
    assert.deepEqual(plain(cues.map(cue => cue.text)), ['first', 'second', 'alert(1)third', 'settings with a line separator', 'spaces\nand tabs go at both ends']);
    assert.equal(data.vttTextAt(cues, 2500), 'first\nsecond\nalert(1)third');
    assert.equal(data.vttTextAt(cues, -1), '');
    // Only a file that starts with WEBVTT (alone, or then a space or tab) has cues.
    for (const header of ['WEBVTTX', 'NOT WEBVTT', ' WEBVTT', 'webvtt', '']) assert.deepEqual(plain(data.parseVtt(header + '\n\n00:00:01.000 --> 00:00:02.000\nx\n')), [], header);
    assert.equal(data.parseVtt('WEBVTT\tKind: captions\n\n00:00:01.000 --> 00:00:02.000\nx\n').length, 1);
});

test('hidden live categories: removed from the list and from each channel; channels only in them are dropped', () => {
    const { data } = load();
    const cats = [{ id: 'hot', name: '|USA| MOST WATCHED NOW' }, { id: 'news', name: 'News' }, { id: 'hot2', name: 'Most Watched' }];
    const items = [
        { id: 'a', name: 'CNN', categoryId: 'hot', categoryIds: ['hot', 'news'] },
        { id: 'b', name: 'CNN copy', categoryId: 'hot', categoryIds: ['hot', 'hot2'] },
        { id: 'c', name: 'No category', categoryId: '', categoryIds: [] },
        { id: 'd', name: 'BBC', categoryId: 'news', categoryIds: ['news'] }
    ];
    const result = data.hideLiveCategories(items, cats);
    assert.deepEqual(plain(result.categories), [{ id: 'news', name: 'News' }]);
    assert.deepEqual(plain(result.items.map(item => [item.id, item.categoryId, item.categoryIds])), [['a', 'news', ['news']], ['c', '', []], ['d', 'news', ['news']]]);
    assert.deepEqual(plain(items[0].categoryIds), ['hot', 'news'], 'the provider rows are not changed');
    assert.equal(result.items[2], items[3], 'unchanged channels stay the same objects');
    const none = data.hideLiveCategories(items, [{ id: 'news', name: 'News' }]);
    assert.equal(none.items, items); assert.equal(none.categories.length, 1);
});

test('the catalogue the app receives has no hidden live category, from the provider or from a saved catalogue', async () => {
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    for (const usOnly of [false, true]) {
        const h = load(), published = [];
        const client = h.data.createClient(provider, { zip: '', usOnly, cache: false, onCatalog(kind, items, categories) { published.push({ kind, items, categories }); } });
        const loading = client.load();
        await flush();
        const find = action => h.requests.find(r => !r.done && r.url.includes('action=' + action));
        h.respond(find('get_live_categories'), 200, [{ category_id: '1', category_name: 'USA | Most Watched Now' }, { category_id: '2', category_name: 'USA | News' }]);
        h.respond(find('get_live_streams'), 200, [
            { stream_id: 1, name: 'USA | CNN', category_id: '2' },
            { stream_id: 2, name: 'USA | Fox Sports', category_id: '1' },
            { stream_id: 3, name: 'USA | MSNBC', category_id: '1', category_ids: ['1', '2'] },
            // A copy of CNN listed only in the hidden category: dropped before copies are folded, so it never becomes
            // CNN's stream or backup (the folding prefers copies in a "most watched" category).
            { stream_id: 4, name: 'USA | CNN', category_id: '1' }
        ]);
        for (const action of ['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series']) h.respond(find(action), 200, []);
        await loading;
        const live = published.find(entry => entry.kind === 'live');
        assert.deepEqual(plain(live.categories.map(cat => cat.name)), ['USA | News'], 'usOnly ' + usOnly);
        assert.deepEqual(plain(live.items.map(item => [item.id, item.categoryIds])), [['x:1', ['2']], ['x:3', ['2']]], 'usOnly ' + usOnly);
        assert.deepEqual(plain(live.items.map(item => [item.url, item.backups])), [['http://example.invalid/live/u/p/1.m3u8', []], ['http://example.invalid/live/u/p/3.m3u8', []]]);
    }
    // A live catalogue saved before this rule (localStorage fallback, no IndexedDB): hidden when it is restored.
    const first = load(), key = first.data.sourceKey(provider), identity = first.data.catalogIdentity(provider, { zip: '' });
    const channel = (id, ids) => ({ id, name: id, sourceKey: key, url: 'http://example.invalid/' + id + '.m3u8', backups: [], categoryId: ids[0], categoryIds: ids });
    const record = { id: 'saved', schema: 3, identity, kind: 'live', updated: Date.now(), payload: {
        items: [channel('x:1', ['2']), channel('x:2', ['1']), channel('x:3', ['1', '2'])],
        categories: [{ id: '1', name: 'Most watched now' }, { id: '2', name: 'News' }], merged: { 'x:9': 'x:1' }, xmlUrl: '' } };
    const h = load({ storage: memoryStorage({ 'tuner.tv.catalog.live.v1': JSON.stringify(record) }) }), published = [];
    const client = h.data.createClient(provider, { zip: '', onCatalog(kind, items, categories) { published.push({ kind, items, categories }); } });
    client.load();
    const live = published.find(entry => entry.kind === 'live');
    assert.ok(live, 'the saved catalogue is shown at once');
    assert.deepEqual(plain(live.categories.map(cat => cat.name)), ['News']);
    assert.deepEqual(plain(live.items.map(item => [item.id, item.categoryIds])), [['x:1', ['2']], ['x:3', ['2']]]);
    client.cancel();
});

test('lookup queries: documented parameter order, TMDB id first, else name and year; nothing to ask gives ""', () => {
    const { extras } = load().data;
    assert.equal(extras.subtitlesQuery({ type: 'movie', tmdb: '603', name: 'The Matrix', year: 1999 }), 'v=1&type=movie&tmdb=603');
    assert.equal(extras.subtitlesQuery({ type: 'episode', tmdb: 1399, season: '01', episode: 3 }), 'v=1&type=episode&tmdb=1399&season=1&episode=3');
    assert.equal(extras.subtitlesQuery({ type: 'episode', tmdb: '1399', season: 0, episode: 1 }), 'v=1&type=episode&tmdb=1399&season=0&episode=1', 'season 0: specials');
    assert.equal(extras.subtitlesQuery({ type: 'movie', name: 'EN | The Matrix', year: 1999 }), 'v=1&type=movie&name=EN%20%7C%20The%20Matrix&year=1999');
    assert.equal(extras.subtitlesQuery({ type: 'episode', tmdb: '', name: 'Show & Co', year: '2011', season: 2, episode: 10 }), 'v=1&type=episode&season=2&episode=10&name=Show%20%26%20Co&year=2011');
    assert.equal(extras.trailerQuery({ type: 'tv', tmdb: '1399' }), 'v=1&type=tv&tmdb=1399');
    assert.equal(extras.trailerQuery({ type: 'movie', tmdb: '0603', name: 'Heat', year: 1995 }), 'v=1&type=movie&name=Heat&year=1995', 'a TMDB id with a leading zero is not one');
    for (const ref of [null, { type: 'movie', name: 'No year' }, { type: 'movie', name: 'Old', year: 1700 }, { type: 'movie', tmdb: '1234567890123' },
        { type: 'movie', name: 'x'.repeat(301), year: 2000 }, { type: 'episode', tmdb: '1', season: 1 }, { type: 'episode', tmdb: '1', season: 1, episode: 0 },
        { type: 'episode', tmdb: '1', season: 10000, episode: 1 }, { type: 'tv', tmdb: '1' }, { type: 'series', tmdb: '1' }]) {
        assert.equal(extras.subtitlesQuery(ref), '', JSON.stringify(ref));
    }
    assert.equal(extras.trailerQuery({ type: 'episode', tmdb: '1', season: 1, episode: 1 }), '');
});

test('answers: only tracks on lumanest.tv, at most three, plain labels; trailers need a YouTube key; QR rows are checked', () => {
    const { extras } = load().data;
    const track = (n, extra = {}) => ({ id: n + '-x', lang: 'en', label: 'English (OpenSubtitles ' + n + ')', hi: false, vtt: FILE + n + '.vtt', srt: FILE + n + '.srt', ...extra });
    const answer = extras.parseSubtitles({ v: 1, status: 'ok', tmdb: 603, credit: 'Subtitles provided by OpenSubtitles.com', tracks: [
        track(1, { vtt: 'https://lumanest.tv.example.invalid/x.vtt' }), track(2, { vtt: 'http://lumanest.tv/api/x.vtt' }), track(3, { hi: true }), track(4, { label: '' }), track(5, { hi: 'yes' }), track(6), track(7)] });
    assert.deepEqual(plain(answer.tracks.map(t => [t.label, t.hi, t.vtt])),
        [['English (OpenSubtitles 3)', true, FILE + '3.vtt'], ['English (OpenSubtitles)', false, FILE + '4.vtt'], ['English (OpenSubtitles 5)', false, FILE + '5.vtt']]);
    assert.equal(answer.credit, 'Subtitles provided by OpenSubtitles.com');
    assert.equal(extras.parseSubtitles({ v: 1, status: 'not_configured', tracks: [] }).credit, 'Subtitles provided by OpenSubtitles.com');
    for (const bad of ['{', '[]', '{"v":2,"tracks":[]}', 'null']) assert.equal(extras.parseSubtitles(bad), null, bad);
    const ok = extras.parseTrailer({ v: 1, status: 'ok', tmdb: 603, trailer: { key: 'vKQi3bBA1y8', name: ' Official Trailer ', url: 'https://example.invalid', short: 'example.invalid', qr: QR } });
    assert.deepEqual(plain(ok.trailer), { key: 'vKQi3bBA1y8', name: 'Official Trailer', url: 'https://www.youtube.com/watch?v=vKQi3bBA1y8', short: 'youtu.be/vKQi3bBA1y8', qr: QR });
    for (const key of ['vKQi3bBA1y', 'vKQi3bBA1y8x', 'vKQi3bBA1y<', 42]) assert.equal(extras.parseTrailer({ v: 1, status: 'ok', trailer: { key, qr: QR } }).trailer, null, String(key));
    for (const qr of [QR.slice(1), QR.map(row => row + '0'), QR.map((row, i) => i ? row : row.replace('0', '2')), [], null, 'x'])
        assert.equal(extras.parseTrailer({ v: 1, status: 'ok', trailer: { key: 'vKQi3bBA1y8', qr } }).trailer.qr, null);
    assert.equal(extras.parseTrailer({ v: 1, status: 'none', trailer: null }).trailer, null);
});

test('the client: answers kept for the session, one request per title at a time, failures not kept, files only on request', () => {
    const h = load(), client = h.data.extras.createClient({ XMLHttpRequest: h.Xhr }), got = [];
    const movie = { type: 'movie', tmdb: '603' };
    client.subtitles(movie, answer => got.push(answer));
    client.subtitles(movie, answer => got.push(answer));
    assert.equal(h.requests.length, 1, 'the second ask waits for the first request');
    assert.equal(h.requests[0].url, 'https://lumanest.tv/api/extras/subtitles?v=1&type=movie&tmdb=603');
    assert.equal(h.requests[0].method, 'GET'); assert.equal(h.requests[0].timeout, 10000);
    h.respond(h.requests[0], 200, { v: 1, status: 'ok', tmdb: 603, tracks: [{ id: 'a', label: 'English (OpenSubtitles)', hi: false, vtt: FILE + '.vtt' }] });
    assert.equal(got.length, 2); assert.equal(got[0], got[1]); assert.equal(got[0].tracks.length, 1);
    client.subtitles(movie, answer => got.push(answer));
    assert.equal(h.requests.length, 1, 'kept: no new request'); assert.equal(got[2], got[0]);
    // A failure is not kept: the next start of the title asks again.
    client.trailer({ type: 'movie', tmdb: '603' }, answer => got.push(answer));
    h.respond(h.requests[1], 503, { v: 1, error: { code: 'unavailable', message: 'x' } });
    assert.equal(got[3], null);
    client.trailer({ type: 'movie', tmdb: '603' }, answer => got.push(answer));
    assert.equal(h.requests.length, 3); assert.equal(h.requests[2].url, 'https://lumanest.tv/api/extras/trailer?v=1&type=movie&tmdb=603');
    h.requests[2].ontimeout(); assert.equal(got[4], null);
    // Nothing to ask: answered at once, no request.
    client.subtitles({ type: 'movie', name: 'No year' }, answer => got.push(answer));
    assert.equal(got[5], null); assert.equal(h.requests.length, 3);
    // Files: fetched when asked, 20 s timeout, read as WebVTT, kept in memory; a file elsewhere is never fetched.
    let cues = 'unset';
    client.file('https://example.invalid/x.vtt', value => { cues = value; });
    assert.equal(cues, null); assert.equal(h.requests.length, 3);
    client.file(FILE + '.vtt', value => { cues = value; });
    assert.equal(h.requests[3].url, FILE + '.vtt'); assert.equal(h.requests[3].timeout, 20000);
    h.respond(h.requests[3], 200, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
    assert.deepEqual(plain(cues), [{ start: 1000, end: 2000, text: 'Hello' }]);
    client.file(FILE + '.vtt', value => { cues = value; });
    assert.equal(h.requests.length, 4, 'replay: the file is kept');
    for (const [status, body] of [[404, '{}'], [200, 'not a subtitle file'], [200, 'WEBVTT\n']]) {
        cues = 'unset';
        client.file(FILE + status + body.length + '.vtt', value => { cues = value; });
        h.respond(h.requests.at(-1), status, body);
        assert.equal(cues, null, status + ' ' + body);
    }
});

test('the client: answers kept are capped at 200, oldest first; no XMLHttpRequest or a throwing one answers null', () => {
    const h = load(), client = h.data.extras.createClient({ XMLHttpRequest: h.Xhr });
    const ask = id => { client.trailer({ type: 'movie', tmdb: String(id) }, () => {}); const request = h.requests.at(-1); if (!request.done) h.respond(request, 200, { v: 1, status: 'none', trailer: null }); };
    for (let id = 1; id <= 200; id++) ask(id);
    ask(1);
    assert.equal(h.requests.length, 200, '200 answers are kept');
    ask(201);
    assert.equal(h.requests.length, 201);
    ask(201); ask(2);
    assert.equal(h.requests.length, 201, 'the newest answers are kept');
    ask(1);
    assert.equal(h.requests.length, 202, 'the oldest answer was dropped');
    for (const options of [{}, { XMLHttpRequest: load({ xhrThrows: true }).Xhr }]) {
        let answer = 'unset';
        h.data.extras.createClient(options).subtitles({ type: 'movie', tmdb: '603' }, value => { answer = value; });
        assert.equal(answer, null);
    }
});
