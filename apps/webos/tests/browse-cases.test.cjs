"use strict";
// Every case of docs/browse-cases.json (docs/browse.md, Test cases) against the shipped js/data.js, the file
// tools/sync-from-tizen.js generates and minifies from the Samsung sources: the category filter, normalized titles and
// their years, USA only, the provider TMDB id and M3U playlists. Older LG browsers lack String.prototype.normalize, so
// the names also run without it, through data.js's own folding table.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceText = fs.readFileSync(path.join(__dirname, "../js/data.js"), "utf8");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/browse-cases.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
const SOURCE = {type: "xtream", server: "http://example.invalid", username: "u", password: "p"};
const RUNS = {category: runCategory, normalize: runNormalize, usa: runUsa, tmdb: runTmdb, m3u: runM3u};

function memoryStorage() {
    const values = new Map();
    return {values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value))};
}
function context(withNormalize = true) {
    const sandbox = vm.createContext({window: {Promise, XMLHttpRequest: function () {}, localStorage: memoryStorage(), setTimeout, clearTimeout}, console});
    if (!withNormalize) {
        vm.runInContext("delete String.prototype.normalize", sandbox);
        assert.equal(vm.runInContext("typeof ''.normalize", sandbox), "undefined");
    }
    vm.runInContext(sourceText, sandbox);
    return sandbox;
}
const contexts = {"V8": context(), "without String.prototype.normalize": context(false)};

function runCategory(D, c) {
    assert.equal(D.browse.isForeignCategory(c.name), c.foreign, c.name);
}
// The name itself, and the name read from a provider row (parseXtream trims it as a provider field).
function runNormalize(D, c) {
    const year = D.browse.titleYear({name: c.input});
    assert.deepEqual([D.browse.normalizeTitle(c.input), year ? String(year) : ""], [c.title, c.year], JSON.stringify(c.input));
    if (!D.text(c.input)) return;
    const item = D.parseXtream([{stream_id: 1, name: c.input}], "movies", SOURCE)[0], itemYear = D.browse.titleYear(item);
    assert.deepEqual([D.browse.normalizeTitle(item.name), itemYear ? String(itemYear) : ""], [c.title, c.year], "provider row " + JSON.stringify(c.input));
}
// category: a name or an array of names ("" or []: none); origin: the matched TMDB title's, null when unmatched.
function runUsa(D, c) {
    const B = D.browse, label = JSON.stringify(c);
    const categories = [].concat(c.category).filter(Boolean).map((name, i) => ({id: "c" + i, name}));
    const item = {id: "m:1", name: "Shared case", categoryIds: categories.map(cat => cat.id), year: "", rating: "", added: 0, tmdb: c.origin ? "1" : "", genre: "", url: "https://fixture.invalid/m.mp4", backups: []};
    const rows = c.origin ? B.parseRows({v: 1, source: "tmdb", generated: "2026-10-19T00:00:00Z", movie: {popular: [{id: "1", title: "Shared case", original_title: "Shared case", year: "2020", origin: c.origin, lang: "en", genres: [], popularity: 1}]}, tv: {}, genres: {movie: [], tv: []}}) : null;
    const index = B.buildIndex("movies", [item], categories, rows);
    assert.equal(index.titles[0].tmdb, c.origin ? "1" : "", label);
    assert.equal(index.titles[0].us, c.expect, label);
    const passes = B.categoryCheck(categories)(item);
    assert.equal(c.origin ? B.usaAllowed(passes, c.origin) : passes, c.expect, label);
}
// The catalogue's own path: JSON.parse of the provider's reply, then parseXtream. A row without a stream_id (series_id
// for a series row) or a name gets one; the cases never test those keys.
function runTmdb(D, c, sandbox) {
    const row = vm.runInContext("JSON.parse", sandbox)(c.json), kind = "series_id" in row ? "series" : "movies", key = kind === "series" ? "series_id" : "stream_id";
    if (!(key in row)) row[key] = 1;
    if (!("name" in row)) row.name = "Title";
    const items = D.parseXtream([row], kind, SOURCE);
    assert.equal(items.length, 1, c.json);
    assert.equal(items[0].tmdb || null, c.expect, c.json);
}
// docs/browse.md, M3U playlists: the playlist through parseM3u, the app's own reader; its live channels in order as
// {name, group}, the group being the channel's category name with "Uncategorized" (no group) read as "".
function runM3u(D, c) {
    const parsed = D.parseM3u(c.text, {type: "m3u", m3uUrl: "http://m3u.invalid/list.m3u"}), groups = new Map(parsed.liveCategories.map(cat => [cat.id, cat.name]));
    assert.equal(parsed.movies.length + parsed.series.length, 0, JSON.stringify(c.text));
    const channels = parsed.live.map(item => ({name: item.name, group: groups.get(item.categoryId) === "Uncategorized" ? "" : groups.get(item.categoryId)}));
    assert.deepEqual(plain(channels), c.expect, JSON.stringify(c.text));
}

