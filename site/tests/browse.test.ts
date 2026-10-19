// The web player's browse rules (lib/browse.ts), case for case the same as apps/roku/tests/BrowseLogicTests.brs, so the
// web player and the Tuner apps pick, match and order titles the same way (docs/browse.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICES as BROWSE_SERVICES, browseServices, buildHomeRows, buildTitleSection, buildTitleSectionAsync, categoryGenreKeys, categoryServices, clockText,
  compactCategory, compactXtream, discoverLists, emptyRowsSection, foldText, genreTable, homeRowSpecs, isAdultName, isForeignCategory, libraryFor, libraryIsFavorite,
  libraryKeys, libraryNew, libraryProgress, libraryRecordProgress, libraryRecordWatched, libraryRefs, libraryRemoveProgress, libraryToggleFavorite,
  libraryTypeOf, matchTmdb, normalizeTitle, parseRowsPayload, pickTitles, progressFraction, providerGenreKeys, providerTmdbId, searchTitles,
  titleFromCompact, titleFromM3u, titleYearOf, tmdbIndex, yearOfText, type BrowseTitle, type CategoryInput, type Library, type TitleSection,
} from '../lib/browse.ts';
import {isAdultGroup} from '../lib/player-data.ts';
import {SERVICES as CATALOG_SERVICES, mergePages, type CatalogRows, type MediaLists} from '../lib/catalog.ts';

// ------------------------------------------------------------------ helpers

function tmdbItem(id: number, title: string, year: string, origin: string[], genres: number[]) {
  return {id, title, original_title: title, year, origin, lang: 'en', genres, popularity: 10};
}

/** A rows payload with the given lists, through the same parser the web player uses. */
function rowsPayloadWith(movie: Record<string, unknown>, tv: Record<string, unknown>) {
  return parseRowsPayload(JSON.stringify({v: 1, source: 'tmdb', generated: '2026-10-19T00:00:00Z', movie, tv, genres: {
    movie: [{id: 28, name: 'Action'}, {id: 18, name: 'Drama'}, {id: 878, name: 'Science Fiction'}],
    tv: [{id: 10759, name: 'Action & Adventure'}, {id: 10765, name: 'Sci-Fi & Fantasy'}],
  }}));
}

function movieRow(id: string, name: string, cat: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {stream_id: id, name, category_id: cat, stream_icon: 'http://img/' + id + '.jpg', container_extension: 'mkv', added: '0', rating: '', ...extra};
}

function sectionTitles(rows: unknown[], kind: 'movie' | 'series'): BrowseTitle[] {
  return rows.map(row => compactXtream(kind, row)).filter(item => item !== null).map(item => titleFromCompact(kind, item));
}

const namesOf = (section: TitleSection, indices: number[]) => indices.map(i => section.items[i].name);
const none = () => parseRowsPayload(JSON.stringify({v: 1, source: 'none', movie: {}, tv: {}, genres: {}}));

// ------------------------------------------------------------------ titles

test('normalizeTitle matches the Roku cases', () => {
  const cases: [string, string, string][] = [
    ['The Matrix (1999)', 'matrix', 'trailing year and leading the'],
    ['|US| Dune: Part Two [4K]', 'dune part two', 'pipe and bracket tags'],
    ['US - Fast & Furious 7 HD', 'fast and furious 7', 'prefix, & and quality word'],
    ['EN| Spider-Man: No Way Home (2021) UHD', 'spider man no way home', 'punctuation becomes spaces'],
    ["Ocean's Eleven", 'oceans eleven', 'apostrophes are dropped'],
    ['The Office (US)', 'office', 'short parenthesised tag'],
    ['Amélie', 'amelie', 'accents folded'],
    ['  Blade   Runner 2049  ', 'blade runner 2049', 'years inside the title stay'],
    ['The', 'the', "a lone 'the' stays"],
    ['WALL-E', 'wall e', 'hyphenated title is not a prefix'],
    ['X-MEN: APOCALYPSE', 'x men apocalypse', 'upper-case title with a colon keeps its first word'],
    ['4K | NF | Stranger Things - EN', 'stranger things', 'stacked prefixes and suffix'],
    ['Mission: Impossible – Dead Reckoning', 'mission impossible dead reckoning', 'dashes and colons'],
    ['', '', 'empty title'],
  ];
  for (const [name, expected, label] of cases) assert.equal(normalizeTitle(name), expected, label);
});

