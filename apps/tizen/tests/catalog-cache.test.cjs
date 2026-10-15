'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const provider = { id: 'cache-fixture', type: 'xtream', server: 'https://example.invalid', username: 'fixture-user', password: 'fixture-password' };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function storage() { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)) }; }

/** Async transactions share persistent records across fresh JS realms, including abort/quota paths. */
function indexedDB(options = {}) {
    const records = new Map(), held = []; let created = false;
    function transaction(mode) {
        const tx = {}, queue = []; let pending = 0, revision = 0, failed = false;
        function task(action, hold) {
            pending++; revision++;
            function run() {
                if (!failed) action();
                pending--; const current = revision;
                queueMicrotask(() => { if (!failed && !pending && current === revision && tx.oncomplete) tx.oncomplete(); });
            }
            if (hold) held.push(run); else queueMicrotask(run);
        }
        const store = {
            get(key) {
                const request = {};
                task(() => {
                    if (options.failReads) { failed = true; if (tx.onerror) tx.onerror(); return; }
                    request.result = clone(records.get(key)); if (request.onsuccess) request.onsuccess();
                }, options.holdReads);
                return request;
            },
            put(record) {
                task(() => {
                    if (options.failWrites) { failed = true; if (tx.onerror) tx.onerror(); return; }
                    records.set(record.id, clone(record));
                });
            },
            count() { const request = {}; task(() => { request.result = records.size; if (request.onsuccess) request.onsuccess(); }); return request; },
            delete(key) { task(() => records.delete(key)); },
            index() { return { openKeyCursor() {
                const request = {}; let at = 0;
                const keys = [...records.values()].sort((a, b) => a.updated - b.updated).map(record => record.id);
                function next() { task(() => { const key = keys[at++]; request.result = key === undefined ? null : { primaryKey: key, continue: next }; if (request.onsuccess) request.onsuccess(); }); }
                next(); return request;
            } }; }
        };
        tx.objectStore = () => store;
        return tx;
    }
    const database = { close() {}, createObjectStore() { return { createIndex() {} }; }, transaction(name, mode) { return transaction(mode); } };
    return {
        records, held, options,
        open() {
            const request = {};
            queueMicrotask(() => {
                if (options.failOpen) { if (request.onerror) request.onerror(); return; }
                request.result = database;
                if (!created) { created = true; if (request.onupgradeneeded) request.onupgradeneeded(); }
                if (request.onsuccess) request.onsuccess();
            });
            return request;
        },
        releaseReads() { options.holdReads = false; while (held.length) held.shift()(); }
    };
}

