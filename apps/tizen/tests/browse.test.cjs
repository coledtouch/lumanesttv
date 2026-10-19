'use strict';
// Movies & Series browsing logic in js/data.js (docs/browse.md): title matching, the USA filter, Home rows,
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

test('provider items carry their TMDB id (tmdb, tmdb_id or info.tmdb_id) and genre', () => {
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const movies = data.parseXtream([
        { stream_id: 1, name: 'A', tmdb: '603' }, { stream_id: 2, name: 'B', tmdb_id: 27205, genre: 'Action, Sci-Fi' },
        { stream_id: 3, name: 'C', info: { tmdb_id: '155' } }, { stream_id: 4, name: 'D', tmdb: '0' }, { stream_id: 5, name: 'E', tmdb: 'tt0133093' }
    ], 'movies', source);
    assert.deepEqual(plain(movies.map(m => m.tmdb)), ['603', '27205', '155', '', '']);
    assert.equal(movies[1].genre, 'Action, Sci-Fi');
    const live = data.parseXtream([{ stream_id: 9, name: 'CNN', tmdb: '1' }], 'live', source, 'm3u8');
    assert.equal(live[0].tmdb, undefined, 'live channels are unchanged');
    assert.equal(data.foldMovies([movie('Same', { tmdb: '' }), movie('Same', { tmdb: '42', added: -1 })])[0].tmdb, '42');
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
        '| 4K | Dune': 'dune', 'Dune | 4K | EN': 'dune en' };
    for (const [input, expected] of Object.entries(cases)) assert.equal(B.normalizeTitle(input), expected, input);
    assert.equal(B.titleYear({ name: 'EN | The Matrix | 1999' }), 1999, 'a year after a pipe is the year');
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

test('same-name copies fold into one that USA only can play: a passing category before a newer foreign copy', () => {
    const catsWithDe = cats.concat([{ id: 'de', name: 'DE | Filme' }]);
    const en = movie('Avatar (2009)', { added: 100, url: 'https://x/en.mp4' }), fr = movie('Avatar (2009)', { added: 200, categoryIds: ['fr'], url: 'https://x/fr.mp4' });
    const folded = data.foldMovies([en, fr], catsWithDe);
    assert.equal(folded.length, 1); assert.equal(folded[0].url, 'https://x/en.mp4'); assert.deepEqual(plain(folded[0].backups), ['https://x/fr.mp4']);
    assert.equal(folded[0].categoryId, 'en');
    const index = B.buildIndex('movies', folded, catsWithDe, payload({ popular: [tmdb('19995', 'Avatar', 2009)] }));
    assert.equal(index.titles[B.pick(index, 'popular', { usOnly: true, genre: '' }, 0, 1).picked[0]].item.url, 'https://x/en.mp4');
    // Among copies that pass (or that all fail), the newest is kept as before.
    assert.equal(data.foldMovies([en, movie('Avatar (2009)', { added: 300, url: 'https://x/en2.mp4' })], cats)[0].url, 'https://x/en2.mp4');
    const foreign = data.foldMovies([movie('Heat', { added: 1, categoryIds: ['fr'], url: 'https://x/fr' }), movie('Heat', { added: 2, categoryIds: ['de'], url: 'https://x/de' })], catsWithDe);
    assert.equal(foreign[0].url, 'https://x/de');
    assert.equal(B.buildIndex('movies', foreign, catsWithDe, null).titles[0].us, false, 'only foreign copies: USA only hides the title');
    assert.equal(data.foldMovies([en, fr])[0].url, 'https://x/fr.mp4', 'without categories: newest first');
    const check = B.categoryCheck(catsWithDe);
    assert.deepEqual([check(en), check(fr), check(movie('x', { categoryIds: [] })), check(movie('x', { categoryIds: ['fr', 'en'] })), check(movie('x', { categoryIds: ['gone'] }))], [true, false, true, true, true]);
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