test('years come from the row, then from the name', () => {
  assert.equal(titleYearOf('Dune (2021)'), '2021');
  assert.equal(titleYearOf('Dune [2021] [4K]'), '2021');
  assert.equal(titleYearOf('Blade Runner 2049'), '');
  assert.equal(yearOfText('2021-05-01'), '2021');
  assert.equal(yearOfText(1999), '1999');
  assert.equal(yearOfText(undefined), '');
  assert.equal(compactXtream('movie', movieRow('7', 'Heat (1995)', '1'))!.year, '1995', 'year taken from the name when the row has none');
  const series = titleFromCompact('series', compactXtream('series', {series_id: 9, name: 'Show', category_id: '2', releaseDate: '2019-01-02', last_modified: '1700000000', rating: '8.1', cover: 'c.jpg'})!);
  assert.deepEqual([series.key, series.id, series.year, series.added, series.poster, series.rating], ['s9', '9', '2019', 1700000000, 'c.jpg', 8.1], 'series row');
  const movie = titleFromCompact('movie', compactXtream('movie', movieRow('12', 'EN| Heat', '3', {added: '1700000123', rating_5based: '4', tmdb: '949', container_extension: ''}))!);
  assert.deepEqual([movie.key, movie.cat, movie.ext, movie.added, movie.rating, movie.hint, movie.year], ['m12', '3', 'mp4', 1700000123, 8, '949', ''], 'movie row');
  assert.equal(compactXtream('movie', {name: 'No id'}), null, 'a row without an id');
});

test('compact catalogue rows keep only what browsing needs, within limits', () => {
  const item = compactXtream('movie', {
    num: 1, name: 'x'.repeat(500), stream_type: 'movie', stream_id: 42, stream_icon: 'https://image.tmdb.org/t/p/w600/a.jpg', rating: '7.25', rating_5based: 3.6,
    added: '1700000000', is_adult: '0', category_id: '12', category_ids: [12, 13], container_extension: 'MKV', custom_sid: 'secret', direct_source: 'http://136.148.65.1/private', tmdb: '603', genre: 'Action',
  })!;
  assert.deepEqual(Object.keys(item).sort(), ['added', 'cat', 'ext', 'genre', 'id', 'name', 'poster', 'rating', 'tmdb']);
  assert.equal(item.name.length, 150);
  assert.equal(item.ext, 'mkv');
  assert.equal(item.rating, 7.3);
  assert.ok(!JSON.stringify(item).includes('direct_source') && !JSON.stringify(item).includes('136.148'));
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', container_extension: 'exe/../x'})!.ext, 'mp4', 'an unsafe extension falls back to mp4');
  assert.equal(compactXtream('movie', {stream_id: 'abc', name: 'A'}), null, 'ids are digits');
  assert.equal(compactXtream('movie', {stream_id: '12345678901', name: 'A'}), null, 'ids are at most 10 digits');
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', is_adult: 1})!.adult, true);
  assert.equal(compactXtream('series', {series_id: '5', name: 'A', container_extension: 'mkv'})!.ext, undefined, 'series carry no extension');
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', rating: '85'})!.rating, 8.5, 'a rating over 10 is out of 100');
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', stream_icon: 'x'.repeat(1100)})!.poster, undefined, 'overlong poster');
  assert.deepEqual(compactCategory({category_id: '3', category_name: 'XXX', parent_id: 0, is_adult: 1}), {id: '3', name: 'XXX', adult: true});
  assert.equal(compactCategory({category_name: 'No id'}), null);
});

test('provider TMDB ids', () => {
  assert.equal(providerTmdbId({tmdb: '603'}), '603');
  assert.equal(providerTmdbId({tmdb_id: 603}), '603');
  assert.equal(providerTmdbId({info: {tmdb_id: '603'}}), '603');
  assert.equal(providerTmdbId({tmdb: '0'}), '');
  assert.equal(providerTmdbId({tmdb: 'tt0133093'}), '');
});

