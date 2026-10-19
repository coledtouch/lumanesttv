'use strict';
// Movies & Series browsing logic in js/data.js (docs/browse.md): the shared cases of docs/browse-cases.json (M3U
// playlists among them, through parseM3u), title matching, the USA filter, re-uploads and copies of one title, Home rows,
// Discover lists and genres, fallbacks without TMDB, the catalog rows client and its 12-hour cache, and the
// Continue watching / Recently watched library. The same file runs in the Samsung and LG apps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const HOUR = 3600000;

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}
function load(extra = {}) {
    const window = Object.assign({ Promise, XMLHttpRequest: function () {}, localStorage: memoryStorage() }, extra);
    vm.runInNewContext(sourceText, { window, console });
    return window.TunerData;
}
const data = load(), B = data.browse;

// Catalogue fixtures: movies and series as parseXtream makes them.
let nextId = 1;
function movie(name, extra = {}) { return Object.assign({ id: 'm:' + nextId++, name, categoryIds: ['en'], year: '', rating: '', added: 0, tmdb: '', genre: '', url: 'https://fixture.invalid/m.mp4', backups: [] }, extra); }
function show(name, extra = {}) { return Object.assign({ id: 's:' + nextId++, name, categoryIds: ['en'], year: '', rating: '', added: 0, tmdb: '', genre: '', url: '', backups: [] }, extra); }
const cats = [{ id: 'en', name: 'EN | Movies' }, { id: 'fr', name: 'FR | Films' }, { id: 'nf', name: 'NETFLIX Movies' }, { id: 'action', name: 'EN | Action Movies' }, { id: 'hbo', name: 'HBO Max Originals' }];
function tmdb(id, title, year, origin = ['US'], genres = [], extra = {}) { return Object.assign({ id, title, original_title: title, year: String(year), origin, lang: 'en', genres, popularity: 1 }, extra); }
function payload(movie = {}, tv = {}, genres = { movie: [{ id: 28, name: 'Action' }, { id: 18, name: 'Drama' }, { id: 35, name: 'Comedy' }], tv: [{ id: 10759, name: 'Action & Adventure' }, { id: 18, name: 'Drama' }] }) {
    return B.parseRows({ v: 1, source: 'tmdb', generated: '2026-10-19T00:00:00Z', movie, tv, genres });
}
function names(index, positions) { return plain(positions.map(p => index.titles[p].item.name)); }
function picked(index, key, opts = {}, limit = 50) { return names(index, B.pick(index, key, { usOnly: true, genre: '', ...opts }, 0, limit).picked); }

test('titles normalize as docs/browse.md describes', () => {
    const cases = {
        'The Dark Knight (2008)': 'dark knight',
        'Dune: Part Two [4K]': 'dune part two',
        '|US| Oppenheimer': 'oppenheimer',
        'US - Barbie': 'barbie',
        'EN| Wonka FHD': 'wonka',
        'Fast & Furious HDR': 'fast and furious',
        "Ocean's Eleven": 'oceans eleven',
        'Spider-Man:   Across the Spider-Verse': 'spider man across the spider verse',
        'Amélie': 'amelie',
        'The': 'the',
        'Mission: Impossible - UHD': 'mission impossible',
        '4K-NF - Wednesday': 'wednesday',
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(B.normalizeTitle(input), expected, input);
    assert.equal(B.titleYear({ name: 'Dune (2021)', year: '' }), 2021);
    assert.equal(B.titleYear({ name: 'Dune', year: '2021-10-22' }), 2021, 'the provider year field first');
    assert.equal(B.titleYear({ name: 'Heat - 1995' }), 1995);
    assert.equal(B.titleYear({ name: 'Blade Runner 2049' }), 0, 'a number in the title is not a year');
});

test('matching: a provider TMDB id first, else normalized title and year within one, exact years winning', () => {
    const rows = payload({ popular: [tmdb('1', 'Dune', 2021), tmdb('2', 'Dune', 1984), tmdb('3', 'Heat', 1995), tmdb('4', 'Solo Title', 2010), tmdb('5', 'The Thing', 1982), tmdb('6', 'The Thing', 2011)] });
    const items = [
        movie('Dune (2021)'), movie('US - Dune', { year: '1985' }), movie('Heat', { year: '1996' }), movie('Heat', { year: '1993', id: 'm:far' }),
        movie('Solo Title'), movie('The Thing'), movie('Renamed by provider', { tmdb: '3' }), movie('Dune (2021)', { tmdb: '999', id: 'm:wrong-id' })
    ];
    const index = B.buildIndex('movies', items, cats, rows);
    assert.deepEqual(plain(index.titles.map(t => t.tmdb)), ['1', '2', '3', '', '4', '', '3', ''],
        'year ±1 matches; 2 years off does not; one candidate matches without a year; two do not; the id wins; an unknown id is not matched by title');
    assert.equal(index.matched, 5);
    // Copies of one TMDB title show once.
    assert.deepEqual(picked(index, 'popular'), ['Dune (2021)', 'US - Dune', 'Heat', 'Solo Title']);
});

test('USA only: TMDB origin must include US and the category must pass; an empty origin leaves it to the category', () => {
    const rows = payload({ popular: [
        tmdb('10', 'American Film', 2020, ['US']), tmdb('11', 'French Film', 2020, ['FR']), tmdb('12', 'Unknown Origin', 2020, []),
        tmdb('13', 'Coproduction', 2020, ['GB', 'US']), tmdb('14', 'Dubbed Hit', 2020, ['US'])
    ] });
    const items = [
        movie('American Film (2020)'), movie('French Film (2020)'), movie('Unknown Origin (2020)'), movie('FR - Unknown Origin (2020)', { categoryIds: ['fr'] }),
        movie('Coproduction (2020)'), movie('FR - Dubbed Hit (2020)', { categoryIds: ['fr'] }), movie('Plain English Film'), movie('Film Francais', { categoryIds: ['fr'] }),
        movie('Listed twice', { categoryIds: ['fr', 'en'] })
    ];
    const index = B.buildIndex('movies', items, cats, rows);
    const us = Object.fromEntries(index.titles.map(t => [t.item.name, t.us]));
    assert.deepEqual(us, {
        'American Film (2020)': true, 'French Film (2020)': false, 'Unknown Origin (2020)': true, 'FR - Unknown Origin (2020)': false,
        'Coproduction (2020)': true, 'FR - Dubbed Hit (2020)': false, 'Plain English Film': true, 'Film Francais': false, 'Listed twice': true
    });
    assert.deepEqual(picked(index, 'az').sort(), ['American Film (2020)', 'Coproduction (2020)', 'Listed twice', 'Plain English Film', 'Unknown Origin (2020)']);
    assert.equal(picked(index, 'az', { usOnly: false }).length, 8, 'All shows every title (the dubbed copy of Unknown Origin shows once)');
    assert.equal(B.usaAllowed(true, []), true); assert.equal(B.usaAllowed(false, ['US']), false); assert.equal(B.usaAllowed(true, ['CA']), false);
});

test('the category filter: country and language tags, IN and IT only as tags, names written out', () => {
    const foreign = ['FR | Films', '|DE| Filme', 'IT: Serie', 'ES - Peliculas', 'LAT Movies', 'MX Series', 'BR | Filmes', 'PT Filmes', 'TR Dizi', 'AR | Arabic',
        'IN | Movies', 'HINDI Movies', 'Hindi Movies', 'PK Dramas', 'NL Films', 'PL Filmy', 'RO Filme', 'RU Kino', 'UK Movies', 'CA | Movies', 'Films (IN)', 'Bollywood', 'LATINO', 'French Cinema', 'Canadian'];
    const kept = ['EN | Movies', 'MOVIES IN 4K', 'NEW IN CINEMAS', 'Action', 'Netflix Series', 'Indiana Jones Collection', 'US | Drama', 'Kids', 'Sports'];
    for (const name of foreign) assert.equal(B.isForeignCategory(name), true, name);
    for (const name of kept) assert.equal(B.isForeignCategory(name), false, name);
});

// docs/browse-cases.json: the cases every Tuner app runs (docs/browse.md, Test cases).
const sharedCases = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/browse-cases.json'), 'utf8'));
// Older Samsung and LG browsers have no String.prototype.normalize: data.js then folds accents with its own table.
// asciiLowerCase: also a toLowerCase that leaves every character beyond ASCII alone, as a TV's may.
function sandbox() { return vm.createContext({ window: { Promise, XMLHttpRequest: function () {}, localStorage: memoryStorage() }, console }); }
function withoutNormalize(asciiLowerCase = false) {
    const context = sandbox();
    vm.runInContext('delete String.prototype.normalize', context);
    assert.equal(vm.runInContext("typeof ''.normalize", context), 'undefined');
    if (asciiLowerCase) {
        vm.runInContext('String.prototype.toLowerCase = function () { return String(this).replace(/[A-Z]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 32); }); };', context);
        assert.equal(vm.runInContext("'\\u00c9\\u0130\\uff21\\u2160\\u24b6A'.toLowerCase()", context), '\u00c9\u0130\uff21\u2160\u24b6a');
    }
    vm.runInContext(sourceText, context);
    return context;
}
function loadWithoutNormalize(asciiLowerCase = false) { return withoutNormalize(asciiLowerCase).window.TunerData; }
// The oldest Samsung and LG browsers follow a Unicode older than 6.3, in which U+180E is a space: their \s and trim()
// also take it. In this context trim() and every String.prototype.replace whose pattern holds \s do the same.
function oldSpaces() {
    const context = sandbox(), proto = vm.runInContext('String.prototype', context), ContextRegExp = vm.runInContext('RegExp', context), replace = proto.replace;
    function widen(source) {
        let out = '', inClass = false;
        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (ch === '\\') { const next = source[++i]; out += next === 's' ? (inClass ? '\\s\\u180e' : '[\\s\\u180e]') : ch + next; continue; }
            if (ch === '[') inClass = true; else if (ch === ']') inClass = false;
            out += ch;
        }
        return out;
    }
    proto.replace = function (pattern, replacement) {
        if (pattern instanceof ContextRegExp && pattern.source.indexOf('\\s') >= 0) pattern = new ContextRegExp(widen(pattern.source), pattern.flags);
        return replace.call(this, pattern, replacement);
    };
    proto.trim = function () { return replace.call(String(this), /^[\s\u180e]+|[\s\u180e]+$/g, ''); };
    assert.equal(vm.runInContext("'\\u180e X\\u180e'.replace(/^\\s+|\\s+$/g, '') + '\\u180eY\\t'.trim() + 'Z\\u180e'.replace(/[\\sQ]+/g, '')", context), 'XYZ');
    vm.runInContext(sourceText, context);
    return context;
}

