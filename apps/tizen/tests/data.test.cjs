'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const source = { id: 'test-account', type: 'xtream', server: 'http://example.invalid', username: 'sample-user', password: 'sample-pass' };
const plain = value => JSON.parse(JSON.stringify(value));
function memoryStorage() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), values }; }
function fixture(options = {}) {
    const requests = [];
    class Xhr {
        open(method, url) { if (options.openError) throw new Error('Sensitive URL: ' + url); this.url = url; this.method = method; }
        send() { requests.push(this); }
        abort() { this.aborted = true; if (this.onabort) this.onabort(); }
    }
    const storage = memoryStorage();
    const timers = [];
    const window = { Promise, XMLHttpRequest: Xhr, localStorage: storage, atob: value => Buffer.from(value, 'base64').toString('binary'), setTimeout: options.manualTimers ? fn => timers.push(fn) : setTimeout };
    if (options.gzip) Object.assign(window, { DecompressionStream, Blob, Response });
    vm.runInNewContext(sourceText, { window, console });
    function find(action) { return requests.find(request => !request.completed && (action ? request.url.includes('action=' + action) : !request.url.includes('action='))); }
    function respond(request, value, status = 200) { assert.ok(request, 'Expected an outstanding request'); request.completed = true; request.status = status; request.responseText = typeof value === 'string' ? value : JSON.stringify(value); if (request.responseType === 'arraybuffer') { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(request.responseText); request.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } request.readyState = 4; request.onreadystatechange(); }
    return { data: window.TunerData, storage, requests, find, respond, timers };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function channel(id, name, ids = ['us'], extra = {}) { return Object.assign({ id, name, url: 'http://example.invalid/' + id + '.m3u8', backups: [], image: '', epgId: '', categoryId: ids[0], categoryIds: ids, number: 0, country: '' }, extra); }
const categories = [{ id: 'us', name: 'USA | Entertainment' }, { id: 'gb', name: 'UK | Entertainment' }, { id: 'genre', name: 'Action' }];

test('Xtream merges repeated IDs, multiple category memberships and conflicting country metadata', () => {
    const { data } = fixture();
    const parsed = data.parseXtream([
        { stream_id: 1, name: 'CNN', category_id: 'us', category_ids: ['us', 'genre'], country: 'US', num: 101 },
        { stream_id: 1, name: 'CNN', category_id: 'gb', country: ['GB'], num: 101 },
        { stream_id: 2, name: 'NBC', category_id: 'us', country_code: 'USA', num: 102 }
    ], 'live', source, 'm3u8');
    assert.equal(parsed.length, 2);
    assert.deepEqual(plain(parsed[0].categoryIds), ['us', 'genre', 'gb']);
    assert.equal(parsed[0].country, 'US;GB');
    assert.deepEqual(plain(data.usPolicy(parsed, categories).items.map(item => item.name)), ['NBC']);
});
test('URLs encode entered credentials and preserve direct sources and chosen live formats', () => {
    const { data } = fixture();
    const account = { ...source, username: 'user / +', password: 'p/?#&' };
    const items = data.parseXtream([{ stream_id: 7, name: 'One', category_id: 'us' }, { stream_id: 8, direct_source: 'https://cdn.invalid/live/8.ts?token=fake', name: 'Two', category_id: 'us' }], 'live', account, 'm3u8');
    assert.equal(items[0].url, 'http://example.invalid/live/user%20%2F%20%2B/p%2F%3F%23%26/7.m3u8');
    assert.equal(items[1].url, 'https://cdn.invalid/live/8.m3u8?token=fake');
});
test('source identity distinguishes accounts and hides credentials, including get.php links', () => {
    const { data } = fixture();
    const a = { type: 'xtream', server: 'https://example.invalid/get.php?username=first&password=not-a-real-secret' };
    const b = { ...a, server: 'https://example.invalid/get.php?username=second&password=not-a-real-secret' };
    assert.notEqual(data.sourceKey(a), data.sourceKey(b));
    assert.equal(data.sourceKey(a), data.sourceKey(data.normalizeSource(a)));
    assert.doesNotMatch(data.sourceKey(a), /first|secret|example/);
});
test('provider IDs cannot overwrite object prototypes', () => {
    const { data } = fixture();
    const cats = data.parseCategories([{ category_id: '__proto__', category_name: 'USA News' }, { category_id: 'constructor', category_name: 'USA Sports' }]);
    const items = data.parseXtream([{ stream_id: '__proto__', category_id: '__proto__', name: 'News' }, { stream_id: 'constructor', category_id: 'constructor', name: 'Sports' }], 'live', source, 'm3u8');
    assert.equal(data.usPolicy(items, cats).items.length, 2);
});
test('live country evidence is mandatory, explicit foreign regions override safe categories', () => {
    const { data } = fixture();
    const accepted = data.usPolicy([
        channel('unknown', 'The Last of Us: Part One', ['genre']), channel('en', '[English] BBC', ['genre']),
        channel('us', '(PLUTO United States) Frasier', ['genre']), channel('epg', 'FOX', ['genre'], { epgId: 'FOX.us' }),
        channel('uk', '(PLUTO United Kingdom) BBC'), channel('mixed', '[US / South Korea] Channel'),
        channel('metadata', 'CNN', ['us'], { country: 'US;GB' }), channel('tuvalu', '[US] [Tuvalu] Channel')
    ], categories);
    assert.deepEqual(plain(accepted.items.map(item => item.id)), ['us', 'epg']);
});
test('language restrictions are absent and unmarked title text does not infer a region', () => {
    const { data } = fixture();
    const result = data.usPolicy([channel('es', 'Telemundo', ['us'], { country: 'US', language: 'es' }), channel('french', '[US / French] News'), channel('ordinary', 'Made in USA: Film', ['genre'])], categories);
    assert.deepEqual(plain(result.items.map(item => item.id)), ['es', 'french']);
    const movies = data.parseXtream([{ stream_id: 1, name: 'Unknown language', language: 'und', country: 'GB' }, { stream_id: 2, name: 'French film', language: 'fr', country: 'FR' }], 'movies', source);
    assert.equal(data.foldMovies(movies).length, 2);
});
test('ordinary prepositions in categories are not foreign countries and safe memberships survive', () => {
    const { data } = fixture();
    const cats = [{ id: 'us', name: 'US Sports in English' }, { id: 'uk', name: 'uk | Entertainment' }, { id: 'genre', name: 'Action' }];
    const result = data.usPolicy([channel('cnn', 'CNN', ['uk', 'us', 'genre'])], cats);
    assert.deepEqual(plain(result.items[0].categoryIds), ['us', 'genre']);
    assert.deepEqual(plain(result.categories.map(cat => cat.id)), ['us', 'genre']);
});
test('M3U quoted commas, EXTGRP, countries, query VOD URLs and stable IDs are parsed', () => {
    const { data } = fixture();
    const input = '#EXTM3U x-tvg-url="https://example.invalid/guide.xml"\n#EXTINF:-1 tvg-name="CNN, USA" tvg-id="CNN.us" tvg-country="US" tvg-language="Spanish",CNN, International\n#EXTGRP:USA News\nhttp://example.invalid/live/1.m3u8\n#EXTINF:-1 group-title="Drama",Foreign Film\nhttp://example.invalid/movie/1.mp4?x=1';
    const parsed = data.parseM3u(input, { type: 'm3u', m3uUrl: 'http://example.invalid/list' });
    assert.equal(parsed.epgUrl, 'https://example.invalid/guide.xml');
    assert.equal(parsed.live[0].name, 'CNN, International');
    assert.equal(parsed.liveCategories[0].name, 'USA News');
    assert.equal(parsed.live[0].country, 'US');
    assert.equal(parsed.movies.length, 1);
    const reversed = data.parseM3u(input.split('\n').slice(1, 4).join('\n'), { type: 'm3u', m3uUrl: 'http://example.invalid/list' });
    assert.equal(parsed.live[0].id, reversed.live[0].id);
});
test('repeated M3U URLs merge categories and conflicting metadata, without duplicate IDs', () => {
    const { data } = fixture();
    const parsed = data.parseM3u('#EXTM3U\n#EXTINF:-1 tvg-country="US" group-title="USA News",CNN\nhttp://example.invalid/live/cnn\n#EXTINF:-1 tvg-country="GB" group-title="UK",CNN copy\nhttp://example.invalid/live/cnn', {});
    assert.equal(parsed.live.length, 1);
    assert.equal(parsed.live[0].country, 'US;GB');
    assert.equal(data.usPolicy(parsed.live, parsed.liveCategories).items.length, 0);
});
test('M3U series episodes are grouped by show with resolved playable URLs', () => {
    const { data } = fixture();
    const parsed = data.parseM3u('#EXTM3U\n#EXTINF:-1 group-title="Series",Show S02E03 A Story\nhttp://example.invalid/series/3.mp4\n#EXTINF:-1 group-title="Series",Show S01E02 Beginning\nhttp://example.invalid/series/2.mp4', {});
    assert.equal(parsed.movies.length, 0); assert.equal(parsed.series.length, 1);
    const seasons = parsed.series[0]._episodes;
    assert.equal(parsed.series[0].url, ''); assert.equal(seasons[0].season, 2); assert.equal(seasons[1].episode, 2);
});
test('01608 market filtering keeps nearby news, national cable and sports, excluding remote affiliates', () => {
    const { data } = fixture();
    const cats = [{ id: 'locals', name: 'USA Locals' }, { id: 'cable', name: 'USA Entertainment' }, { id: 'sports', name: 'USA Sports' }];
    const items = [channel('wbz', 'CBS WBZ Boston', ['locals']), channel('wmur', 'ABC WMUR Manchester', ['locals']), channel('wabc', 'ABC WABC New York', ['locals']), channel('cnn', 'CNN', ['locals'], { epgId: 'CNN.WABC.us' }), channel('sport', 'ESPN', ['locals']), channel('game', 'NFL Teams New York Giants', ['sports']), channel('show', 'King of Queens', ['cable']), channel('weather', 'The Weather Channel', ['cable']), channel('pbs', 'PBS WGBH Boston', ['locals'])];
    const result = data.localPolicy({ items, categories: cats }, '01608');
    assert.deepEqual(plain(result.items.map(item => item.id)), ['wbz', 'wmur', 'cnn', 'sport', 'game', 'show', 'weather', 'pbs']);
    assert.ok(result.categories.some(cat => cat.id === '__tuner_local_news'));
    assert.ok(result.items.find(item => item.id === 'wbz').categoryIds.includes('__tuner_local_news'));
    assert.equal(data.localPolicy({ items, categories: cats }, '90210').items.length, items.length);
});
test('unrecognized local stations do not become backups of nearby affiliates', () => {
    const { data } = fixture();
    const cats = [{ id: 'locals', name: 'USA Locals' }];
    const result = data.foldLive(data.localPolicy({ items: [channel('boston', 'CBS WBZ Boston', ['locals']), channel('remote', 'CBS WCBS New York', ['locals'])], categories: cats }, '01608'));
    assert.equal(result.items.length, 1); assert.equal(result.items[0].backups.length, 0);
});
test('duplicates prefer healthy looking channels and retain every usable backup', () => {
    const { data } = fixture();
    const result = data.foldLive({ items: [channel('a', 'US: CNN HD', ['us'], { epgId: 'cnn.us' }), channel('b', '(US) CNN (Backup)', ['us'], { epgId: 'cnn.us' }), channel('c', 'CNN East'), channel('west', 'CNN West'), channel('idle', 'ESPN+ 78:'), channel('dead', 'Event stop: 2020 01 01 00:00:00')], categories });
    const cnn = result.items.find(item => item.id === 'a');
    assert.ok(cnn, 'EPG evidence should keep the preferred stream'); assert.equal(cnn.url, 'http://example.invalid/a.m3u8'); assert.equal(cnn.name, 'CNN East'); assert.deepEqual(plain(cnn.backups), ['http://example.invalid/c.m3u8', 'http://example.invalid/b.m3u8']);
    assert.equal(result.merged.b, 'a'); assert.equal(result.items.length, 2);
});

test('dated live events hide only outside the native six-hour past and twenty-hour future window', () => {
    const { data } = fixture(), now = Date.UTC(2026, 9, 13, 20); // 4 PM Eastern daylight time.
    const items = [channel('old', 'NFL 10: Teams (10.12 1:00PM ET)'), channel('future', 'HBO 38: Wrestling (10.15 8:00PM ET)'), channel('recent', 'MLB 01: Teams (10.13 10:00AM ET)'), channel('soon', 'NBA 02: Teams (10.14 12:00PM ET)'), channel('show', 'The FAN Show @ Oct 13 3:00PM'), channel('long', 'Football Event | Tuesday, 13 October 2026 20:00'), channel('replay', 'NFL Replay (10.01 1:00PM ET)'), channel('continuous', '24/7 Baseball (10.01 1:00PM ET)'), channel('cable', 'CNN'), channel('unparsed', 'ESPN College Football Oct 2026'), channel('bad', 'ESPN Event (13.45 25:60PM ET)')];
    const kept = data.foldLive({ items, categories }, now).items.map(item => item.id);
    assert.deepEqual(plain(kept), ['recent', 'soon', 'show', 'long', 'replay', 'continuous', 'cable', 'unparsed', 'bad']);
    assert.equal(data.offAir('MLB 01 (10.13 9:59AM ET)', now), true); assert.equal(data.offAir('NBA 01 (10.14 12:01PM ET)', now), true);
    assert.equal(data.offAir('ESPN Classic Games (10.01 1:00PM ET)', now), false); assert.equal(data.offAir('Peacock Encore (10.01 1:00PM ET)', now), false);
});

test('event clocks use America/New_York daylight rules and select the nearest calendar year', () => {
    const { data } = fixture();
    assert.equal(data.offAir('NFL 01 (01.13 1:00PM ET)', Date.UTC(2026, 0, 13, 0)), false, 'Winter 1 PM is 18 hours ahead, not 17');
    assert.equal(data.offAir('NFL 01 (01.13 1:00PM ET)', Date.UTC(2026, 0, 14, 0)), false, 'Winter past boundary includes exactly six hours');
    assert.equal(data.offAir('NFL 01 (10.13 1:00PM ET)', Date.UTC(2026, 9, 13, 23)), false, 'Summer past boundary includes exactly six hours');
    assert.equal(data.offAir('NFL 01 (10.13 1:00PM ET)', Date.UTC(2026, 9, 13, 23, 1)), true);
    assert.equal(data.offAir('NFL 01 (12.31 8:00PM ET)', Date.UTC(2027, 0, 1, 3)), false, 'New Year selects the preceding December');
    assert.equal(data.offAir('NFL 01 (01.01 1:00PM ET)', Date.UTC(2026, 11, 31, 22)), false, 'New Year selects the upcoming January at the future window boundary');
    assert.equal(data.offAir('Event (03.08 2:30AM ET)', Date.UTC(2026, 2, 8, 13, 30)), false, 'A nonexistent spring hour follows native Calendar normalization');
    assert.equal(data.offAir('Event (03.08 2:30AM ET)', Date.UTC(2026, 2, 8, 13, 31)), true);
    assert.equal(data.offAir('Event (11.01 1:30AM ET)', Date.UTC(2026, 10, 1, 12, 30)), false, 'The repeated fall hour uses standard time like native Calendar');
    assert.equal(data.offAir('Event (11.01 1:30AM ET)', Date.UTC(2026, 10, 1, 12, 31)), true);
    assert.equal(data.offAir('Event stop: 2026 10 13 19:59:59', Date.UTC(2026, 9, 13, 20)), true, 'Explicit UTC stop handling is retained');
});
test('newest movie copy keeps older alternatives and all genres', () => {
    const { data } = fixture();
    const result = data.foldMovies([{ ...channel('old', 'A Movie (2024)', ['drama']), added: 10 }, { ...channel('new', 'A Movie (2024)', ['action']), added: 20 }]);
    assert.equal(result.length, 1); assert.equal(result[0].id, 'new'); assert.deepEqual(plain(result[0].categoryIds), ['action', 'drama']); assert.deepEqual(plain(result[0].backups), ['http://example.invalid/old.m3u8']);
});
test('guide categories follow cable order and Most Watched is optional', () => {
    const { data } = fixture();
    const cats = ['Other', 'Local news', 'USA Documentaries', 'USA Entertainment', 'USA Movies', 'USA News', 'USA Premium', 'USA Sports'].map((name, id) => ({ id: String(id), name }));
    assert.deepEqual(plain(data.categoryItems(cats, true).map(cat => cat.name)), ['All Channels', 'Favorites', 'Most Watched', 'USA Sports', 'USA Premium', 'USA News', 'USA Movies', 'USA Entertainment', 'USA Documentaries', 'Local news', 'Other']);
    assert.ok(!data.categoryItems(cats, false).some(cat => cat.id === '__hot'));
});
test('favorites, watch counts and recents survive reload and remain per-provider', () => {
    const { data } = fixture();
    const store = data.createStore(); store.saveSettings({ source, theme: 'black', bridgeUrl: 'http://example.invalid/bridge' });
    store.toggleFavourite('x:1'); store.recordWatched('x:1'); store.recordWatched('x:1'); store.recordWatched('x:2');
    store.saveRecent({ id: 'm:1', name: 'Movie', url: 'http://example.invalid/movie' }, 20000, 100000);
    const reloaded = data.createStore(); assert.equal(reloaded.settings.theme, 'black'); assert.equal(reloaded.settings.bridgeUrl, 'http://example.invalid/bridge');
    assert.equal(reloaded.isFavourite('x:1'), true); assert.deepEqual(plain(reloaded.mostWatched()), ['x:1', 'x:2']); assert.equal(reloaded.recents()[0].positionMs, 20000);
    reloaded.saveSettings({ source: { ...source, id: 'second-provider' } }); assert.equal(reloaded.favourites().length, 0); assert.equal(reloaded.recents().length, 0); assert.equal(reloaded.mostWatched().length, 0);
    assert.deepEqual(plain(reloaded.favourites(data.sourceKey(source))), ['x:1']);
});
test('completed media is removed from Continue Watching and short accidental plays are ignored', () => {
    const { data } = fixture(); const store = data.createStore(); store.saveSettings({ source });
    const item = { id: 'm:1', name: 'Movie', url: 'http://example.invalid/movie' };
    store.saveRecent(item, 1000, 100000); assert.equal(store.recents().length, 0);
    store.saveRecent(item, 30000, 100000); assert.equal(store.recents().length, 1);
    store.saveRecent(item, 96000, 100000); assert.equal(store.recents().length, 0);
});
test('storage errors stay usable in memory and are surfaced without exposing provider details', () => {
    const { data } = fixture(); const store = data.createStore({ getItem() { throw Error('private error'); }, setItem() { throw Error('private error'); } });
    assert.equal(store.saveSettings({ source }), false); assert.equal(store.settings.source.id, source.id); assert.match(store.lastError, /Unable to save/); assert.doesNotMatch(store.lastError, /private error|sample-pass/);
});
test('catalog loads publish independently when another library fails', async () => {
    const { data, find, respond, requests } = fixture(), published = [], statuses = [];
    const client = data.createClient(source, { zip: '', onCatalog: (kind, items) => published.push({ kind, items }), onStatus: (kind, value) => statuses.push({ kind, ...value }) });
    const done = client.load(); assert.equal(requests.length, 6);
    respond(find('get_live_categories'), [{ category_id: 'us', category_name: 'USA News' }]); respond(find('get_live_streams'), [{ stream_id: 1, name: 'CNN', category_id: 'us' }]);
    await flush(); assert.deepEqual(published.map(value => value.kind), ['live']); assert.ok(statuses.some(value => value.kind === 'live' && value.state === 'ready'));
    respond(find('get_vod_categories'), [], 500); respond(find('get_vod_streams'), []);
    respond(find('get_series_categories'), [{ category_id: 'drama', category_name: 'Drama' }]); respond(find('get_series'), [{ series_id: 8, category_id: 'drama', name: 'All languages', language: 'fra' }]);
    await done; assert.ok(published.some(value => value.kind === 'series')); assert.ok(statuses.some(value => value.kind === 'movies' && value.state === 'error'));
    assert.ok(!statuses.some(value => value.message.includes('sample-pass')));
});
test('cancellation aborts every pending catalog request and cannot publish stale results', async () => {
    const { data, requests } = fixture(), published = [], statuses = [];
    const client = data.createClient(source, { onCatalog: kind => published.push(kind), onStatus: (kind, value) => statuses.push(value.state) });
    const pending = client.load(); client.cancel(); await pending;
    assert.ok(requests.every(request => request.aborted)); assert.deepEqual(published, []); assert.ok(statuses.every(value => value === 'loading'));
});
test('published duplicate aliases keep saved favorites and watched counts attached to the preferred stream', async () => {
    const { data, find, respond } = fixture(); const store = data.createStore(); store.saveSettings({ source }); store.toggleFavourite('x:2'); store.recordWatched('x:2');
    const client = data.createClient(source, { zip: '' }); const pending = client.load();
    respond(find('get_live_categories'), [{ category_id: 'us', category_name: 'USA' }]); respond(find('get_live_streams'), [{ stream_id: 1, category_id: 'us', name: 'CNN' }, { stream_id: 2, category_id: 'us', name: 'CNN Backup' }]);
    respond(find('get_vod_categories'), []); respond(find('get_vod_streams'), []); respond(find('get_series_categories'), []); respond(find('get_series'), []); await pending;
    assert.deepEqual(plain(store.favourites()), ['x:1']); assert.equal(store.isFavourite('x:1'), true); assert.deepEqual(plain(store.mostWatched()), ['x:1']); assert.equal(store.lastWatched(), 'x:1');
    store.toggleFavourite('x:1'); assert.equal(store.favourites().length, 0);
});
test('short EPG requests share pending work, decode UTF-8 and cache usable results', async () => {
    const { data, find, respond, requests } = fixture(); const client = data.createClient(source); const item = channel('x:1', 'CNN', ['us'], { streamId: '1' });
    const a = client.guide(item), b = client.guide(item); assert.equal(a, b); const now = Math.floor(Date.now() / 1000);
    respond(find('get_short_epg'), { epg_listings: [{ id: 3, start_timestamp: now - 100, stop_timestamp: now + 3600, title: Buffer.from('News café').toString('base64'), description: Buffer.from('Live bulletin').toString('base64') }, { start_timestamp: now, stop_timestamp: now - 1, title: 'Invalid' }] });
    const programs = await a; assert.equal(programs.length, 1); assert.equal(programs[0].title, 'News café'); assert.equal(programs[0].start, (now - 100) * 1000);
    await client.guide(item); assert.equal(requests.length, 1);
});
test('guide timeout rejects with a safe actionable error and allows retry', async () => {
    const { data, find, requests } = fixture(); const client = data.createClient(source); const item = channel('x:1', 'CNN', ['us'], { streamId: '1' });
    const pending = client.guide(item); const request = find('get_short_epg'); request.ontimeout(); await assert.rejects(pending, /took too long/);
    const retry = client.guide(item); assert.equal(requests.length, 2); client.cancel(); await assert.rejects(retry, { name: 'AbortError' });
});
test('series info handles nested arrays, season maps, ordering, direct sources and duplicate episodes', () => {
    const { data } = fixture();
    const row = { id: 7, season: 2, episode_num: 3, title: 'Episode three', direct_source: 'https://cdn.invalid/three.mp4', info: { duration_secs: 123, movie_image: 'http://example.invalid/poster' } };
    const map = data.parseSeriesInfo({ episodes: { 2: [row, row], 1: [{ id: 2, episode_num: 1, container_extension: 'mkv' }] } }, source);
    assert.deepEqual(plain(map.seasons.map(season => season.number)), [1, 2]); assert.equal(map.seasons[1].episodes.length, 1); assert.equal(map.seasons[1].episodes[0].duration, 123); assert.equal(map.seasons[1].episodes[0].url, 'https://cdn.invalid/three.mp4');
    assert.match(map.seasons[0].episodes[0].url, /\/series\/sample-user\/sample-pass\/2.mkv$/);
    const nested = data.parseSeriesInfo({ episodes: [[row], [{ id: 3, season: 1, episode_num: 2 }]] }, source); assert.equal(nested.seasons.length, 2);
});
test('client series and movie metadata load from the exact provider IDs and cache their results', async () => {
    const { data, find, respond, requests } = fixture(); const client = data.createClient(source);
    const series = client.seriesInfo({ id: 's:8', streamId: '8' }); assert.match(find('get_series_info').url, /series_id=8/); respond(find('get_series_info'), { episodes: { 1: [{ id: 22, title: 'Pilot', episode_num: 1 }] } }); assert.equal((await series).seasons[0].episodes[0].id, 'e:22');
    const movie = client.movieInfo({ id: 'm:7', streamId: '7' }); assert.match(find('get_vod_info').url, /vod_id=7/); respond(find('get_vod_info'), { info: { description: 'Plot', movie_image: 'http://example.invalid/poster', backdrop_path: ['http://example.invalid/backdrop'], releasedate: '2024-10-01' } }); const info = await movie; assert.equal(info.plot, 'Plot'); assert.equal(info.year, '2024'); assert.equal(info.backdrop, 'http://example.invalid/backdrop');
    await client.movieInfo({ id: 'm:7', streamId: '7' }); assert.equal(requests.length, 2);
});
test('account capacity is reported without exposing credentials and does not delay catalogs', async () => {
    const { data, find, respond, requests } = fixture(); let account; const statuses = [];
    const client = data.createClient(source, { onAccount: value => { account = value; }, onStatus: (kind, value) => statuses.push(value.state) }); const loaded = client.load();
    assert.ok(find(null)); const accountPromise = client.accountInfo(true); const auth = find(null); respond(auth, { user_info: { auth: 1, username: 'private', password: 'private', max_connections: '1', active_cons: '0' } }); await flush();
    assert.deepEqual(plain(account), { maxConnections: 1, activeConnections: 0 }); assert.ok(!JSON.stringify(account).includes('private')); assert.ok(statuses.every(state => state === 'loading'));
    await accountPromise; assert.equal(requests.filter(request => !request.url.includes('action=')).length, 1); assert.equal(find(null), undefined);
    client.cancel(); await loaded;
});

test('cancelled clients reject metadata without starting new requests', async () => {
    const { data, requests } = fixture(); const client = data.createClient(source); client.cancel();
    for (const promise of [client.guide({ id: 'l:1', streamId: '1' }), client.movieInfo({ id: 'm:1' }), client.seriesInfo({ id: 's:1' }), client.accountInfo(true)]) await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(requests.length, 0);
});

test('XHR setup failures return safe messages without provider credentials', async () => {
    const { data } = fixture({ openError: true }); const states = [];
    await data.createClient(source, { onStatus: (kind, status) => { if (status.state === 'error') states.push(status); } }).load();
    assert.equal(states.length, 3);
    for (const status of states) { assert.equal(status.message, 'The provider request could not be started. Check the server address.'); assert.ok(!status.message.includes(source.username)); assert.ok(!status.message.includes(source.password)); }
});

function xmlStamp(ms) { return new Date(ms).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + ' +0000'; }
function programme(id, start, end, title, desc = '') { return '<programme channel="' + id + '" start="' + xmlStamp(start) + '" stop="' + xmlStamp(end) + '"><title>' + title + '</title><desc>' + desc + '</desc></programme>'; }
const m3uSource = { type: 'm3u', m3uUrl: 'http://example.invalid/list.m3u' };
const m3uPlaylist = '#EXTM3U x-tvg-url="http://example.invalid/guide.xml"\n#EXTINF:-1 tvg-country="US" tvg-id="cnn.us" group-title="USA News",CNN\nhttp://example.invalid/live/one.m3u8\n#EXTINF:-1 tvg-country="US" group-title="USA News",MSNBC\nhttp://example.invalid/live/two.m3u8';

test('XMLTV times honor offsets and reject invalid dates', () => {
    const { data } = fixture();
    assert.equal(data.xmlTime('20261013150000 -0400'), Date.UTC(2026, 9, 13, 19));
    assert.equal(data.xmlTime('202610131500 +0530'), Date.UTC(2026, 9, 13, 9, 30));
    assert.equal(data.xmlTime('20260230150000 +0000'), 0); assert.equal(data.xmlTime('20261013256000 +0000'), 0); assert.equal(data.xmlTime('20261013150000 +2460'), 0);
});

test('XMLTV retains only wanted channels and time window, decodes entities and CDATA, trims overlapping duplicates', () => {
    const { data } = fixture(), start = Date.UTC(2026, 9, 13, 19), end = start + 3600000;
    const xml = '<?xml version="1.0"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv><channel id="CNN.US"><display-name>CNN</display-name><icon src="http://example.invalid/logo?x=1&amp;y=2"/></channel><channel id="msnbc.provider"><display-name>MSNBC HD</display-name></channel><channel id="foreign"><display-name>BBC London</display-name></channel><!-- fake <programme channel="cnn.us"> -->' +
        programme('CNN.US', start, end, 'News &amp; Café &#x1F600;', '<![CDATA[A <special> & report]]>') + programme('cnn.us', start + 1800000, end + 1800000, 'Next') + programme('cnn.us', start, end, 'Duplicate') + programme('msnbc.provider', start, end, 'MSNBC') + programme('foreign', start, end, 'Hidden') + programme('cnn.us', start - 7200000, start - 3600000, 'Too old') + programme('cnn.us', end + 7200000, end + 10800000, 'Too far') + '</tv>';
    const result = data.parseXmltv(xml, [channel('cnn', 'CNN', ['us'], { epgId: 'cnn.us' }), channel('msnbc', 'MSNBC')], start, end + 3600000);
    assert.deepEqual(Object.keys(result.programs).sort(), ['cnn.us', 'msnbc.provider']); assert.equal(result.programs['cnn.us'].length, 2);
    assert.equal(result.programs['cnn.us'][0].title, 'News & Café 😀'); assert.equal(result.programs['cnn.us'][0].description, 'A <special> & report'); assert.equal(result.programs['cnn.us'][1].start, end);
    assert.equal(result.icons['cnn.us'], 'http://example.invalid/logo?x=1&y=2'); assert.equal(result.names.msnbc, 'msnbc.provider');
});

test('XMLTV does not resolve custom external entities or accept partial documents', () => {
    const { data } = fixture();
    assert.throws(() => data.parseXmltv('<!DOCTYPE tv [<!ENTITY x SYSTEM "file:///private">]><tv/>', [], 0, 1), /entities/);
    assert.throws(() => data.parseXmltv('<tv><channel id="a"><display-name>Partial', [], 0, 1), /complete XMLTV/);
    assert.throws(() => data.parseXmltv('<tv>', [], 0, 1), /complete XMLTV/);
});

test('M3U guide loads once for visible channels, matches names, caches and supports explicit EPG URL override', async () => {
    const { data, requests, respond } = fixture(); let channels;
    const client = data.createClient({ ...m3uSource, epgUrl: 'http://example.invalid/custom.xml' }, { onCatalog: (kind, items) => { if (kind === 'live') channels = items; } });
    const loaded = client.load(); respond(requests[0], m3uPlaylist); await loaded; assert.equal(requests.length, 1, 'Guide must not delay the catalog');
    const first = client.guide(channels[0]), second = client.guide(channels[1]); assert.equal(requests.length, 2); assert.equal(requests[1].url, 'http://example.invalid/custom.xml');
    const now = Date.now(); respond(requests[1], '<tv><channel id="msnbc.provider"><display-name>MSNBC</display-name></channel>' + programme('cnn.us', now - 60000, now + 600000, 'Café 😀') + programme('msnbc.provider', now - 60000, now + 600000, 'Other') + '</tv>');
    assert.equal((await first)[0].title, 'Café 😀'); assert.equal((await second)[0].title, 'Other'); await client.guide(channels[0]); assert.equal(requests.length, 2);
});

test('M3U header XMLTV is parsed in yielding batches and cancellation rejects stale work', async () => {
    const { data, requests, respond, timers } = fixture({ manualTimers: true }); let channels;
    const client = data.createClient(m3uSource, { onCatalog: (kind, items) => { if (kind === 'live') channels = items; } }); const loaded = client.load(); respond(requests[0], m3uPlaylist); await loaded;
    const guide = client.guide(channels[0]); assert.equal(requests[1].url, 'http://example.invalid/guide.xml');
    const now = Date.now(), row = programme('ignored', now - 60000, now + 600000, 'Hidden'); respond(requests[1], '<tv>' + row.repeat(1000) + '</tv>'); await flush();
    assert.ok(timers.length > 0, 'Large guide parsing must yield to remote input'); client.cancel(); while (timers.length) timers.shift()(); await assert.rejects(guide, { name: 'AbortError' });
});

test('M3U XMLTV decodes UTF-16 BOM and rejects unsupported text encodings', async () => {
    for (const encoding of ['utf16le', 'unsupported']) {
        const { data, requests, respond } = fixture(); let channels; const client = data.createClient(m3uSource, { onCatalog: (kind, items) => { if (kind === 'live') channels = items; } }); const loaded = client.load(); respond(requests[0], m3uPlaylist); await loaded;
        const guide = client.guide(channels[0]); const xml = '<tv>' + programme('cnn.us', Date.now() - 60000, Date.now() + 600000, 'Café') + '</tv>';
        respond(requests[1], encoding === 'utf16le' ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(xml, 'utf16le')]) : Buffer.from('<?xml version="1.0" encoding="unknown-provider-charset"?>' + xml));
        if (encoding === 'utf16le') assert.equal((await guide)[0].title, 'Café'); else await assert.rejects(guide, /cannot read the guide text encoding/);
    }
});