test('USA only: foreign categories by code, tag or word', () => {
  for (const name of ['FR | Films', '|DE| Action', 'IT: Serie TV', 'LAT - Peliculas', 'MX Novelas', 'BR: Filmes', 'TR | Diziler', 'AR | Movies', 'IN | Bollywood', 'HINDI MOVIES', 'PK Dramas', 'NL Films', 'PL | Filmy', 'RO: Filme', 'RU Kino', 'UK | Drama', 'CA | Movies', 'PT | Filmes', 'ES | Cine', 'Peliculas Latino', 'French Movies', 'Arabic Series', 'Movies (Spanish)', '|IT| Film', 'Movies (IN)', 'Serie IT', 'IN-Movies', 'Films – IT', 'ITALIANO', 'Cine Castellano', 'Tamil Movies', 'TELUGU HD', 'Malayalam', 'Quebec Films', 'ARAB MOVIES']) {
    assert.ok(isForeignCategory(name), 'foreign category ' + name);
  }
  // All-caps IN and IT are English words unless they stand as a tag.
  for (const name of ['Movies in 4K', 'MOVIES IN 4K', 'NEW IN CINEMAS', 'WATCH IT ALL', 'NETFLIX MOVIES', 'US | Action', 'EN | Comedy', 'Kids', '4K UHD', 'Documentaries', 'Free Movies', 'Canalplus', 'Drama', 'Adventure', 'Top Picks', 'INDIE FILMS', '']) {
    assert.ok(!isForeignCategory(name), 'US category ' + name);
  }
  assert.ok(isForeignCategory('IT CHAPTER TWO'), 'at the start of the name IT counts as a tag, as on Android');
});

test('adult names follow the web player rule, which agrees with Roku', () => {
  for (const name of ['XXX', 'Adults Only', 'ADULT', '18+ Movies', 'Porn', 'Young Adult Fiction?']) {
    assert.ok(isAdultName(name), 'adult name ' + name);
    assert.equal(isAdultName(name), isAdultGroup(name));
  }
  for (const name of ['Adult Swim', 'Adultswim Shows', 'Kids']) assert.ok(!isAdultName(name), 'not adult ' + name);
});

test('streaming services by category name', () => {
  assert.deepEqual(categoryServices('NETFLIX 4K'), ['netflix']);
  assert.deepEqual(categoryServices('HBO Max Series'), ['max']);
  assert.deepEqual(categoryServices('Max Originals'), ['max']);
  assert.deepEqual(categoryServices('Maximum Action'), []);
  assert.deepEqual(categoryServices('Amazon Prime Video'), ['prime']);
  assert.deepEqual(categoryServices('Primetime Hits'), []);
  assert.deepEqual(categoryServices('Disney+ & Hulu'), ['disney', 'hulu']);
  assert.deepEqual(categoryServices('Apple TV+'), ['apple']);
  assert.deepEqual(categoryServices('Paramount+ | Peacock'), ['paramount', 'peacock']);
});

// ------------------------------------------------------------------ the rows endpoint

test('rows payloads: none, partial, wrong types, other versions and bad bodies', () => {
  const empty = none();
  assert.deepEqual([empty.valid, empty.source, empty.movie.popular, empty.tv.services.netflix, empty.genres.movie], [true, 'none', [], [], []]);
  const partial = parseRowsPayload(JSON.stringify({v: 1, source: 'tmdb', movie: {popular: [{id: 1}], services: {netflix: [{id: 2}]}}}));
  assert.deepEqual([partial.source, partial.movie.popular.length, partial.movie.featured, partial.movie.services.netflix.length, partial.movie.services.hulu, partial.tv.popular], ['tmdb', 1, [], 1, [], []]);
  assert.deepEqual(parseRowsPayload(JSON.stringify({v: 1, source: 'tmdb', movie: {popular: 'x'}})).movie.popular, []);
  const future = parseRowsPayload(JSON.stringify({v: 2, source: 'tmdb'}));
  assert.deepEqual([future.valid, future.source], [false, 'none']);
  assert.deepEqual([parseRowsPayload('').valid, parseRowsPayload('not json').valid, parseRowsPayload(null).valid], [false, false, false]);
  assert.equal(parseRowsPayload({v: 1, source: 'tmdb'}).valid, true, 'an already parsed body');
});