test('docs/browse-cases.json: the category filter', () => {
    const cases = sharedCases.filter(c => c.kind === 'category');
    assert.ok(cases.length >= 100);
    for (const c of cases) assert.equal(B.isForeignCategory(c.name), c.foreign, c.name);
});

test('docs/browse-cases.json: normalized titles and the year in the name, with and without String.prototype.normalize', () => {
    const cases = sharedCases.filter(c => c.kind === 'normalize'), fallback = loadWithoutNormalize().browse, old = oldSpaces().window.TunerData.browse;
    assert.ok(cases.length >= 50);
    for (const c of cases) {
        for (const browse of [B, fallback, old]) {
            assert.equal(browse.normalizeTitle(c.input), c.title, c.input);
            const year = browse.titleYear({ name: c.input });
            assert.equal(year ? String(year) : '', c.year, c.input);
        }
    }
});

test('a name ending in 40 quality tags and a word normalizes and gives its year in well under 50 ms', () => {
    // docs/browse.md, Test cases: YEAR_END tries the whole chain of tags and fails. With a TAG that matches "4K" in two
    // ways each further tag doubled its time; the vm timeout turns such a regression into a failure, not a hang.
    const name = 'Movie - 1999' + ' - 4K'.repeat(40) + ' - Extended';
    const contexts = { V8: sandbox(), 'without String.prototype.normalize': withoutNormalize(true), 'with U+180E in \\s': oldSpaces() };
    vm.runInContext(sourceText, contexts.V8);
    for (const [label, context] of Object.entries(contexts)) {
        context.name = name;
        const start = process.hrtime.bigint();
        const result = vm.runInContext('var b = window.TunerData.browse; [b.normalizeTitle(name), b.titleYear({ name: name }), b.normalizeTitle(name, true)]', context, { timeout: 5000 });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.deepEqual(plain(result), ['movie 1999 extended', 0, 'movie 1999 extended'], label);
        assert.ok(ms < 50, label + ': ' + ms.toFixed(2) + ' ms');
    }
    assert.equal(B.titleYear({ name: 'Movie - 1999' + ' - 4K'.repeat(40) }), 1999, 'without the word, the year before the 40 tags');
    assert.equal(B.normalizeTitle('Movie - 1999' + ' - hd'.repeat(40)), 'movie');
});

test('a name with 16,000 spaces inside is trimmed, read from a provider row, normalized and given its year in well under 50 ms', () => {
    // docs/browse.md, Trimming and Test cases: a trim written as ^[...]+|[...]+$ tries its second half again at every
    // space of the run, so its time grows with the square of the run (a fifth of a second in V8 here, 0.4 s on a TV).
    const run = ' '.repeat(16000), name = 'A' + run + 'B', ends = ' \t\u00a0\u3000';
    const contexts = { V8: sandbox(), 'without String.prototype.normalize': withoutNormalize(true), 'with U+180E in \\s': oldSpaces() };
    vm.runInContext(sourceText, contexts.V8);
    for (const [label, context] of Object.entries(contexts)) {
        context.name = name; context.field = ends + name + ends;
        const start = process.hrtime.bigint();
        const result = vm.runInContext('var d = window.TunerData, b = d.browse, item = d.parseXtream([{ stream_id: 1, name: field }], "movies", ' +
            '{ type: "xtream", server: "http://example.invalid", username: "u", password: "p" })[0];' +
            '[b.normalizeTitle(name), b.titleYear({ name: name }), b.normalizeTitle(name, true), d.text(field) === name, item.name === name, b.normalizeTitle(item.name), b.titleYear(item)]',
        context, { timeout: 5000 });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.deepEqual(plain(result), ['a b', 0, 'a b', true, true, 'a b', 0], label);
        assert.ok(ms < 50, label + ': ' + ms.toFixed(2) + ' ms');
    }
    assert.equal(B.normalizeTitle(run + 'Heat - 1995' + run), 'heat');
    assert.equal(B.titleYear({ name: run + 'Heat - 1995' + run }), 1995);
    assert.equal(data.text(run + '\u0085Heat\u2028' + run), 'Heat');
});

