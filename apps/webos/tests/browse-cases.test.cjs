"use strict";
// Every case of docs/browse-cases.json (docs/browse.md, Test cases) against the shipped js/data.js, the file
// tools/sync-from-tizen.js generates and minifies from the Samsung sources: the category filter, normalized titles and
// their years, USA only and the provider TMDB id. Older LG browsers lack String.prototype.normalize, so the names also
// run without it, through data.js's own folding table.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceText = fs.readFileSync(path.join(__dirname, "../js/data.js"), "utf8");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/browse-cases.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
const SOURCE = {type: "xtream", server: "http://example.invalid", username: "u", password: "p"};
const RUNS = {category: runCategory, normalize: runNormalize, usa: runUsa, tmdb: runTmdb};

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

test("docs/browse-cases.json: every case passes in the shipped LG data.js, with and without String.prototype.normalize", () => {
    const counts = {};
    for (const c of cases) counts[c.kind] = (counts[c.kind] || 0) + 1;
    assert.deepEqual(Object.keys(counts).sort(), Object.keys(RUNS).sort(), "a kind of case this test does not run");
    assert.ok(counts.category >= 100 && counts.normalize >= 100 && counts.usa >= 40 && counts.tmdb >= 100, JSON.stringify(counts));
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