test('contract: what lib/catalog.ts serves parses with every list present', () => {
  assert.deepEqual([...BROWSE_SERVICES], [...CATALOG_SERVICES]);
  assert.deepEqual(browseServices().map(service => service.key), [...CATALOG_SERVICES]);
  const raw = (id: number, tv = false) => tv
    ? {id, name: 'Series ' + id, original_name: 'Series ' + id, first_air_date: '2024-02-03', origin_country: ['US'], original_language: 'en', genre_ids: [18], popularity: 5}
    : {id, title: 'Movie ' + id, original_title: 'Movie ' + id, release_date: '2025-07-04', original_language: 'en', genre_ids: [28], popularity: 5};
  const lists = (tv: boolean): MediaLists => ({
    popular: mergePages(tv ? 'tv' : 'movie', [[raw(1, tv), raw(2, tv)]]), featured: mergePages(tv ? 'tv' : 'movie', [[raw(3, tv)]]), top_rated: mergePages(tv ? 'tv' : 'movie', [[raw(4, tv)]]),
    services: Object.fromEntries(CATALOG_SERVICES.map((key, i) => [key, mergePages(tv ? 'tv' : 'movie', [[raw(10 + i, tv)]])])) as MediaLists['services'],
  });
  const rows: CatalogRows = {v: 1, source: 'tmdb', generated: '2026-10-19T00:00:00Z', movie: lists(false), tv: lists(true), genres: {movie: [{id: 28, name: 'Action'}], tv: [{id: 18, name: 'Drama'}]}};
  const parsed = parseRowsPayload(JSON.stringify(rows));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.source, 'tmdb');
  for (const media of ['movie', 'tv'] as const) {
    assert.equal(parsed[media].popular.length, 2);
    assert.equal(parsed[media].featured.length, 1);
    assert.equal(parsed[media].top_rated.length, 1);
    for (const key of CATALOG_SERVICES) assert.equal(parsed[media].services[key].length, 1, media + ' ' + key);
  }
  const index = tmdbIndex(parsed.tv);
  assert.equal(index.byId.get('1')!.us, true, 'series origins come through');
  assert.equal(tmdbIndex(parsed.movie).byId.get('1')!.known, false, 'a movie with no origin yet is unknown');
});

// ------------------------------------------------------------------ matching

test('matching on provider ids, titles and years', () => {
  const payload = rowsPayloadWith({popular: [tmdbItem(1, 'Dune', '2021', ['US'], [878]), tmdbItem(2, 'The Lion King', '2019', ['US'], []), tmdbItem(3, 'The Lion King', '1994', ['US'], []), tmdbItem(4, 'Amélie', '2001', ['FR'], [])], featured: [tmdbItem(1, 'Dune', '2021', ['US'], [878])]}, {});
  const index = tmdbIndex(payload.movie);
  assert.equal(index.count, 4, 'duplicates across lists are indexed once');
  assert.equal(matchTmdb(index, '1', '', '')!.id, '1', 'provider id');
  assert.equal(matchTmdb(index, '999', 'dune', '2021'), null, 'an unknown provider id does not fall back to the title');
  assert.equal(matchTmdb(index, '', normalizeTitle('Dune (2021) [4K]'), '2021')!.id, '1', 'title and year');
  assert.equal(matchTmdb(index, '', 'dune', '2022')!.id, '1', 'year off by one');
  assert.equal(matchTmdb(index, '', 'dune', '2023'), null, 'year off by two');
  assert.equal(matchTmdb(index, '', 'dune', '')!.id, '1', 'no year, one candidate');
  assert.equal(matchTmdb(index, '', normalizeTitle('The Lion King'), ''), null, 'no year, two candidates');
  assert.equal(matchTmdb(index, '', 'lion king', '1994')!.id, '3', 'exact year wins');
  assert.equal(matchTmdb(index, '', normalizeTitle('Amelie'), '2001')!.id, '4', 'accent-free provider title');
  assert.equal(matchTmdb(index, '', '', '2021'), null, 'empty title');
});

test('genres: closed and open tables', () => {
  const table = genreTable([{id: 10759, name: 'Action & Adventure'}, {id: 10765, name: 'Sci-Fi & Fantasy'}, {id: 18, name: 'Drama'}]);
  assert.equal(providerGenreKeys('Action, Adventure', table), '|10759|');
  assert.equal(providerGenreKeys('Science Fiction / Drama', table), '|10765|18|');
  assert.equal(providerGenreKeys('Cooking', table), '');
  assert.equal(table.list.length, 3, 'closed table does not grow');
  const open = genreTable([]);
  assert.equal(providerGenreKeys('Comedy, Drama', open), '|comedy|drama|');
  assert.equal(providerGenreKeys('drama', open), '|drama|');
  assert.deepEqual(open.list, [{key: 'comedy', name: 'Comedy'}, {key: 'drama', name: 'Drama'}]);
  // A genre table never treats an inherited object key as a genre.
  assert.equal(providerGenreKeys('constructor', genreTable([{id: 1, name: 'Drama'}])), '');
});