test('provider fields lose only tab, LF, VT, FF, CR, space and the Unicode spaces at their ends, also where \\s takes U+180E', () => {
    // docs/browse.md, Implementation notes: Samsung and LG trim with a loop over the character codes of that set; a name
    // then reaches normalize with nothing removed that step 1 would keep (U+180E, U+200B, U+001C to U+001F and the like).
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const edges = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
        0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff].map(code => String.fromCharCode(code)).join('');
    const kept = [0x00, 0x08, 0x0e, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f, 0x180e, 0x200b, 0x2060].map(code => String.fromCharCode(code));
    const normalizeCases = sharedCases.filter(c => c.kind === 'normalize');
    for (const [label, D] of [['V8', data], ['with U+180E in \\s', oldSpaces().window.TunerData]]) {
        assert.equal(D.text(edges + 'Heat' + edges), 'Heat', label);
        for (const ch of kept) assert.equal(D.text(edges + ch + 'Heat' + ch + edges), ch + 'Heat' + ch, label + ' ' + JSON.stringify(ch));
        const categories = D.parseCategories([{ category_id: edges + '1', category_name: edges + 'FR | Films' + edges }]
            .concat(kept.map((ch, i) => ({ category_id: String(i + 2), category_name: ch + 'Serie IT' + ch }))));
        assert.deepEqual(plain(categories.map(cat => [cat.id, cat.name])), [['1', 'FR | Films']].concat(kept.map((ch, i) => [String(i + 2), ch + 'Serie IT' + ch])), label);
        for (const cat of categories.slice(1)) assert.equal(D.browse.isForeignCategory(cat.name), false, label + ': IT is not a tag in ' + JSON.stringify(cat.name));
        const movies = D.parseXtream(kept.map((ch, i) => ({ stream_id: i + 1, name: ch + ' - 1999' + edges })), 'movies', source);
        for (const [i, item] of movies.entries()) {
            assert.equal(item.name, kept[i] + ' - 1999', label);
            assert.deepEqual([D.browse.normalizeTitle(item.name), D.browse.titleYear(item)], ['', 1999], label + ' ' + JSON.stringify(item.name));
        }
        // Every shared case read through the provider path gives what the name itself gives.
        for (const c of normalizeCases) {
            if (!D.text(c.input)) continue;
            const item = D.parseXtream([{ stream_id: 1, name: c.input }], 'movies', source)[0], year = D.browse.titleYear(item);
            assert.deepEqual([D.browse.normalizeTitle(item.name), year ? String(year) : ''], [c.title, c.year], label + ' ' + JSON.stringify(c.input));
        }
    }
});

test('docs/browse-cases.json: USA only, through the index', () => {
    const cases = sharedCases.filter(c => c.kind === 'usa');
    assert.ok(cases.length >= 40);
    for (const c of cases) {
        // category: a name or an array of names ("" or []: none); origin: the matched TMDB title's, null when unmatched.
        const categories = [].concat(c.category).filter(Boolean).map((name, i) => ({ id: 'c' + i, name }));
        const item = movie('Shared case', { categoryIds: categories.map(cat => cat.id), tmdb: c.origin ? '1' : '' });
        const index = B.buildIndex('movies', [item], categories, c.origin ? payload({ popular: [tmdb('1', 'Shared case', 2020, c.origin)] }) : null);
        const label = JSON.stringify(c);
        assert.equal(index.titles[0].tmdb, c.origin ? '1' : '', label);
        assert.equal(index.titles[0].us, c.expect, label);
        const passes = B.categoryCheck(categories)(item);
        assert.equal(c.origin ? B.usaAllowed(passes, c.origin) : passes, c.expect, label);
    }
});

test('docs/browse-cases.json: the provider TMDB id, read by JSON.parse and parseXtream, also where \\s takes U+180E', () => {
    // docs/browse.md, Matching step 1: the catalogue's own path, JSON.parse of the provider's reply, then parseXtream.
    // A row without a stream_id (series_id for a series row) or a name gets one; the cases never test those keys.
    const cases = sharedCases.filter(c => c.kind === 'tmdb'), source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    assert.ok(cases.length >= 100);
    for (const context of [sandbox(), oldSpaces()]) {
        if (!context.window.TunerData) vm.runInContext(sourceText, context);
        const D = context.window.TunerData, parse = vm.runInContext('JSON.parse', context);
        for (const c of cases) {
            const row = parse(c.json), kind = 'series_id' in row ? 'series' : 'movies', key = kind === 'series' ? 'series_id' : 'stream_id';
            if (!(key in row)) row[key] = 1;
            if (!('name' in row)) row.name = 'Title';
            const items = D.parseXtream([row], kind, source);
            assert.equal(items.length, 1, c.json);
            assert.equal(items[0].tmdb || null, c.expect, c.json);
        }
    }
});

test('docs/browse-cases.json: these tests run every kind of shared case', () => {
    const kinds = [...new Set(sharedCases.map(c => c.kind))].sort();
    assert.deepEqual(kinds, ['category', 'm3u', 'normalize', 'tmdb', 'usa'], 'a kind of case these tests do not run');
});

// docs/browse.md, M3U playlists: the live channels parseM3u makes of a playlist, in order, as {name, group}; the group
// is the name of the channel's category, "Uncategorized" (no group) read as "".
const m3uSource = { type: 'm3u', m3uUrl: 'http://m3u.invalid/list.m3u' };
function m3uChannels(D, text) {
    const parsed = D.parseM3u(text, m3uSource), groups = new Map(parsed.liveCategories.map(cat => [cat.id, cat.name]));
    assert.equal(parsed.movies.length + parsed.series.length, 0, 'every URL of the cases is a live channel');
    return plain(parsed.live.map(item => ({ name: item.name, group: groups.get(item.categoryId) === 'Uncategorized' ? '' : groups.get(item.categoryId) })));
}

test('docs/browse-cases.json: M3U playlists, named and grouped by parseM3u, also where \\s takes U+180E', () => {
    // Commas in titles and in "..." and '...' values, quotes without a partner, a missing or empty title, tvg-name and
    // Channel N, #EXTGRP:, keys in any case, control characters, Unicode spaces, a byte order mark, and playlists
    // whose lines end in LF, CR LF or CR alone (an old Mac playlist: one long line when split at LF).
    const cases = sharedCases.filter(c => c.kind === 'm3u');
    assert.ok(cases.length >= 30 && cases.some(c => /\r(?!\n)/.test(c.text) && !c.text.includes('\n')), 'CR-only playlists are among the cases');
    const context = sandbox();
    vm.runInContext(sourceText, context);
    for (const [label, D] of [['V8', context.window.TunerData], ['with U+180E in \\s', oldSpaces().window.TunerData]]) {
        for (const c of cases) assert.deepEqual(m3uChannels(D, c.text), c.expect, label + ': ' + JSON.stringify(c.text));
    }
});

test('M3U: lines end only at CR LF, CR and LF and are trimmed as provider fields, also where \\s takes U+180E', () => {
    // docs/browse.md, M3U playlists: U+0085, U+2028 and U+2029 are Unicode spaces, not line ends; trim() keeps U+0085,
    // and the oldest TV browsers' also takes U+180E, which a provider field keeps (so that line is a URL, left out).
    const playlist = ['#EXTM3U', '\u0085#EXTINF:-1 group-title="Movies",Heat\u2028', '\u2029http://m3u.invalid/live/1.ts\u0085', '\u180e#EXTINF:-1,Ronin',
        'http://m3u.invalid/live/3.ts', '\u3000#EXTINF:-1,Up\u2028Down\u00a0', '\ufeffhttp://m3u.invalid/live/4.ts'].join('\n');
    for (const [label, D] of [['V8', data], ['with U+180E in \\s', oldSpaces().window.TunerData]]) {
        assert.deepEqual(m3uChannels(D, playlist), [{ name: 'Heat', group: 'Movies' }, { name: 'Channel 3', group: '' }, { name: 'Up\u2028Down', group: '' }], label);
    }
});

test('M3U: N in Channel N counts every URL line of the playlist, the ones left out or merged and the movies too', () => {
    const playlist = ['#EXTM3U', '#EXTINF:-1,One', 'http://m3u.invalid/live/1.ts', '#EXTINF:-1,Not playable', 'rtmp://m3u.invalid/live/2',
        '#EXTINF:-1,Repeat of One', 'http://m3u.invalid/live/1.ts', '#EXTINF:-1 group-title="Films"', 'http://m3u.invalid/movie/4.mp4',
        '#EXTINF:-1 group-title="News"', 'http://m3u.invalid/live/5.ts', 'http://m3u.invalid/live/6.ts'].join('\r\n');
    const parsed = data.parseM3u(playlist, m3uSource), groups = new Map(parsed.liveCategories.map(cat => [cat.id, cat.name]));
    assert.deepEqual(plain(parsed.live.map(item => [item.name, groups.get(item.categoryId)])), [['One', 'Uncategorized'], ['Channel 5', 'News'], ['Channel 6', 'Uncategorized']],
        'the rtmp URL is left out and the repeat of One merges into it, and both count');
    assert.deepEqual(plain(parsed.movies.map(item => item.name)), ['Channel 4']);
});