function fixture(saved = storage(), database) {
    const requests = [];
    class Xhr {
        open(method, url) { this.url = url; }
        send() { requests.push(this); }
        abort() { this.aborted = true; if (this.onabort) this.onabort(); }
    }
    const window = { Promise, XMLHttpRequest: Xhr, localStorage: saved, setTimeout, clearTimeout, atob: value => Buffer.from(value, 'base64').toString('binary') };
    if (database) window.indexedDB = database;
    vm.runInNewContext(sourceText, { window });
    function respond(request, value, status = 200) {
        assert.ok(request, 'A required synthetic request was not started'); request.completed = true; request.status = status;
        request.responseText = typeof value === 'string' ? value : JSON.stringify(value);
        if (request.responseType === 'arraybuffer') { const bytes = Buffer.from(request.responseText); request.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
        request.readyState = 4; request.onreadystatechange();
    }
    function find(action) { return requests.find(request => !request.completed && request.url.includes('action=' + action)); }
    function finishCatalog() {
        respond(find('get_live_categories'), [{ category_id: 'us', category_name: 'USA News' }]);
        respond(find('get_live_streams'), [{ stream_id: 1, name: 'CNN', category_id: 'us' }, { stream_id: 2, name: 'CNN Backup', category_id: 'us' }]);
        respond(find('get_vod_categories'), [{ category_id: 'movie', category_name: 'Movies' }]);
        respond(find('get_vod_streams'), [{ stream_id: 7, name: 'Synthetic movie', category_id: 'movie', container_extension: 'mp4' }]);
        respond(find('get_series_categories'), [{ category_id: 'series', category_name: 'Series' }]);
        respond(find('get_series'), [{ series_id: 8, name: 'Synthetic series', category_id: 'series' }]);
    }
    function client(source = provider, extra = {}) {
        const published = [], states = [];
        const value = window.TunerData.createClient(source, { zip: '', ...extra,
            onCatalog(kind, items, categories) { published.push({ kind, items, categories }); },
            onStatus(kind, state) { states.push({ kind, ...state }); }
        });
        return { value, published, states };
    }
    return { data: window.TunerData, requests, saved, respond, find, finishCatalog, client, window };
}

async function seed(saved, database) {
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load();
    await flush(); h.finishCatalog(); await loaded;
    return h;
}

function canonicalIdentity(data, input, options = {}) {
    const normalized = data.normalizeSource(input), ordered = {};
    Object.keys(normalized).sort().forEach(key => { if (!['__proto__', 'constructor', 'prototype'].includes(key)) ordered[key] = normalized[key]; });
    return JSON.stringify({ schema: 1, source: ordered, zip: options.zip === undefined ? '01608' : String(options.zip == null ? '' : options.zip).trim(), liveFormat: options.liveFormat || normalized.liveFormat || 'm3u8' });
}

test('catalog identities match a SHA-256 crypto oracle across UTF-8 and message block boundaries', () => {
    const h = fixture();
    for (const size of [0, 1, 55, 56, 63, 64, 65, 128, 1024]) {
        for (const password of ['fixture-password', 'café/漢字/😀/\ud800']) {
            const input = { ...provider, password, padding: 'x'.repeat(size) };
            const canonical = canonicalIdentity(h.data, input, { zip: '' });
            const expected = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
            const actual = h.data.catalogIdentity(input, { zip: '' });
            assert.equal(actual, expected); assert.match(actual, /^[a-f0-9]{64}$/);
        }
    }
});

test('identity digests isolate credential and policy edits while equivalent normalization stays stable', () => {
    const h = fixture();
    const base = h.data.catalogIdentity(provider, { zip: '' });
    const identities = [base,
        h.data.catalogIdentity({ ...provider, username: 'other-user' }, { zip: '' }),
        h.data.catalogIdentity({ ...provider, password: 'other-password' }, { zip: '' }),
        h.data.catalogIdentity({ ...provider, server: 'https://other.invalid' }, { zip: '' }),
        h.data.catalogIdentity(provider, { zip: '01608' }),
        h.data.catalogIdentity(provider, { zip: '', liveFormat: 'ts' })
    ];
    assert.equal(new Set(identities).size, identities.length);
    assert.equal(base, h.data.catalogIdentity({ ...provider, server: provider.server + '/' }, { zip: '' }));
    for (const identity of identities) {
        assert.match(identity, /^[a-f0-9]{64}$/);
        assert.ok(!identity.includes(provider.username) && !identity.includes(provider.password) && !identity.includes('example.invalid'));
    }
});

test('persisted cache identities contain only digests and legacy raw identities are rejected', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    for (const record of database.records.values()) {
        assert.match(record.identity, /^[a-f0-9]{64}$/);
        assert.equal(record.username, undefined); assert.equal(record.password, undefined); assert.equal(record.server, undefined);
    }
    const legacy = canonicalIdentity(fixture().data, provider, { zip: '' });
    for (const record of database.records.values()) if (record.kind === 'live') record.identity = legacy;
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
    assert.deepEqual(client.published.map(value => value.kind), ['movies', 'series']);
    assert.equal(h.requests.length, 2); client.value.cancel(); await loaded;
    const fallback = storage(); await seed(fallback, indexedDB({ failWrites: true }));
    assert.match(JSON.parse(fallback.getItem('tuner.tv.catalog.live.v1')).identity, /^[a-f0-9]{64}$/);
});

test('cold JS restart restores all finished IndexedDB catalogs without any provider requests', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    assert.equal(database.records.size, 3);
    const h = fixture(saved, database), client = h.client(); await client.value.load();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(client.published.map(catalog => catalog.kind), ['live', 'movies', 'series']);
    assert.equal(client.published[0].items.length, 1); assert.equal(client.published[0].items[0].backups.length, 1);
    assert.ok(client.states.filter(state => state.state === 'ready').length === 3);
});