test('an empty origin is unknown: USA only then goes by the category', () => {
  const categories = [{id: '1', name: 'US | Movies'}, {id: '2', name: 'FR | Films'}];
  const rows = [movieRow('10', 'Dune (2021)', '1', {added: '1700000300'}), movieRow('11', 'Dune (2021)', '2', {added: '1700000400'}), movieRow('12', 'Oppenheimer (2023)', '1', {added: '1700000500'})];
  const payload = rowsPayloadWith({popular: [tmdbItem(438631, 'Dune', '2021', [], [878]), tmdbItem(872585, 'Oppenheimer', '2023', ['GB', 'US'], [18])]}, {});
  const section = buildTitleSection(sectionTitles(rows, 'movie'), categories, payload.movie, payload.genres.movie);
  const items = section.items;
  assert.deepEqual([items[0].tmdb, items[0].us], ['438631', true]);
  assert.deepEqual([items[1].tmdb, items[1].us], ['438631', false]);
  assert.deepEqual([items[2].tmdb, items[2].us], ['872585', true]);
  assert.deepEqual(namesOf(section, pickTitles(items, section.lists.popular, {usOnly: true, adultOk: false}, 0, 20).picked), ['Dune (2021)', 'Oppenheimer (2023)']);
});

test('categories named after a genre', () => {
  const table = genreTable([{id: 28, name: 'Action'}, {id: 878, name: 'Science Fiction'}, {id: 10751, name: 'Family'}, {id: 35, name: 'Comedy'}]);
  assert.equal(categoryGenreKeys('EN | Action Movies', table), '|28|');
  assert.equal(categoryGenreKeys('SCI-FI 4K', table), '|878|');
  assert.equal(categoryGenreKeys('Kids & Family', table), '|10751|');
  assert.equal(categoryGenreKeys('Comedy Central', table), '');
  assert.equal(categoryGenreKeys('NETFLIX MOVIES', table), '');
  assert.equal(table.list.length, 4);
  const open = genreTable([]);
  assert.equal(categoryGenreKeys('US | Horror Movies', open), '|horror|');
  assert.equal(categoryGenreKeys('Bollywood Gold', open), '');
  assert.deepEqual(open.list, [{key: 'horror', name: 'Horror'}]);

  const categories = [{id: '1', name: 'US | Comedy'}, {id: '2', name: 'Kids & Family'}, {id: '3', name: 'Movies'}];
  const rows = [movieRow('1', 'Some Comedy', '1'), movieRow('2', 'Some Family Film', '2', {genre: 'Animation'}), movieRow('3', 'Plain', '3')];
  const empty = none();
  const section = buildTitleSection(sectionTitles(rows, 'movie'), categories, empty.movie, empty.genres.movie);
  assert.deepEqual([section.items[0].g, section.items[1].g, section.items[2].g], ['|comedy|', '|animation|', '']);
  assert.deepEqual(section.genres, [{key: 'animation', name: 'Animation'}, {key: 'comedy', name: 'Comedy'}]);
});

function fixtureCategories(): CategoryInput[] {
  return [{id: '1', name: 'US | Movies'}, {id: '2', name: 'FR | Films'}, {id: '3', name: 'NETFLIX MOVIES'}, {id: '4', name: 'XXX'}, {id: '5', name: 'Kids', adult: '1'}];
}
function fixtureRows() {
  return [
    movieRow('10', 'Dune (2021)', '1', {added: '1700000300', rating: '8.0'}),
    movieRow('11', 'Dune (2021) [FR]', '2', {added: '1700000400'}),
    movieRow('12', 'Amélie (2001)', '1', {added: '1700000100', rating: '8.3'}),
    movieRow('13', 'Le Film Local', '2', {added: '1700000500', rating: '9.9'}),
    movieRow('14', 'Glass Onion', '3', {added: '1700000200', tmdb: '661374'}),
    movieRow('15', 'Hot Stuff', '4', {added: '1700000600', rating: '5.0'}),
    movieRow('16', 'Cartoon Time', '5', {added: '0', rating: '6.0'}),
    movieRow('17', 'The Avengers', '1', {added: '1700000050', genre: 'Action, Science Fiction'}),
    {name: 'No id', category_id: '1'},
  ];
}
function fixturePayload() {
  return rowsPayloadWith({
    popular: [tmdbItem(438631, 'Dune', '2021', ['US'], [878]), tmdbItem(194, 'Amélie', '2001', ['FR', 'DE'], [35])],
    top_rated: [tmdbItem(194, 'Amélie', '2001', ['FR', 'DE'], [35]), tmdbItem(438631, 'Dune', '2021', ['US'], [878])],
    services: {netflix: [tmdbItem(661374, 'Glass Onion: A Knives Out Mystery', '2022', ['US'], [35, 80])]},
  }, {});
}
function fixtureSection() {
  const payload = fixturePayload();
  return buildTitleSection(sectionTitles(fixtureRows(), 'movie'), fixtureCategories(), payload.movie, payload.genres.movie);
}