test('M3U: an #EXTINF line of 200,000 characters is read in one pass, in well under 100 ms', () => {
    // docs/browse.md, M3U playlists: a reader that starts a key again at every character of a long run of key
    // characters, or a pattern over the whole line, takes time that grows with the square of the line (seconds here).
    const lines = {
        'a run of key characters before an unpaired quote': '#EXTINF:-1 ' + 'a'.repeat(200000) + '="x,Heat',
        'values with commas and both quotes, and stray quotes': '#EXTINF:-1 ' + 'a="x,y" b=\'c"d\' "e '.repeat(10000) + 'k="unclosed ,Heat',
        'spaces around "="': '#EXTINF:-1 tvg-name' + ' '.repeat(100000) + '=' + ' '.repeat(100000) + 'x,Heat',
    };
    const context = sandbox();
    vm.runInContext(sourceText, context);
    for (const [label, line] of Object.entries(lines)) {
        context.playlist = '#EXTM3U\r' + line + '\rhttp://m3u.invalid/live/1.ts';
        const start = process.hrtime.bigint();
        const names = vm.runInContext('window.TunerData.parseM3u(playlist, {}).live.map(function (item) { return item.name; })', context, { timeout: 5000 });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.deepEqual(plain(names), ['Heat'], label);
        assert.ok(ms < 100, label + ': ' + ms.toFixed(2) + ' ms');
    }
});

test('M3U: names with 16,000 spaces inside, before an episode marker or not, are read in well under 50 ms, also where \\s takes U+180E', () => {
    // "Show S01E02" names: a show-name pattern ^(.*?)\s+S.. ran \s+ again from every space of a run that no episode
    // marker follows to the end of the run, so its time grew with the square of the run (a second for this playlist).
    const run = ' '.repeat(16000);
    const playlist = ['#EXTM3U', '#EXTINF:-1 group-title="Shows",The' + run + 'Show S01E02 Pilot', 'http://m3u.invalid/series/1.mp4',
        '#EXTINF:-1 group-title="Films",A' + run + 'B', 'http://m3u.invalid/movie/2.mp4', '#EXTINF:-1 group-title="News",News' + run + '24', 'http://m3u.invalid/live/3.ts'].join('\n');
    const context = sandbox();
    vm.runInContext(sourceText, context);
    for (const [label, ctx] of [['V8', context], ['with U+180E in \\s', oldSpaces()]]) {
        ctx.playlist = playlist; ctx.run = run;
        const start = process.hrtime.bigint();
        const result = vm.runInContext('var r = window.TunerData.parseM3u(playlist, {}), short = function (name) { return name.split(run).join("<run>"); };' +
            '[r.series.map(function (s) { return [short(s.name), s._episodes.map(function (e) { return [e.season, e.episode, short(e.name)]; })]; }),' +
            ' r.movies.map(function (m) { return short(m.name); }), r.live.map(function (m) { return short(m.name); })]', ctx, { timeout: 5000 });
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.deepEqual(plain(result), [[['The<run>Show', [[1, 2, 'The<run>Show S01E02 Pilot']]]], ['A<run>B'], ['News<run>24']], label);
        assert.ok(ms < 50, label + ': ' + ms.toFixed(2) + ' ms');
    }
});

test('category names with 16,000 spaces inside give their genres in well under 50 ms', () => {
    // A category's genre words: a split at \s+-\s+ tried \s+ again from every space of a run that no dash follows, to
    // the end of the run, so its time grew with the square of the run (a quarter of a second here).
    const context = sandbox();
    vm.runInContext(sourceText, context);
    context.run = ' '.repeat(16000);
    const start = process.hrtime.bigint();
    const result = vm.runInContext('var b = window.TunerData.browse, movie = function (id, cat) { return { id: id, name: "Heat", categoryIds: [cat], year: "", rating: "", added: 0, tmdb: "", genre: "", url: "https://fixture.invalid/m.mp4", backups: [] }; },' +
        ' index = b.buildIndex("movies", [movie("m:1", "c1"), movie("m:2", "c2")], [{ id: "c1", name: "Action" + run + "& Comedy" }, { id: "c2", name: "Drama" + run + "- Kids" }], null);' +
        ' [index.titles.map(function (t) { return t.g; }), index.genres.map(function (g) { return g.name; })]', context, { timeout: 5000 });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.deepEqual(plain(result), [['|action|comedy|', '|drama|kids|'], ['Action', 'Comedy', 'Drama', 'Kids']]);
    assert.ok(ms < 50, ms.toFixed(2) + ' ms');
});

test('USA only: category ids missing from the category list are left out', () => {
    const index = B.buildIndex('movies', [movie('Gone', { categoryIds: ['gone'] }), movie('French and gone', { categoryIds: ['fr', 'gone'] }), movie('None', { categoryIds: [] })], cats, null);
    assert.deepEqual(plain(index.titles.map(t => t.us)), [true, false, true]);
});

test('matching: a name whose real title looks like a tag is looked up again with its tags kept', () => {
    const rows = payload({}, { popular: [tmdb('1620', 'CSI: Miami', 2002), tmdb('4057', 'NCIS: Los Angeles', 2009)] });
    const index = B.buildIndex('series', [show('CSI: Miami', { year: '2003' }), show('NCIS: Los Angeles'), show('CSI: Miami', { tmdb: '999' })], cats, rows);
    assert.deepEqual(plain(index.titles.map(t => t.norm)), ['miami', 'los angeles', 'miami']);
    assert.deepEqual(plain(index.titles.map(t => t.tmdb)), ['1620', '4057', ''], 'a provider TMDB id never falls back to the name');
});

test('copies of one TMDB title are one poster: where its first visible copy stands, showing its best visible copy', () => {
    const rows = payload({ popular: [tmdb('949', 'Heat', 1995)] });
    const items = [movie('Heat (1995)', { id: 'm:us-old', added: 100 }), movie('Heat (1995)', { id: 'm:us-new', added: 150 }),
        movie('FR - Heat (1995)', { id: 'm:fr', added: 300, categoryIds: ['fr'] }), movie('Other', { id: 'm:other', added: 200 })];
    const index = B.buildIndex('movies', items, cats, rows);
    const ids = (key, usOnly) => plain(B.pick(index, key, { usOnly, genre: '' }, 0, 10).picked.map(p => index.titles[p].item.id));
    assert.deepEqual(plain(index.titles.map(t => t.tmdb)), ['949', '949', '949', '']);
    assert.deepEqual(ids('recent', false), ['m:us-new', 'm:other'], 'the dubbed copy is newest, but the copy that passes USA only opens');
    assert.deepEqual(ids('recent', true), ['m:other', 'm:us-new']);
    assert.deepEqual(ids('popular', false), ['m:us-new']); assert.deepEqual(ids('popular', true), ['m:us-new']);
});