test('raw gzip guide works only with native decompression and unsupported TVs receive a truthful error', async () => {
    const compressed = require('node:zlib').gzipSync('<tv>' + programme('cnn.us', Date.now() - 60000, Date.now() + 600000, 'Compressed') + '</tv>');
    for (const available of [false, true]) {
        const { data, requests, respond } = fixture({ gzip: available }); let channels; const client = data.createClient(m3uSource, { onCatalog: (kind, items) => { if (kind === 'live') channels = items; } }); const loaded = client.load(); respond(requests[0], m3uPlaylist); await loaded;
        const guide = client.guide(channels[0]); respond(requests[1], compressed);
        if (available) assert.equal((await guide)[0].title, 'Compressed'); else await assert.rejects(guide, /cannot unpack the compressed guide/);
    }
});

test('the full lineup is the default; USA only and category order are opt-in', () => {
    const { data } = fixture();
    const cats = [{ id: 'us', name: 'USA | News' }, { id: 'uk', name: 'UK | Entertainment' }];
    const items = [channel('a', 'CNN', ['us'], { country: 'US' }), channel('b', '[UK] Sky News', ['uk'], { country: 'GB' }), channel('c', 'Loose feed', [])];
    const all = data.allPolicy(items.map(item => ({ ...item, categoryIds: item.categoryIds.slice() })), cats);
    assert.deepEqual(plain(all.items.map(item => item.name)), ['CNN', '[UK] Sky News', 'Loose feed']);
    assert.deepEqual(plain(all.categories.map(cat => cat.id)), ['us', 'uk', '__tuner_live']);
    assert.deepEqual(plain(data.usPolicy(items, cats).items.map(item => item.name)), ['CNN']);
    const order = [{ id: 's', name: 'US Sports' }, { id: 'k', name: 'Kids' }, { id: 'n', name: 'US News' }, { id: 'a', name: '| Action |' }];
    const ids = mode => plain(data.categoryItems(order, false, mode).slice(2).map(cat => cat.id));
    assert.deepEqual(ids(), ['s', 'n', 'k', 'a']);
    assert.deepEqual(ids('provider'), ['s', 'k', 'n', 'a']);
    assert.deepEqual(ids('az'), ['a', 'k', 'n', 's']);
});