test('buildTitleSection works out USA, adult, TMDB and genre facts and every list order', async () => {
  const section = fixtureSection();
  const items = section.items;
  assert.equal(items.length, 8, 'rows without an id are skipped');
  assert.equal(section.matched, 4);
  assert.deepEqual([items[0].tmdb, items[0].us, items[0].g], ['438631', true, '|878|']);
  assert.deepEqual([items[1].tmdb, items[1].us], ['438631', false], 'US title in a foreign category fails USA only');
  assert.deepEqual([items[2].tmdb, items[2].us], ['194', false], 'non-US origin fails USA only');
  assert.deepEqual([items[3].tmdb, items[3].us], ['', false], 'unmatched title in a foreign category');
  assert.deepEqual([items[4].tmdb, items[4].us], ['661374', true], 'provider TMDB id');
  assert.deepEqual([items[5].adult, items[6].adult, items[0].adult], [true, true, false], 'adult by category name and by flag');
  assert.deepEqual([items[7].tmdb, items[7].us, items[7].g], ['', true, '|28|878|'], 'unmatched title keeps provider genres mapped to TMDB');
  assert.ok(!('hint' in items[0]) && !('genre' in items[0]) && !('cat' in items[0]) && !('added' in items[0]), 'index-only fields are dropped');
  assert.equal(section.byKey.get('m14'), 4);
  assert.deepEqual(namesOf(section, section.lists.popular), ['Dune (2021)', 'Dune (2021) [FR]', 'Amélie (2001)']);
  assert.deepEqual(namesOf(section, section.lists.featured), []);
  assert.deepEqual(namesOf(section, section.lists.recent), ['Hot Stuff', 'Le Film Local', 'Dune (2021) [FR]', 'Dune (2021)', 'Glass Onion', 'Amélie (2001)', 'The Avengers']);
  assert.deepEqual(namesOf(section, section.lists.rated), ['Amélie (2001)', 'Dune (2021)', 'Dune (2021) [FR]', 'Le Film Local', 'Cartoon Time', 'Hot Stuff']);
  assert.deepEqual(namesOf(section, section.lists.netflix), ['Glass Onion']);
  assert.deepEqual(namesOf(section, section.lists.az), ['Amélie (2001)', 'The Avengers', 'Cartoon Time', 'Dune (2021)', 'Dune (2021) [FR]', 'Glass Onion', 'Hot Stuff', 'Le Film Local']);
  assert.equal(section.genres.length, 3);
  // The sliced build gives exactly the same section.
  const payload = fixturePayload();
  let pauses = 0;
  const sliced = await buildTitleSectionAsync(sectionTitles(fixtureRows(), 'movie'), fixtureCategories(), payload.movie, payload.genres.movie, async () => {pauses++;}, 3);
  assert.ok(pauses >= 2);
  assert.deepEqual(sliced, section);
});

test('pickTitles: USA only, All, adult lock, genre, one per TMDB title and paging', () => {
  const section = fixtureSection();
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.popular, {usOnly: true, adultOk: false}, 0, 20).picked), ['Dune (2021)']);
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.popular, {usOnly: false, adultOk: false}, 0, 20).picked), ['Dune (2021)', 'Amélie (2001)']);
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.recent, {usOnly: false, adultOk: true}, 0, 2).picked), ['Hot Stuff', 'Le Film Local']);
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.recent, {usOnly: false, adultOk: false}, 0, 20).picked), ['Le Film Local', 'Dune (2021) [FR]', 'Glass Onion', 'Amélie (2001)', 'The Avengers']);
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.az, {usOnly: true, adultOk: false, genre: '878'}, 0, 20).picked), ['The Avengers', 'Dune (2021)']);
  const paging = {usOnly: false, adultOk: true, seen: new Set<string>()};
  const first = pickTitles(section.items, section.lists.az, paging, 0, 3);
  const second = pickTitles(section.items, section.lists.az, paging, first.cursor, 3);
  assert.deepEqual([namesOf(section, first.picked), namesOf(section, second.picked), second.cursor], [['Amélie (2001)', 'The Avengers', 'Cartoon Time'], ['Dune (2021)', 'Glass Onion', 'Hot Stuff'], 7]);
  assert.deepEqual(pickTitles(section.items, undefined, paging, 0, 3).picked, []);
});