test('Home rows: Popular, Featured, services, Recently added, Top rated; 5 titles or more, 20 at most, ending with each list', () => {
    const many = (prefix, n, extra = () => ({})) => Array.from({ length: n }, (_, i) => movie(prefix + ' ' + (i + 1), extra(i)));
    const popularItems = many('Pop', 25, i => ({ added: 100 + i, rating: String(5 + (i % 5)) }));
    const few = many('Few', 4);
    const netflixCat = many('Cat', 6, i => ({ categoryIds: ['nf'], added: 50 + i }));
    const rows = payload({
        popular: popularItems.map((m, i) => tmdb(String(100 + i), m.name, 2020)).concat([tmdb('999', 'Not in this catalogue', 2020)]),
        featured: few.map((m, i) => tmdb(String(200 + i), m.name, 2020)),
        top_rated: popularItems.slice(0, 6).reverse().map((m, i) => tmdb(String(105 - i), m.name, 2020)),
        services: { netflix: popularItems.slice(10, 12).map((m, i) => tmdb(String(110 + i), m.name, 2020)) }
    });
    const movies = B.buildIndex('movies', popularItems.concat(few, netflixCat), cats, rows);
    const series = B.buildIndex('series', [], cats, rows);
    const home = B.homeRows({ movies, series }, { usOnly: true, withTmdb: true });
    assert.deepEqual(plain(home.map(r => r.title)), ['Popular – Movies', 'Netflix – Movies', 'Recently added – Movies', 'Top rated – Movies'],
        'Featured has 4 titles and Series none: hidden');
    const byTitle = Object.fromEntries(home.map(r => [r.title, names(movies, r.positions)]));
    assert.equal(byTitle['Popular – Movies'].length, 20);
    assert.deepEqual(byTitle['Popular – Movies'].slice(0, 3), ['Pop 1', 'Pop 2', 'Pop 3'], 'TMDB order');
    assert.deepEqual(byTitle['Netflix – Movies'], ['Pop 11', 'Pop 12', 'Cat 6', 'Cat 5', 'Cat 4', 'Cat 3', 'Cat 2', 'Cat 1'], 'TMDB service list, then the service\'s categories, newest first');
    assert.deepEqual(byTitle['Recently added – Movies'].slice(0, 2), ['Pop 25', 'Pop 24']);
    assert.deepEqual(byTitle['Top rated – Movies'].slice(0, 6), ['Pop 6', 'Pop 5', 'Pop 4', 'Pop 3', 'Pop 2', 'Pop 1'], 'TMDB top rated first');
    assert.ok(byTitle['Top rated – Movies'].includes('Pop 10'), 'then unmatched or other titles by the provider rating');
    assert.equal(plain(B.homeRowSpecs(true)).length, 24); assert.equal(plain(B.homeRowSpecs(false)).length, 20);
    assert.deepEqual(plain(B.homeRowSpecs(true).slice(4, 6).map(s => s.title)), ['Netflix – Movies', 'Netflix – Series']);
});

test('without TMDB: no Popular or Featured; services from category names; Recently added by added or last_modified; Top rated by rating', () => {
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const parsed = data.parseXtream(Array.from({ length: 6 }, (_, i) => ({ series_id: 10 + i, name: 'Show ' + i, category_id: i < 5 ? 'hbo' : 'en', last_modified: String(1700000000 + i), rating: String(i + 2) })), 'series', source);
    assert.equal(parsed[5].added, 1700000005, 'series use last_modified as their added time');
    const series = B.buildIndex('series', parsed, cats, null);
    const movies = B.buildIndex('movies', [], cats, B.parseRows({ v: 1, source: 'none', movie: {}, tv: {}, genres: {} }));
    const home = B.homeRows({ movies, series }, { usOnly: true, withTmdb: false });
    assert.deepEqual(plain(home.map(r => r.title)), ['Max – Series', 'Recently added – Series', 'Top rated – Series']);
    assert.deepEqual(names(series, home[0].positions), ['Show 4', 'Show 3', 'Show 2', 'Show 1', 'Show 0']);
    assert.deepEqual(names(series, home[2].positions), ['Show 5', 'Show 4', 'Show 3', 'Show 2', 'Show 1', 'Show 0']);
    assert.deepEqual(plain(B.discoverLists(false).map(l => l.key)), ['rated', 'recent', 'az', 'netflix', 'disney', 'max', 'prime', 'apple', 'hulu', 'paramount', 'peacock']);
    assert.deepEqual(plain(B.discoverLists(true).slice(0, 5).map(l => l.name)), ['Popular', 'Featured', 'Top rated', 'Recently added', 'A–Z']);
    assert.deepEqual(plain(B.categoryServices('HBO Max | Movies')), ['max']); assert.deepEqual(plain(B.categoryServices('Amazon Prime Video')), ['prime']);
    assert.deepEqual(plain(B.categoryServices('Cinemax')), [], 'Max only as a word');
});

test('Discover: genres are TMDB ids when matched, the provider genre or a genre-named category otherwise; lists page without limit', () => {
    const rows = payload({ popular: [tmdb('1', 'Matched Action', 2020, ['US'], [28]), tmdb('2', 'Matched Drama', 2020, ['US'], [18])] });
    const items = [movie('Matched Action (2020)'), movie('Matched Drama (2020)'), movie('Provider Comedy', { genre: 'Comedy, Drama' }), movie('Filed Under Action', { categoryIds: ['action'] }), movie('No Genre')];
    const index = B.buildIndex('movies', items, cats, rows);
    assert.deepEqual(plain(index.genres.map(g => g.name)), ['Action', 'Drama', 'Comedy'], 'TMDB genres that some title has, in TMDB order');
    assert.deepEqual(picked(index, 'az', { genre: '28' }), ['Filed Under Action', 'Matched Action (2020)']);
    assert.deepEqual(picked(index, 'az', { genre: '18' }), ['Matched Drama (2020)', 'Provider Comedy']);
    // Without TMDB the genre list is built from the provider's genre names and genre-named categories.
    const open = B.buildIndex('movies', items, cats, null);
    assert.deepEqual(plain(open.genres.map(g => g.name)), ['Action', 'Comedy', 'Drama']);
    assert.deepEqual(picked(open, 'az', { genre: 'comedy' }), ['Provider Comedy']);
    // Series genres: "Action & Adventure" also answers to Action.
    const tv = B.buildIndex('series', [show('Chase Show', { genre: 'Action' })], cats, rows);
    assert.deepEqual(plain(tv.titles[0].g), '|10759|');
    // Paging: a cursor continues where the last page stopped, and done marks the end.
    const big = B.buildIndex('movies', Array.from({ length: 30 }, (_, i) => movie('Title ' + String(i).padStart(2, '0'))), cats, null);
    const opts = { usOnly: true, genre: '', seen: {} };
    const first = B.pick(big, 'az', opts, 0, 12), second = B.pick(big, 'az', opts, first.cursor, 12), last = B.pick(big, 'az', opts, second.cursor, 12);
    assert.deepEqual([first.picked.length, second.picked.length, last.picked.length, first.done, last.done], [12, 12, 6, false, true]);
    assert.equal(big.titles[last.picked[5]].item.name, 'Title 29');
});

test('large catalogues index in steps, and matching is applied in one pass', () => {
    const items = Array.from({ length: 1000 }, (_, i) => movie('Step ' + i, { year: '2020' }));
    const builder = B.createIndexBuilder('movies', items, cats);
    let steps = 0;
    while (!builder.step(150)) steps++;
    assert.equal(steps, 6); assert.equal(builder.index.titles.length, 1000);
    const rows = payload({ popular: [tmdb('7', 'Step 7', 2020, ['FR'])] });
    const index = B.matchIndex(builder.index, null);
    assert.equal(index.titles[7].us, true);
    const matcher = B.createMatcher(index, rows);
    while (!matcher.step(100)) {}
    assert.equal(index.titles[7].tmdb, '', 'nothing changes before apply');
    matcher.apply();
    assert.equal(index.titles[7].tmdb, '7'); assert.equal(index.titles[7].us, false);
});

test('the rows payload: version 1 only, every missing list empty, items cleaned', () => {
    assert.equal(B.parseRows('not json'), null);
    assert.equal(B.parseRows({ v: 2 }), null);
    const rows = B.parseRows('{"v":1,"source":"tmdb","movie":{"popular":[{"id":5,"title":"A","year":"2020","origin":["us"],"genres":[28,"x"]},{"title":"no id"}]},"genres":{"movie":[{"id":28,"name":"Action"},{"name":"broken"}]}}');
    assert.deepEqual(plain(rows.movie.popular), [{ id: '5', title: 'A', original_title: '', year: 2020, origin: ['US'], genres: ['28'] }]);
    assert.deepEqual(plain(rows.tv.services.peacock), []); assert.deepEqual(plain(rows.movie.featured), []);
    assert.deepEqual(plain(rows.genres), { movie: [{ id: '28', name: 'Action' }], tv: [] });
    assert.equal(B.hasTmdb(rows), true);
    assert.equal(B.hasTmdb(B.parseRows({ v: 1, source: 'none', movie: {}, tv: {}, genres: {} })), false);
});

