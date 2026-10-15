"use strict";
// Storage and credential helpers of the shipped js/data.js, run in a plain sandbox.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceText = fs.readFileSync(path.join(__dirname, "../js/data.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const SETTINGS = "tuner.tv.settings.v1";
const LIBRARY = "tuner.tv.library.v1";

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value))};
}

function load(storage = memoryStorage()) {
    const window = {Promise, localStorage: storage, XMLHttpRequest: function () {}, setTimeout, clearTimeout};
    vm.runInNewContext(sourceText, {window, console});
    return {data: window.TunerData, storage};
}

const account = {type: "xtream", server: "example.invalid:8080/get.php?username=first%20user&password=p%26ss&type=m3u"};

test("get.php links are split into server, username and password", () => {
    const {data} = load();
    const normalized = plain(data.normalizeSource(account));
    assert.equal(normalized.type, "xtream");
    assert.equal(normalized.server, "http://example.invalid:8080");
    assert.equal(normalized.username, "first user");
    assert.equal(normalized.password, "p&ss");
    assert.equal(normalized.m3uUrl, "");
    // Explicitly entered credentials win over the ones embedded in the link.
    const explicit = data.normalizeSource({...account, username: "typed", password: "typed-pass"});
    assert.equal(explicit.username, "typed");
    assert.equal(explicit.password, "typed-pass");
});

test("incomplete accounts and non-HTTP URLs are rejected or dropped", () => {
    const {data} = load();
    assert.throws(() => data.normalizeSource({type: "m3u", m3uUrl: "javascript:alert(1)"}), /HTTP or HTTPS playlist/);
    assert.throws(() => data.normalizeSource({type: "xtream", server: "http://example.invalid", username: "a"}), /server, username and password/);
    assert.throws(() => data.normalizeSource({type: "ftp", m3uUrl: "http://example.invalid/list.m3u"}), /Xtream or M3U/);
    const normalized = data.normalizeSource({m3uUrl: "https://example.invalid/list.m3u", epgUrl: "file:///etc/passwd", hotUrl: "https://example.invalid/hot.json"});
    assert.equal(normalized.type, "m3u");
    assert.equal(normalized.epgUrl, "");
    assert.equal(normalized.hotUrl, "https://example.invalid/hot.json");
});

test("source keys and catalog identities separate accounts without exposing credentials", () => {
    const {data} = load();
    const first = data.normalizeSource(account);
    const second = data.normalizeSource({...account, server: account.server.replace("first%20user", "second")});
    assert.equal(data.sourceKey(account), data.sourceKey(first));
    assert.notEqual(data.sourceKey(first), data.sourceKey(second));
    assert.notEqual(data.catalogIdentity(first, {}), data.catalogIdentity(second, {}));
    for (const value of [data.sourceKey(first), data.catalogIdentity(first, {})]) {
        assert.doesNotMatch(value, /first|user|p&ss|example/);
    }
    assert.equal(data.sourceKey(null), "none");
});

test("stream URLs percent-encode entered credentials", () => {
    const {data} = load();
    const items = data.parseXtream([{stream_id: 7, name: "One", category_id: "us"}], "live",
        {type: "xtream", server: "http://example.invalid", username: "user / +", password: "p/?#&"}, "m3u8");
    assert.equal(items[0].url, "http://example.invalid/live/user%20%2F%20%2B/p%2F%3F%23%26/7.m3u8");
});

test("a new store starts with default settings and saves them under one key", () => {
    const {data, storage} = load();
    const store = data.createStore();
    assert.deepEqual(plain(store.settings), {source: null, zip: "01608"});
    assert.equal(store.saveSettings({source: data.normalizeSource(account), theme: "black"}), true);
    assert.equal(store.lastError, "");
    const saved = JSON.parse(storage.getItem(SETTINGS));
    assert.equal(saved.source.username, "first user");
    assert.equal(saved.theme, "black");
    assert.equal(load(storage).data.createStore().settings.theme, "black");
});

test("saveSettings ignores prototype keys", () => {
    const {data, storage} = load();
    const store = data.createStore();
    store.saveSettings(JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "prototype": "y", "zip": "10001"}'));
    const saved = JSON.parse(storage.getItem(SETTINGS));
    assert.deepEqual(Object.keys(saved).sort(), ["source", "zip"]);
    assert.equal(saved.zip, "10001");
    assert.equal(({}).polluted, undefined);
});

test("corrupt or non-object saved data falls back to defaults", () => {
    for (const bad of ["{not json", "[1,2]", "null", "42"]) {
        const {data} = load(memoryStorage({[SETTINGS]: bad, [LIBRARY]: bad}));
        const store = data.createStore();
        assert.deepEqual(plain(store.settings), {source: null, zip: "01608"});
        assert.deepEqual(plain(store.favourites()), []);
        assert.deepEqual(plain(store.recents()), []);
    }
});

test("a storage write failure is reported instead of thrown", () => {
    const {data} = load();
    const store = data.createStore({getItem: () => null, setItem() { throw new Error("QuotaExceededError"); }});
    assert.equal(store.saveSettings({zip: "10001"}), false);
    assert.match(store.lastError, /Unable to save/);
    assert.equal(store.toggleFavourite("live:1"), true);
});

test("favourites toggle per account and persist", () => {
    const {data, storage} = load();
    const store = data.createStore();
    store.saveSettings({source: data.normalizeSource(account)});
    assert.equal(store.toggleFavourite("live:1"), true);
    assert.equal(store.toggleFavourite("live:2"), true);
    assert.equal(store.isFavourite("live:1"), true);
    assert.equal(store.toggleFavourite("live:1"), false);
    assert.deepEqual(plain(store.favourites()), ["live:2"]);
    const reloaded = load(storage).data.createStore();
    assert.deepEqual(plain(reloaded.favourites()), ["live:2"]);
    // Another account sees its own, empty list.
    reloaded.saveSettings({source: data.normalizeSource({...account, server: "http://other.invalid", username: "b", password: "c"})});
    assert.deepEqual(plain(reloaded.favourites()), []);
});

test("resume points keep only meaningful, unfinished positions, newest first", () => {
    const {data} = load();
    const store = data.createStore();
    store.saveRecent({id: "m:1", name: "One"}, 20000, 100000);
    store.saveRecent({id: "m:2", name: "Too short"}, 15000, 100000);
    store.saveRecent({id: "m:3", name: "Finished"}, 96000, 100000);
    store.saveRecent({id: "m:4", name: "Live"}, 30000, 0);
    assert.deepEqual(plain(store.recents().map(item => item.id)), ["m:4", "m:1"]);
    const first = store.recents()[1];
    assert.equal(first.positionMs, 20000);
    assert.equal(first.durationMs, 100000);
    store.saveRecent({id: "m:1", name: "One"}, 5000, 100000);
    assert.deepEqual(plain(store.recents().map(item => item.id)), ["m:4"]);
    store.clearRecent("m:4");
    assert.deepEqual(plain(store.recents()), []);
    for (let i = 0; i < 45; i++) store.saveRecent({id: "m:" + i}, 20000, 0);
    assert.equal(store.recents().length, 40);
});

test("watch history ranks channels and remembers the last one", () => {
    const {data} = load();
    const store = data.createStore();
    store.recordWatched("live:2");
    store.recordWatched("live:3");
    store.recordWatched("live:2");
    assert.deepEqual(plain(store.mostWatched()), ["live:2", "live:3"]);
    assert.equal(store.lastWatched(), "live:2");
});