test('Home rows: at least 5 titles, at most 20, Continue watching first, no Popular or Featured without TMDB', () => {
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push(movieRow(String(i), 'Movie ' + i, '1', {added: '17000000' + String(i).padStart(2, '0'), rating: '7'}));
  for (let i = 31; i <= 33; i++) rows.push(movieRow(String(i), 'Netflix ' + i, '3', {added: '0'}));
  const categories = [{id: '1', name: 'Movies'}, {id: '3', name: 'Netflix'}];
  const empty = none();
  const movies = buildTitleSection(sectionTitles(rows, 'movie'), categories, empty.movie, empty.genres.movie);
  const series = buildTitleSection([], [], empty.tv, empty.genres.tv);
  const catalog = {movies, series};
  const opts = {usOnly: true, adultOk: false};
  let home = buildHomeRows(catalog, false, opts, []);
  assert.deepEqual(home.map(row => row.id), ['movies:recent', 'movies:rated']);
  assert.deepEqual([home[0].refs.length, movies.items[home[0].refs[0].idx].name], [20, 'Movie 30']);
  const refs = Array.from({length: 6}, (_, idx) => ({type: 'movies' as const, idx}));
  home = buildHomeRows(catalog, false, opts, refs);
  assert.deepEqual([home[0].id, home[0].refs.length], ['continue', 6]);
  home = buildHomeRows(catalog, false, opts, [{type: 'movies', idx: 0}]);
  assert.equal(home[0].id, 'movies:recent', 'Continue watching needs 5 titles on Home');
  const specs = homeRowSpecs(true);
  assert.deepEqual([specs[0].title, specs[3].title, specs[4].title, specs[5].title, specs[19].title, specs[20].title, specs[specs.length - 1].title],
    ['Popular – Movies', 'Featured – Series', 'Netflix – Movies', 'Netflix – Series', 'Peacock – Series', 'Recently added – Movies', 'Top rated – Series']);
  assert.equal(homeRowSpecs(false).length, 20);
});

test('search: at least 2 letters, names starting with the text first, one per TMDB title', () => {
  const section = fixtureSection();
  const opts = {usOnly: false, adultOk: false};
  assert.deepEqual(namesOf(section, searchTitles(section.items, 'dune', opts, 10)), ['Dune (2021)']);
  assert.deepEqual(namesOf(section, searchTitles(section.items, 'on', opts, 10)), ['Glass Onion']);
  assert.deepEqual(namesOf(section, searchTitles(section.items, 't', opts, 10)), []);
  assert.deepEqual(namesOf(section, searchTitles(section.items, 'le', {usOnly: true, adultOk: false}, 10)), []);
  assert.deepEqual(namesOf(section, searchTitles(section.items, 'The', opts, 10)), ['The Avengers'], 'case does not matter');
  assert.equal(foldText('Amélie, Ça, NAÏVE'), 'amelie, ca, naive');
  const accents = buildTitleSection([titleFromCompact('movie', {id: '1', name: 'Amélie (2001)'}), titleFromCompact('movie', {id: '2', name: 'Les Misérables'})], [], emptyRowsSection(), []);
  const all = {usOnly: false, adultOk: false};
  assert.deepEqual(namesOf(accents, searchTitles(accents.items, 'amelie', all, 10)), ['Amélie (2001)'], 'accents do not matter');
  assert.deepEqual(namesOf(accents, searchTitles(accents.items, 'AMÉ', all, 10)), ['Amélie (2001)']);
  assert.deepEqual(namesOf(accents, searchTitles(accents.items, 'miserables', all, 10)), ['Les Misérables']);
});

test('Discover lists', () => {
  assert.deepEqual(discoverLists(true).map(list => list.name), ['Popular', 'Featured', 'Top rated', 'Recently added', 'A–Z', 'Netflix', 'Disney+', 'Max', 'Prime Video', 'Apple TV+', 'Hulu', 'Paramount+', 'Peacock']);
  assert.equal(discoverLists(false)[0].key, 'rated');
});

test('M3U movie and series entries become titles keyed by their channel', () => {
  const movie = titleFromM3u('movie', 'a'.repeat(43), 'Heat (1995)', 'https://img/heat.jpg', 'VOD | Movies', 'mkv');
  assert.deepEqual([movie.key, movie.year, movie.channel, movie.ext, libraryTypeOf(movie.key)], ['m~' + 'a'.repeat(43), '1995', 'a'.repeat(43), 'mkv', 'movies']);
  const episode = titleFromM3u('episode', 'b'.repeat(43), 'Show S01E02', '', '', 'mp4');
  assert.deepEqual([episode.key, episode.kind, episode.cat, libraryTypeOf(episode.key)], ['s~' + 'b'.repeat(43), 'episode', 'Other', 'series']);
  const empty = none();
  const section = buildTitleSection([movie], [{id: 'VOD | Movies', name: 'VOD | Movies'}], empty.movie, empty.genres.movie);
  assert.equal(section.items[0].channel, 'a'.repeat(43));
});

// ------------------------------------------------------------------ Library