test("docs/browse-cases.json: every case passes in the shipped LG data.js, with and without String.prototype.normalize", () => {
    const counts = {};
    for (const c of cases) counts[c.kind] = (counts[c.kind] || 0) + 1;
    assert.deepEqual(Object.keys(counts).sort(), Object.keys(RUNS).sort(), "a kind of case this test does not run");
    assert.ok(counts.category >= 100 && counts.normalize >= 100 && counts.usa >= 40 && counts.tmdb >= 100 && counts.m3u >= 30, JSON.stringify(counts));
    for (const [label, sandbox] of Object.entries(contexts)) {
        const D = sandbox.window.TunerData;
        let ran = 0;
        for (const c of cases) {
            try { RUNS[c.kind](D, c, sandbox); } catch (error) { error.message = label + ": " + error.message; throw error; }
            ran++;
        }
        assert.equal(ran, cases.length, label);
    }
});

test("names with 40 tags or 16,000 spaces inside normalize and give their year in well under 50 ms", () => {
    // docs/browse.md, Test cases and Trimming: a TAG that matches a tag in two ways, or a trim written as a pattern,
    // makes these take seconds; the vm timeout turns such a regression into a failure, not a hang.
    const names = {"40 tags": "Movie - 1999" + " - 4K".repeat(40) + " - Extended", "16,000 spaces": "A" + " ".repeat(16000) + "B"};
    const expected = {"40 tags": ["movie 1999 extended", 0, "movie 1999 extended", "movie 1999 extended"], "16,000 spaces": ["a b", 0, "a b", "a b"]};
    for (const [label, sandbox] of Object.entries(contexts)) {
        for (const [kind, name] of Object.entries(names)) {
            sandbox.name = name;
            const start = process.hrtime.bigint();
            const result = vm.runInContext("var d = window.TunerData, b = d.browse, item = d.parseXtream([{ stream_id: 1, name: '\\u00a0 ' + name + '\\t\\u3000' }], 'movies', " +
                "{ type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' })[0]; [b.normalizeTitle(name), b.titleYear({ name: name }), b.normalizeTitle(name, true), b.normalizeTitle(item.name)]",
            sandbox, {timeout: 5000});
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            assert.deepEqual(plain(result), expected[kind], label + ", " + kind);
            assert.ok(ms < 50, label + ", " + kind + ": " + ms.toFixed(2) + " ms");
        }
    }
});

test("an #EXTINF line of 200,000 characters is read in one pass, in well under 100 ms", () => {
    // docs/browse.md, M3U playlists: a reader that starts a key again at every character of a long run of key
    // characters, or a pattern over the whole line, takes time that grows with the square of the line (seconds here).
    const lines = {
        "a run of key characters before an unpaired quote": "#EXTINF:-1 " + "a".repeat(200000) + "=\"x,Heat",
        "values with commas and both quotes, and stray quotes": "#EXTINF:-1 " + "a=\"x,y\" b='c\"d' \"e ".repeat(10000) + "k=\"unclosed ,Heat"
    };
    for (const [label, sandbox] of Object.entries(contexts)) {
        for (const [kind, line] of Object.entries(lines)) {
            sandbox.playlist = "#EXTM3U\r" + line + "\rhttp://m3u.invalid/live/1.ts";
            const start = process.hrtime.bigint();
            const names = vm.runInContext("window.TunerData.parseM3u(playlist, {}).live.map(function (item) { return item.name; })", sandbox, {timeout: 5000});
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            assert.deepEqual(plain(names), ["Heat"], label + ", " + kind);
            assert.ok(ms < 100, label + ", " + kind + ": " + ms.toFixed(2) + " ms");
        }
    }
});