test('rows cache: fresh for 12 hours, then stale but used; only HTTP 200 version 1 answers are stored', () => {
    let now = 1000 * HOUR;
    const requests = [];
    class Xhr { open(method, url) { this.url = url; } send() { requests.push(this); } }
    function answer(status, body) { const r = requests.shift(); r.status = status; r.responseText = typeof body === 'string' ? body : JSON.stringify(body); r.readyState = 4; r.onreadystatechange(); }
    const tmdbBody = { v: 1, source: 'tmdb', movie: { popular: [tmdb(1, 'Saved', 2020)] }, tv: {}, genres: {} };
    const storage = memoryStorage();
    const received = [];
    function client() { return B.createRowsClient({ storage, XMLHttpRequest: Xhr, now: () => now }); }
    assert.equal(B.rowsFreshness(null, now), 'none');
    let c = client();
    assert.equal(c.peek(), null);
    assert.equal(c.refresh(rows => received.push(rows)), true);
    assert.equal(requests[0].url, 'https://lumanest.tv/api/catalog/rows?v=1');
    answer(503, ''); // TMDB failed and the server had no copy: nothing stored, no rows.
    assert.equal(storage.getItem(B.ROWS_KEY), null); assert.equal(received.length, 0);
    assert.equal(c.refresh(), false, 'no new request within five minutes of a failure');
    now += 5 * 60000;
    c.refresh(rows => received.push(rows)); answer(200, tmdbBody);
    assert.equal(received.length, 1); assert.equal(received[0].movie.popular[0].title, 'Saved');
    assert.equal(c.freshness(), 'fresh');
    now += 11 * HOUR;
    c = client();
    assert.equal(c.peek().movie.popular[0].title, 'Saved', 'a new session reads the saved copy');
    assert.equal(c.refresh(), false, 'a copy younger than 12 hours is not refreshed');
    now += 2 * HOUR;
    assert.equal(c.freshness(), 'stale');
    assert.equal(c.refresh(rows => received.push(rows)), true);
    answer(200, 'not json');
    assert.equal(c.peek().movie.popular[0].title, 'Saved', 'an unreadable answer keeps the stale copy');
    now += 6 * 60000;
    c.refresh(rows => received.push(rows)); answer(500, 'oops');
    assert.equal(c.peek().movie.popular[0].title, 'Saved', 'a failed request keeps the stale copy');
    now += 6 * 60000;
    c.refresh(rows => received.push(rows)); answer(200, { v: 1, source: 'none', movie: {}, tv: {}, genres: {} });
    assert.equal(c.peek().source, 'none', 'a server without TMDB answers 200 "none": stored, and the apps fall back');
    assert.equal(B.hasTmdb(c.peek()), false);
    const offline = B.createRowsClient({ storage: memoryStorage(), XMLHttpRequest: null });
    assert.equal(offline.refresh(), false); assert.equal(offline.peek(), null);
    storage.setItem(B.ROWS_KEY, '{broken'); assert.equal(client().peek(), null, 'a damaged saved copy is ignored');
});

test('provider items carry their TMDB id (tmdb, tmdb_id, info.tmdb_id or info.tmdb) and genre', () => {
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const movies = data.parseXtream([
        { stream_id: 1, name: 'A', tmdb: '603' }, { stream_id: 2, name: 'B', tmdb_id: 27205, genre: 'Action, Sci-Fi' },
        { stream_id: 3, name: 'C', info: { tmdb_id: '155' } }, { stream_id: 4, name: 'D', tmdb: '0' }, { stream_id: 5, name: 'E', tmdb: 'tt0133093' }
    ], 'movies', source);
    assert.deepEqual(plain(movies.map(m => m.tmdb)), ['603', '27205', '155', '', '']);
    const more = data.parseXtream([
        { stream_id: 6, name: 'F', info: { tmdb: '680' } }, { stream_id: 7, name: 'G', tmdb: '27205.0' }, { stream_id: 8, name: 'H', tmdb: '1234567890123', tmdb_id: '00603' },
        { stream_id: 9, name: 'I', tmdb: 'x', info: { tmdb_id: '0', tmdb: 13 } }, { stream_id: 10, name: 'J', tmdb: '1.5' }
    ], 'movies', source);
    assert.deepEqual(plain(more.map(m => m.tmdb)), ['680', '27205', '603', '13', ''], 'info.tmdb too, a trailing .0, 1 to 12 digits, never zero');
    assert.equal(movies[1].genre, 'Action, Sci-Fi');
    const live = data.parseXtream([{ stream_id: 9, name: 'CNN', tmdb: '1' }], 'live', source, 'm3u8');
    assert.equal(live[0].tmdb, undefined, 'live channels are unchanged');
    assert.equal(data.foldMovies([movie('Same', { tmdb: '' }), movie('Same', { tmdb: '42', added: -1 })])[0].tmdb, '42');
});