test('the Library store: favorites, progress, next episode, history and caps', () => {
  let store: Library = libraryNew('line1');
  let result = libraryToggleFavorite(store, 'm1'); store = result.library; assert.equal(result.favorite, true);
  result = libraryToggleFavorite(store, 's2'); store = result.library; assert.equal(result.favorite, true);
  assert.deepEqual(store.fav, ['s2', 'm1']);
  result = libraryToggleFavorite(store, 'm1'); store = result.library; assert.equal(result.favorite, false);
  assert.deepEqual([libraryIsFavorite(store, 's2'), libraryIsFavorite(store, 'm1')], [true, false]);
  for (let i = 1; i <= 160; i++) store = libraryToggleFavorite(store, 'm' + i).library;
  assert.deepEqual([store.fav.length, store.fav[0]], [150, 'm160']);

  store = libraryNew('line1');
  store = libraryRecordProgress(store, {k: 'm1', p: 600, d: 6000}, 100);
  store = libraryRecordProgress(store, {k: 'm2', p: 10, d: 6000}, 101);
  assert.deepEqual(libraryKeys(store.prog), ['m1'], 'under 15 seconds is not recorded');
  store = libraryRecordProgress(store, {k: 'm1', p: 5, d: 6000}, 102);
  assert.equal(store.prog[0].p, 600, 'a short stop keeps the old position');
  store = libraryRecordProgress(store, {k: 's3', p: 300, d: 2400, e: '77', l: 'S1 E2', n: 1}, 103);
  assert.deepEqual(libraryKeys(store.prog), ['s3', 'm1']);
  assert.equal(progressFraction(libraryProgress(store, 's3')), 0.125);
  store = libraryRecordProgress(store, {k: 'm1', p: 5800, d: 6000}, 104);
  assert.deepEqual(libraryKeys(store.prog), ['s3'], 'finished movie leaves Continue watching');
  store = libraryRecordProgress(store, {k: 's3', e: '78', l: 'S1 E3', n: 2, p: 0, d: 0, nx: true}, 105);
  assert.deepEqual([store.prog[0].l, progressFraction(store.prog[0]), store.prog[0].t], ['S1 E3', 0, 105], 'next episode is kept');
  store = libraryRemoveProgress(store, 's3');
  assert.deepEqual(store.prog, []);
  for (let i = 1; i <= 35; i++) store = libraryRecordProgress(store, {k: 'm' + i, p: 100, d: 1000}, 200 + i);
  assert.deepEqual([store.prog.length, store.prog[0].k], [30, 'm35']);

  store = libraryRecordWatched(store, 'm1', 1);
  store = libraryRecordWatched(store, 's2', 2);
  store = libraryRecordWatched(store, 'm1', 3);
  assert.deepEqual(libraryKeys(store.seen), ['m1', 's2']);
  for (let i = 1; i <= 40; i++) store = libraryRecordWatched(store, 'm' + i, 10 + i);
  assert.equal(store.seen.length, 30);

  assert.equal(libraryFor(null, 'line1').line, 'line1');
  assert.deepEqual(libraryFor({line: 'other', fav: ['m1']}, 'line1').fav, [], 'another line starts empty');
  assert.deepEqual(libraryFor({line: 'line1', fav: ['m1'], prog: 'x'}, 'line1').prog, [], 'damaged lists are reset');
  assert.deepEqual(libraryFor({line: 'line1', fav: ['m1', '<script>', 7, 's~' + 'c'.repeat(43)], prog: [{k: 'm1', p: 'x', d: 5}, {k: 'bad'}], seen: [{k: 'm2', t: 3}, 'x']}, 'line1'),
    {v: 1, line: 'line1', fav: ['m1', 's~' + 'c'.repeat(43)], prog: [{k: 'm1', p: 0, d: 5}], seen: [{k: 'm2', t: 3}]}, 'invalid entries are dropped');
  assert.deepEqual([libraryTypeOf('m1'), libraryTypeOf('s2')], ['movies', 'series']);

  const section = fixtureSection();
  const empty = none();
  const catalog = {movies: section, series: buildTitleSection([], [], emptyRowsSection(), empty.genres.tv)};
  assert.deepEqual(libraryRefs(['m10', 'm15', 'm99', 's1', 'm12'], catalog, {usOnly: true, adultOk: false}), [{type: 'movies', idx: 0}]);
});

test('clock text', () => {
  assert.deepEqual([clockText(0), clockText(75), clockText(3723), clockText(36000), clockText(-5)], ['0:00', '1:15', '1:02:03', '10:00:00', '0:00']);
});