test("names with long runs of spaces: M3U episodes, live channel names and category genres, in well under 50 ms each", () => {
    // Patterns that tried \s+ or \s* again from every space of a run, to the end of the run, took time that grew with the
    // square of the run (seconds here): the show name of "Show S01E02", displayName's tags (also on the runs its own
    // replacements make of tags in a row), the USA-only name labels and the split of a category name at " - ".
    const setup = "var d = window.TunerData, run = new Array(16001).join(' '), cats = [{ id: 'us', name: 'USA | Entertainment' }], id = function (item) { return item.id; }," +
        " ch = function (id, name) { return { id: id, name: name, url: 'http://example.invalid/' + id + '.m3u8', backups: [], image: '', epgId: '', categoryId: 'us', categoryIds: ['us'], number: 0, country: '' }; }," +
        " short = function (name) { return name.split(run).join('<run>'); }, movie = function (id, cat) { return { id: id, name: 'Heat', categoryIds: [cat], year: '', rating: '', added: 0, tmdb: '', genre: '', url: 'https://fixture.invalid/m.mp4', backups: [] }; };";
    const cases = [
        ["an M3U playlist", "var r = d.parseM3u(['#EXTM3U', '#EXTINF:-1 group-title=\"Shows\",The' + run + 'Show S01E02 Pilot', 'http://m3u.invalid/series/1.mp4', '#EXTINF:-1 group-title=\"Films\",A' + run + 'B'," +
            " 'http://m3u.invalid/movie/2.mp4', '#EXTINF:-1 group-title=\"News\",News' + run + '24', 'http://m3u.invalid/live/3.ts'].join('\\n'), {});" +
            " [r.series.map(function (s) { return [short(s.name), s._episodes.map(function (e) { return [e.season, e.episode]; })]; }), r.movies.map(function (m) { return short(m.name); }), r.live.map(function (m) { return short(m.name); })]",
        [[["The<run>Show", [[1, 2]]]], ["A<run>B"], ["News<run>24"]]],
        ["display names", "[d.displayName('A' + run + 'B'), d.displayName('ESPN' + run + 'B USA'), d.displayName('A' + new Array(8001).join(' HD') + ' B'), d.displayName('A' + new Array(16001).join(' backup') + ' B')," +
            " d.displayName('A ' + new Array(16001).join('(A)') + ' B USA'), d.displayName('A' + new Array(8001).join(' -') + ' B').length]", ["A B", "ESPN B", "A B", "A B", "A (A) B", 16003]],
        ["USA only", "d.usPolicy([ch('a', 'A' + run + 'B'), ch('fr', 'FR' + run + '| Canal')], cats).items.map(id)", ["a"]],
        ["copies folded", "d.foldLive({ items: [ch('a', 'A' + run + 'B'), ch('b', 'A' + run + 'B HD')], categories: cats }).items.map(function (item) { return [item.id, item.name, item.backups.length]; })", [["a", "A B", 1]]],
        ["category genres", "var index = d.browse.buildIndex('movies', [movie('m:1', 'c1'), movie('m:2', 'c2')], [{ id: 'c1', name: 'Action' + run + '& Comedy' }, { id: 'c2', name: 'Drama' + run + '- Kids' }], null);" +
            " [index.titles.map(function (t) { return t.g; }), index.genres.map(function (g) { return g.name; })]", [["|action|comedy|", "|drama|kids|"], ["Action", "Comedy", "Drama", "Kids"]]]
    ];
    for (const [label, sandbox] of Object.entries(contexts)) {
        vm.runInContext(setup, sandbox);
        for (const [kind, code, expected] of cases) {
            const start = process.hrtime.bigint();
            const result = vm.runInContext(code, sandbox, {timeout: 5000});
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            assert.deepEqual(plain(result), expected, label + ", " + kind);
            assert.ok(ms < 50, label + ", " + kind + ": " + ms.toFixed(2) + " ms");
        }
    }
});