test('fresh live snapshot bypasses requests while a missing Movies section loads independently', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    for (const [key, record] of database.records) if (record.kind === 'movies') database.records.delete(key);
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
    assert.deepEqual(client.published.map(value => value.kind), ['live', 'series']);
    assert.equal(h.requests.length, 2); assert.ok(h.requests.every(request => /get_vod/.test(request.url)));
    h.respond(h.find('get_vod_categories'), []); h.respond(h.find('get_vod_streams'), []); await loaded;
    assert.equal(client.published.find(value => value.kind === 'movies').items.length, 0);
});

test('stale live rows appear before refresh and stay visible when the provider is offline', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    for (const record of database.records.values()) if (record.kind === 'live') record.updated -= 3 * 3600000;
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
    assert.equal(client.published[0].kind, 'live'); assert.equal(client.published[0].items[0].name, 'CNN');
    assert.equal(h.requests.length, 2, 'fresh movies and series must not refresh with the live list');
    h.respond(h.find('get_live_categories'), [], 503); h.respond(h.find('get_live_streams'), []); await loaded;
    assert.equal(client.published.filter(value => value.kind === 'live').length, 1);
    assert.equal(client.states.filter(state => state.kind === 'live').at(-1).state, 'ready');
    assert.ok(client.states.every(state => !state.message.includes(provider.password)));
});

test('forced refresh keeps cached rows while fetching every library and replaces them only on success', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(true); await flush();
    assert.equal(client.published.length, 3); assert.equal(h.requests.length, 6);
    h.finishCatalog(); await loaded; assert.equal(client.published.length, 6);
});

test('editing credentials, server, ZIP, format or playlist prevents another source snapshot from appearing', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database);
    const variants = [
        [{ ...provider, password: 'changed-fixture-password' }, {}], [{ ...provider, server: 'https://other.invalid' }, {}],
        [provider, { zip: '01608' }], [provider, { liveFormat: 'ts' }],
        [{ id: provider.id, type: 'm3u', m3uUrl: 'https://example.invalid/list.m3u' }, {}]
    ];
    for (const [source, options] of variants) {
        const h = fixture(saved, database), client = h.client(source, options), loaded = client.value.load(); await flush();
        assert.equal(client.published.length, 0);
        assert.equal(h.requests.length, source.type === 'm3u' ? 1 : 6);
        client.value.cancel(); await loaded;
    }
});

test('schema corruption and duplicate IDs reject only the damaged snapshot section', async () => {
    for (const corruption of ['schema', 'duplicates', 'identity']) {
        const saved = storage(), database = indexedDB(); await seed(saved, database);
        for (const record of database.records.values()) if (record.kind === 'live') {
            if (corruption === 'schema') record.schema = 0;
            if (corruption === 'duplicates') record.payload.items.push(clone(record.payload.items[0]));
            if (corruption === 'identity') record.identity = 'different-account';
        }
        const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
        assert.deepEqual(client.published.map(value => value.kind), ['movies', 'series']);
        assert.equal(h.requests.length, 2); client.value.cancel(); await loaded;
    }
});

test('cancelling a client during IndexedDB read cannot publish stale rows or start provider requests', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database); database.options.holdReads = true;
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
    assert.equal(database.held.length, 3);
    client.value.cancel(); database.releaseReads(); await loaded;
    assert.equal(client.published.length, 0); assert.equal(h.requests.length, 0);
});

test('the first finished live section is visible while movie and series disk reads remain pending', async () => {
    const saved = storage(), database = indexedDB(); await seed(saved, database); database.options.holdReads = true;
    const h = fixture(saved, database), client = h.client(), loaded = client.value.load(); await flush();
    assert.equal(database.held.length, 3);
    database.held.shift()(); await flush();
    assert.deepEqual(client.published.map(value => value.kind), ['live']);
    assert.equal(database.held.length, 2); assert.equal(h.requests.length, 0);
    database.releaseReads(); await loaded;
    assert.deepEqual(client.published.map(value => value.kind), ['live', 'movies', 'series']);
});