test('the provider year: the first of year, releaseDate, release_date and releasedate that starts with a year from 1800 to 2099', () => {
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const fields = [{ year: '2021-10-22' }, { year: 'N/A', releaseDate: '2020-05-01' }, { year: '', release_date: ' 1999-01-01' }, { releasedate: '1850' },
        { year: '20201', releaseDate: '2100-01-01' }, { year: 2015 }];
    const movies = data.parseXtream(fields.map((f, i) => Object.assign({ stream_id: i + 1, name: 'M' + i }, f)), 'movies', source);
    assert.deepEqual(plain(movies.map(m => m.year)), ['2021', '2020', '1999', '1850', '', '2015']);
    const series = data.parseXtream([{ series_id: 1, name: 'S', releaseDate: '2008-01-20' }], 'series', source);
    assert.equal(series[0].year, '2008');
    assert.equal(B.titleYear({ name: 'Heat (1995)', year: 'N/A' }), 1995, 'else the name');
    assert.equal(B.titleYear({ name: 'Heat', releasedate: '1995-12-15' }), 1995);
    // docs/browse.md, Spaces and letter case: the Unicode spaces are read as spaces, and nothing else is.
    const unicodeSpaces = [0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
    for (const code of unicodeSpaces) {
        const space = String.fromCharCode(code), label = 'U+' + code.toString(16).toUpperCase();
        assert.equal(data.providerYear({ year: space + '2021' }), '2021', label);
        assert.equal(data.providerYear({ releaseDate: ' ' + space + '\t1999-01-01' }), '1999', label);
        assert.equal(B.titleYear({ name: 'Heat |' + space + '1995' + space }), 1995, label);
    }
    for (const other of ['\u200b', '\u180e', '\x1f', '\u2007\u200b']) assert.equal(data.providerYear({ year: other + '2021' }), '', JSON.stringify(other));
    assert.equal(data.providerYear({ year: '\v\f\r\n2021' }), '2021', 'tab, LF, VT, FF, CR and space are \\s');
});

test('origin countries: two ASCII letters with only spaces around them, upper-cased; anything else is ignored', () => {
    assert.deepEqual(plain(B.originCountries(['US', ' us', '\u00a0gb\u3000', '\tJp\n', 'USA', 'U.S.', 'U S', '', 'u\u017f', '\uff35\uff33', 'US\u200b', '\x1fUS', 1, null, ['US']])), ['US', 'US', 'GB', 'JP']);
    assert.deepEqual(plain(B.originCountries(null)), []);
    const rows = payload({ popular: [tmdb('1', 'One', 2020, [' us', 'USA', 'gb']), tmdb('2', 'Two', 2020, ['USA']), tmdb('3', 'Three', 2020, 'US')] });
    assert.deepEqual(plain(rows.movie.popular.map(item => item.origin)), [['US', 'GB'], [], []]);
    assert.equal(B.usaAllowed(true, ['USA']), true, '["USA"] is unknown, as [] is');
    assert.equal(B.usaAllowed(true, ['USA', 'GB']), false, 'Great Britain alone');
    assert.equal(B.usaAllowed(true, ['u\u017f']), true, 'u\u017f is not a country');
});

test('without String.prototype.normalize, the fold table gives what NFKD gives for its ranges, in upper and lower case', () => {
    // docs/browse.md, Implementation notes: Latin-1, Latin Extended-A and -B, the ligatures U+FB00 to U+FB06, the
    // fullwidth digits and letters, the Roman numerals and the circled numbers and letters (and the Kelvin and
    // Angstrom signs, which toLowerCase may leave alone on a TV).
    const fallbacks = [loadWithoutNormalize().browse, loadWithoutNormalize(true).browse];
    const ranges = [[0xa0, 0x24f], [0xfb00, 0xfb06], [0xff10, 0xff19], [0xff21, 0xff3a], [0xff41, 0xff5a], [0x2160, 0x217f], [0x2460, 0x2473], [0x24b6, 0x24e9], [0x212a, 0x212b]];
    let checked = 0;
    for (const [first, last] of ranges) {
        for (let code = first; code <= last; code++) {
            const ch = String.fromCharCode(code);
            for (const name of ['x' + ch + 'y', ch, 'The ' + ch + ch + ' Show', 'A' + ch + '1']) {
                for (const fallback of fallbacks) assert.equal(fallback.normalizeTitle(name), B.normalizeTitle(name), 'U+' + code.toString(16).toUpperCase() + ' ' + JSON.stringify(name));
                checked++;
            }
        }
    }
    assert.equal(checked, 607 * 4);
    const examples = { '\u2168 and \u2178': 'ix and ix', '\u2460\u2473': '120', '\u24b6\u24e9': 'az', '\uff26\uff55\uff4c\uff4c \uff10\uff19': 'full 09',
        '\u01c5ungla': 'dzungla', '\ufb01nd': 'find', '\u212aelvin': 'kelvin', 'Mi\ufe20ami': 'mi ami', 'Caf\u00e9\u0301': 'cafe' };
    for (const [input, expected] of Object.entries(examples)) {
        for (const browse of [B, ...fallbacks]) assert.equal(browse.normalizeTitle(input), expected, JSON.stringify(input));
    }
});

test('Continue watching: movies in progress, the episode in progress or the next one, newest first; gone titles drop out', () => {
    const catalogue = { movies: { 'm:1': { id: 'm:1', name: 'Movie' }, 'm:2': { id: 'm:2', name: 'Other movie' } }, series: { 's:1': { id: 's:1', name: 'Show' }, 's:2': { id: 's:2', name: 'Next show' } } };
    const find = (kind, id) => catalogue[kind][id] || null;
    const recents = [
        { id: 'e:12', seriesId: 's:1', season: 1, episode: 2, position: 600000, duration: 2400000, updated: 50 },
        { id: 'm:1', position: 3000000, duration: 6000000, updated: 40 },
        { id: 'e:old', position: 100000, duration: 2400000, updated: 30 },
        { id: 'e:11', seriesId: 's:1', season: 1, episode: 1, position: 600000, duration: 2400000, updated: 20 },
        { id: 'm:gone', position: 100000, duration: 200000, updated: 10 }
    ];
    const upNext = [{ seriesId: 's:2', season: 1, episode: 4, updated: 45 }];
    const list = B.continueWatching(recents, upNext, find);
    assert.deepEqual(plain(list.map(t => [t.item.name, t.progress === undefined ? null : t.progress, t.resume || null, t.next || null])), [
        ['Show', 0.25, 'e:12', null], ['Next show', null, null, { season: 1, episode: 4 }], ['Movie', 0.5, null, null]]);
    const seasons = [{ number: 1, episodes: [{ id: 'e:11', episode: 1 }, { id: 'e:12', episode: 2 }, { id: 'e:14', episode: 4 }] }, { number: 2, episodes: [{ id: 'e:21', episode: 1 }] }];
    assert.deepEqual(plain(B.episodeToOpen(seasons, 'e:12', null)), { season: 0, episode: 1 });
    assert.deepEqual(plain(B.episodeToOpen(seasons, null, { season: 1, episode: 2 })), { season: 0, episode: 2 });
    assert.deepEqual(plain(B.episodeToOpen(seasons, null, { season: 1, episode: 4 })), { season: 1, episode: 0 }, 'after a season\'s last episode, the next season');
    assert.equal(B.episodeToOpen(seasons, null, { season: 2, episode: 1 }), null, 'the series is finished');
});

test('the library store: finishing an episode leaves a next-episode marker; Recently watched keeps 40 titles, newest first', () => {
    const storage = memoryStorage();
    const store = load({ localStorage: storage }).createStore(storage);
    store.saveSettings({ source: { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' } });
    const episode = { id: 'e:7', name: 'Pilot', url: 'https://fixture.invalid/e.mp4', season: 1, episode: 1, seriesId: 's:3' };
    store.saveRecent(episode, 600000, 2400000);
    assert.equal(store.recents()[0].seriesId, 's:3');
    store.saveRecent(episode, 2390000, 2400000);
    assert.deepEqual(plain(store.recents()), []);
    assert.deepEqual(plain(store.upNext().map(n => [n.seriesId, n.season, n.episode])), [['s:3', 1, 1]]);
    store.saveRecent({ ...episode, id: 'e:8', episode: 2 }, 60000, 2400000);
    assert.deepEqual(plain(store.upNext()), [], 'watching the next episode replaces the marker');
    store.saveRecent({ id: 'm:1', name: 'Movie', url: 'https://fixture.invalid/m.mp4' }, 5990000, 6000000);
    assert.equal(store.recents().length, 1, 'a finished movie leaves Continue watching');
    for (let i = 0; i < 45; i++) store.recordSeen('m:' + i);
    store.recordSeen('m:3');
    const seen = store.seen();
    assert.equal(seen.length, 40); assert.equal(seen[0].id, 'm:3'); assert.equal(seen[1].id, 'm:44');
    const reloaded = load({ localStorage: storage }).createStore(storage);
    assert.equal(reloaded.seen()[0].id, 'm:3'); assert.equal(reloaded.recents()[0].id, 'e:8');
});

// Regression tests for the review of the Movies & Series screens.
test('pipe-delimited names keep their title: only short upper-case tags between pipes are dropped', () => {
    const cases = { 'EN | The Matrix | 1999': 'matrix', '4K | Avatar | 2009': 'avatar', '4K | Title | EN': 'title', '|EN| The Matrix': 'matrix', 'EN | The Matrix (1999)': 'matrix',
        '| 4K | Dune': 'dune', 'Dune | 4K | EN': 'dune', '|US| 1984': '1984', '2012 | 1999 | EN': '2012', 'EN | 300': '300', '| EN | IT': 'it' };
    for (const [input, expected] of Object.entries(cases)) assert.equal(B.normalizeTitle(input), expected, input);
    assert.equal(B.titleYear({ name: 'EN | The Matrix | 1999' }), 1999, 'a year after a pipe is the year');
    assert.equal(B.titleYear({ name: '2012 | 1999 | EN' }), 1999, 'the year among the trailing tags');
    assert.equal(B.titleYear({ name: 'EN | 1984 | 2010' }), 2010, 'the year nearest the end');
    const index = B.buildIndex('movies', [movie('EN | The Matrix | 1999')], cats, payload({ popular: [tmdb('603', 'The Matrix', 1999), tmdb('604', 'The Matrix', 2021)] }));
    assert.equal(index.titles[0].tmdb, '603');
});

test('timestamps: a feed in milliseconds sorts like seconds, and no value can corrupt a sorted list', () => {
    const items = [movie('Old', { added: 1600000000 }), movie('Millis', { added: 1700000000000 }), movie('New', { added: 1650000000 }), movie('Huge', { added: 1e15 }), movie('Rated', { rating: '1e300' })];
    const index = B.buildIndex('movies', items, cats, null);
    assert.equal(index.titles[1].added, 1700000000);
    assert.deepEqual(names(index, B.listOf(index, 'recent')), ['Huge', 'Millis', 'New', 'Old']);
    assert.deepEqual(names(index, B.listOf(index, 'rated')), ['Rated']);
    const many = B.buildIndex('movies', Array.from({ length: 40 }, (_, i) => movie('T' + i, { added: i === 7 ? 9e15 : 1700000000000 + i * 1000 })), cats, null);
    const recent = B.listOf(many, 'recent');
    assert.equal(recent.length, 40); assert.deepEqual(plain(recent.slice(0, 3)), [7, 39, 38]); assert.ok(recent.every(p => p >= 0 && p < 40));
    assert.equal(B.homeRows({ movies: many, series: null }, { usOnly: true, withTmdb: false })[0].list, 'recent');
});

test('re-uploads fold into the newest; uploads listed only in foreign categories fold among themselves', () => {
    const catsWithDe = cats.concat([{ id: 'de', name: 'DE | Filme' }]);
    const en = movie('Avatar (2009)', { id: 'm:en', added: 100, url: 'https://x/en.mp4' }), fr = movie('Avatar (2009)', { id: 'm:fr', added: 200, categoryIds: ['fr'], url: 'https://x/fr.mp4' });
    const folded = data.foldMovies([en, fr], catsWithDe);
    assert.deepEqual(plain(folded.map(m => [m.id, m.backups])), [['m:en', []], ['m:fr', []]], 'a dubbed copy is never a backup of the US copy');
    const index = B.buildIndex('movies', folded, catsWithDe, payload({ popular: [tmdb('19995', 'Avatar', 2009)] }));
    assert.deepEqual(picked(index, 'popular'), ['Avatar (2009)']);
    assert.equal(index.titles[B.pick(index, 'popular', { usOnly: true, genre: '' }, 0, 1).picked[0]].item.url, 'https://x/en.mp4', 'USA only hides the dubbed copy');
    assert.equal(index.titles[B.pick(index, 'popular', { usOnly: false, genre: '' }, 0, 1).picked[0]].item.url, 'https://x/en.mp4', 'All shows the copy that passes first');
    // Within a group: the newest upload is kept (milliseconds count as seconds; on a tie the first), the others are
    // its backups, newest first, and its aliases; categories merge; a missing TMDB id, year or genre comes from the newest copy with one.
    const group = data.foldMovies([
        movie('Heat', { id: 'm:1', added: 1000, url: 'https://x/1', tmdb: '949', year: '1995', genre: 'Crime' }),
        movie('HEAT', { id: 'm:2', added: 3000000, url: 'https://x/2', categoryIds: ['action'], year: '1996' }),
        movie('Heat!', { id: 'm:3', added: 2000000000000, url: 'https://x/3', categoryIds: ['nf', 'fr'] }),
        movie('heat', { id: 'm:4', added: 2000000000, url: 'https://x/4', backups: ['https://x/4b'] })
    ], catsWithDe);
    assert.equal(group.length, 1);
    assert.deepEqual(plain([group[0].id, group[0].url, group[0].backups, group[0].aliases, group[0].categoryIds, group[0].tmdb, group[0].year, group[0].genre]),
        ['m:3', 'https://x/3', ['https://x/4', 'https://x/4b', 'https://x/2', 'https://x/1'], ['m:4', 'm:2', 'm:1'], ['nf', 'fr', 'en', 'action'], '949', '1996', 'Crime']);
    assert.equal(data.foldMovies([movie('Tie', { id: 'm:a', added: 5 }), movie('Tie', { id: 'm:b', added: 5 })])[0].id, 'm:a', 'a tie keeps the first');
    const foreign = data.foldMovies([movie('Heat', { added: 1, categoryIds: ['fr'], url: 'https://x/fr' }), movie('Heat', { added: 2, categoryIds: ['de'], url: 'https://x/de' })], catsWithDe);
    assert.deepEqual(plain(foreign.map(m => [m.url, m.backups])), [['https://x/de', ['https://x/fr']]], 'foreign copies fold among themselves');
    assert.equal(B.buildIndex('movies', foreign, catsWithDe, null).titles[0].us, false, 'only foreign copies: USA only hides the title');
    assert.equal(data.foldMovies([en, fr])[0].url, 'https://x/fr.mp4', 'without categories: newest first');
    // An older upload's id still finds the movie it was folded into.
    const aliased = B.buildIndex('movies', group, catsWithDe, null);
    assert.equal(aliased.byId['m:2'], 0); assert.equal(aliased.byId['m:3'], 0);
    const check = B.categoryCheck(catsWithDe);
    assert.deepEqual([check(en), check(fr), check(movie('x', { categoryIds: [] })), check(movie('x', { categoryIds: ['fr', 'en'] })), check(movie('x', { categoryIds: ['gone'] })), check(movie('x', { categoryIds: ['fr', 'gone'] }))],
        [true, false, true, true, true, false], 'ids missing from the categories are left out');
});

test('without TMDB genres, only known genre words become Genre choices', () => {
    const items = [movie('A', { genre: 'N/A' }), movie('B', { genre: 'Unknown' }), movie('C', { genre: 'Sci-Fi, Action' }), movie('D', { genre: 'Drama / Fantasy' }), movie('E', { genre: 'Sport, Biography' })];
    const open = B.buildIndex('movies', items, cats, null);
    assert.deepEqual(plain(open.genres.map(g => g.name)), ['Action', 'Biography', 'Drama', 'Fantasy', 'Science Fiction', 'Sports']);
    assert.deepEqual(picked(open, 'az', { genre: 'science fiction' }), ['C']);
    assert.equal(open.titles[0].g, '', 'N/A is no genre');
});

test('rows client: a timed-out request and a full storage keep the app working', () => {
    let now = 1000 * HOUR;
    const requests = [];
    class Xhr { open(method, url) { this.url = url; } send() { requests.push(this); } }
    const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
    const received = [];
    const c = B.createRowsClient({ storage: full, XMLHttpRequest: Xhr, now: () => now });
    assert.equal(c.refresh(rows => received.push(rows)), true);
    requests.shift().ontimeout();
    assert.equal(received.length, 0); assert.equal(c.refresh(), false, 'a timeout waits five minutes like any failure');
    now += 5 * 60000;
    assert.equal(c.refresh(rows => received.push(rows)), true);
    const r = requests.shift(); r.status = 200; r.readyState = 4; r.responseText = JSON.stringify({ v: 1, source: 'tmdb', movie: { popular: [tmdb(1, 'Kept', 2020)] }, tv: {}, genres: {} }); r.onreadystatechange();
    assert.equal(received.length, 1, 'the rows are used although they could not be saved');
    assert.equal(c.peek().movie.popular[0].title, 'Kept'); assert.equal(c.freshness(), 'fresh', 'and kept for this session');
});

test('the library store: clearUpNext drops a finished series from Continue watching', () => {
    const storage = memoryStorage();
    const store = load({ localStorage: storage }).createStore(storage);
    store.saveSettings({ source: { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' } });
    store.saveRecent({ id: 'e:26', name: 'Finale', season: 2, episode: 6, seriesId: 's:7' }, 2900000, 3000000);
    store.saveRecent({ id: 'e:31', name: 'Other', season: 1, episode: 1, seriesId: 's:8' }, 2900000, 3000000);
    assert.deepEqual(plain(store.upNext().map(n => n.seriesId)), ['s:8', 's:7']);
    assert.equal(store.clearUpNext('s:7'), true);
    assert.deepEqual(plain(store.upNext().map(n => n.seriesId)), ['s:8']);
    assert.deepEqual(plain(load({ localStorage: storage }).createStore(storage).upNext().map(n => n.seriesId)), ['s:8'], 'saved');
});