test('cached live aliases restore favorites and watch history after a new JS realm', async () => {
    const saved = storage(), database = indexedDB(), original = fixture(saved, database), store = original.data.createStore();
    store.saveSettings({ source: provider }); store.toggleFavourite('x:2'); store.recordWatched('x:2');
    const client = original.client(), loaded = client.value.load(); await flush(); original.finishCatalog(); await loaded;
    const h = fixture(saved, database), reloaded = h.data.createStore(), cached = h.client(); await cached.value.load();
    assert.deepEqual(clone(reloaded.favourites()), ['x:1']); assert.equal(reloaded.isFavourite('x:1'), true);
    assert.deepEqual(clone(reloaded.mostWatched()), ['x:1']); assert.equal(reloaded.lastWatched(), 'x:1');
    assert.equal(h.requests.length, 0);
});

test('IDB quota failure falls back to a bounded private live cache and leaves settings untouched', async () => {
    const saved = storage(), database = indexedDB({ failWrites: true }); saved.setItem('tuner.tv.settings.v1', JSON.stringify({ source: provider, theme: 'black' }));
    const settingsBefore = saved.getItem('tuner.tv.settings.v1'); await seed(saved, database);
    assert.equal(saved.getItem('tuner.tv.settings.v1'), settingsBefore);
    assert.ok(saved.getItem('tuner.tv.catalog.live.v1'));
    const h = fixture(saved), client = h.client(), loaded = client.value.load();
    assert.equal(client.published[0].kind, 'live'); assert.equal(h.requests.length, 4);
    client.value.cancel(); await loaded;
});

test('unavailable IndexedDB and local quota still publish provider catalogs without an error', async () => {
    const saved = { getItem() { throw Error('storage denied'); }, setItem() { throw Error('quota'); } };
    const h = fixture(saved, indexedDB({ failOpen: true })), client = h.client(), loaded = client.value.load(); await flush(); h.finishCatalog(); await loaded;
    assert.equal(client.published.length, 3); assert.ok(client.states.every(state => state.state !== 'error'));
});

test('explicit refresh can recover from a transient IndexedDB open failure without reloading the app', async () => {
    const saved = storage(), database = indexedDB({ failOpen: true });
    const h = await seed(saved, database); assert.equal(database.records.size, 0);
    database.options.failOpen = false;
    const client = h.client(), loaded = client.value.load(true); await flush(); h.finishCatalog(); await loaded;
    assert.equal(database.records.size, 3, 'a failed database attempt must not be cached permanently');
});

test('M3U cached catalogs retain embedded series episodes and the XMLTV URL across restart', async () => {
    const saved = storage(), database = indexedDB(), source = { type: 'm3u', m3uUrl: 'https://example.invalid/list.m3u' };
    const h = fixture(saved, database), client = h.client(source), loaded = client.value.load(); await flush();
    h.respond(h.requests[0], '#EXTM3U x-tvg-url="https://example.invalid/guide.xml"\n#EXTINF:-1 tvg-country="US" tvg-id="cnn.us" group-title="USA News",CNN\nhttps://example.invalid/live.m3u8\n#EXTINF:-1 group-title="Drama",Example S01E01\nhttps://example.invalid/series.mp4'); await loaded;
    const fresh = fixture(saved, database), cached = fresh.client(source); await cached.value.load();
    assert.equal(fresh.requests.length, 0);
    const series = cached.published.find(value => value.kind === 'series').items[0];
    const info = await cached.value.seriesInfo(series); assert.equal(info.seasons[0].episodes.length, 1);
    const guide = cached.value.guide(cached.published[0].items[0]); assert.equal(fresh.requests[0].url, 'https://example.invalid/guide.xml');
    fresh.respond(fresh.requests[0], '<tv/>'); await guide;
});

test('persistent catalog storage retains a bounded number of private source sections', async () => {
    const saved = storage(), database = indexedDB();
    for (let account = 0; account < 4; account++) {
        const h = fixture(saved, database), client = h.client({ ...provider, id: 'bounded-' + account }), loaded = client.value.load(); await flush(); h.finishCatalog(); await loaded;
    }
    assert.ok(database.records.size <= 9);
});
