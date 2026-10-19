// The web player's browse rules (lib/browse.ts): every case of docs/browse-cases.json, which every Tuner app's tests
// run too, and the web player's own cases, so the web player and the Tuner apps pick, match and order titles the same
// way (docs/browse.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SERVICES as BROWSE_SERVICES, browseServices, buildHomeRows, buildTitleSection, buildTitleSectionAsync, categoryGenreKeys, categoryServices, clockText,
  compactCategory, compactXtream, cutText, discoverLists, emptyRowsSection, foldText, genreTable, homeRowSpecs, isAdultName, isForeignCategory, libraryFor, libraryIsFavorite,
  libraryKeys, libraryNew, libraryProgress, libraryRecordProgress, libraryRecordWatched, libraryRefs, libraryRemoveProgress, libraryToggleFavorite,
  libraryTypeOf, matchTmdb, normalizeTitle, originCountries, parseRowsPayload, pickTitles, progressFraction, providerGenreKeys, providerTmdbId, searchTitles,
  titleFromCompact, titleFromM3u, titleYearOf, tmdbIndex, trimEnds, unicodeSpaces, yearOfText, type BrowseTitle, type CategoryInput, type Library, type TitleSection,
} from '../lib/browse.ts';
import {isAdultGroup, parseM3U, readExtinf, trimField} from '../lib/player-data.ts';
import {readJsonArray} from '../lib/player-vod-data.ts';
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
/** A text from code points, so invisible and look-alike characters stay readable in this file. */
const C = (...codes: number[]) => String.fromCodePoint(...codes);

// ------------------------------------------------------------------ the shared cases (docs/browse-cases.json)

type SharedCase =
  | {kind: 'category'; name: string; foreign: boolean}
  | {kind: 'normalize'; input: string; title: string; year: string}
  | {kind: 'usa'; category: string | string[]; origin: string[] | null; expect: boolean}
  | {kind: 'tmdb'; json: string; expect: string | null}
  | {kind: 'm3u'; text: string; expect: {name: string; group: string}[]};
const SHARED_CASES: SharedCase[] = JSON.parse(readFileSync(new URL('../../docs/browse-cases.json', import.meta.url), 'utf8'));
const sharedCases = <K extends SharedCase['kind']>(kind: K) => SHARED_CASES.filter((item): item is Extract<SharedCase, {kind: K}> => item.kind === kind);

/**
 * USA only for one title of a shared usa case, through what the web player runs: Xtream rows compacted on the server,
 * then the browse index. layout "ids": one row with category_id and category_ids; "rows": one row per category (a
 * provider lists a title once in each of its categories). origin null: no TMDB title, so the title is unmatched.
 */
function usaThroughIndex(category: string | string[], origin: string[] | null, layout: 'ids' | 'rows') {
  const categories = (typeof category === 'string' ? [category] : category).map((name, i) => ({id: String(i + 1), name}));
  const ids = categories.map(item => item.id);
  const row = {stream_id: '7', name: 'Shared Case (2020)', stream_icon: '', container_extension: 'mp4'};
  const rows = layout === 'ids' ? [{...row, category_id: ids[0] || '', category_ids: ids.map(Number)}]
    : ids.length ? ids.map(id => ({...row, category_id: id})) : [row];
  const payload = rowsPayloadWith(origin === null ? {} : {popular: [tmdbItem(77, 'Shared Case', '2020', origin, [])]}, {});
  const section = buildTitleSection(sectionTitles(rows, 'movie'), categories, payload.movie, payload.genres.movie);
  assert.equal(section.items.length, rows.length);
  assert.deepEqual(section.items.map(item => item.tmdb), rows.map(() => origin === null ? '' : '77'), 'matched only when there is a TMDB title');
  const verdicts = [...new Set(section.items.map(item => item.us))];
  assert.equal(verdicts.length, 1, 'every row of one title gets the same verdict');
  return verdicts[0];
}

test('docs/browse-cases.json: the file has every kind of case and nothing else', () => {
  const kinds = ['category', 'normalize', 'usa', 'tmdb', 'm3u'];
  assert.ok(SHARED_CASES.length >= 200, 'cases loaded: ' + SHARED_CASES.length);
  assert.deepEqual(SHARED_CASES.filter(item => !kinds.includes(item.kind)), []);
  for (const kind of kinds) assert.ok(SHARED_CASES.some(item => item.kind === kind), kind);
});

test('docs/browse-cases.json: the category filter', () => {
  const wrong = sharedCases('category').filter(item => isForeignCategory(item.name) !== item.foreign).map(item => item.name);
  assert.deepEqual(wrong, []);
});

test('docs/browse-cases.json: normalized titles and years from the name', () => {
  const wrong = sharedCases('normalize').map(item => ({input: item.input, title: normalizeTitle(item.input), year: titleYearOf(item.input), want: {title: item.title, year: item.year}}))
    .filter(item => item.title !== item.want.title || item.year !== item.want.year);
  assert.deepEqual(wrong, []);
});

test('docs/browse-cases.json: USA only, with categories as category_ids and as one row per category', () => {
  for (const layout of ['ids', 'rows'] as const) {
    const wrong = sharedCases('usa').filter(item => usaThroughIndex(item.category, item.origin, layout) !== item.expect).map(item => JSON.stringify([item.category, item.origin]));
    assert.deepEqual(wrong, [], layout);
  }
});

test('docs/browse-cases.json: provider TMDB ids, read as the server reads a provider list into the compact catalogue', async () => {
  const cases = sharedCases('tmdb');
  // lib/player-vod.ts reads get_vod_streams and get_series as a stream (readJsonArray, JSON.parse per row) and
  // compacts each row: here every case's row is one row of such a list, cut into small chunks.
  const bytes = new TextEncoder().encode('[' + cases.map(item => item.json).join(',\n') + ']');
  const body = new ReadableStream<Uint8Array>({start(controller) {
    for (let at = 0; at < bytes.length; at += 61) controller.enqueue(bytes.slice(at, at + 61));
    controller.close();
  }});
  const rows: Record<string, unknown>[] = [];
  const read = await readJsonArray(body, row => {rows.push(row as Record<string, unknown>);}, {maxBytes: bytes.length, maxItems: cases.length});
  assert.deepEqual([read.items, read.skipped, read.truncated], [cases.length, 0, false]);
  const wrong = cases.map((item, i) => {
    const row = rows[i];
    assert.deepEqual(row, JSON.parse(item.json), 'the list reader gives the row JSON.parse gives');
    // A case's row may lack the id and name a catalogue row needs; its own keys come last.
    const kind = 'series_id' in row && !('stream_id' in row) ? 'series' : 'movie';
    const compact = compactXtream(kind, {stream_id: '7', series_id: '7', name: 'Case', ...row});
    return {json: item.json, id: providerTmdbId(row) || null, compact: compact ? compact.tmdb ?? null : 'no row', expect: item.expect};
  }).filter(item => item.id !== item.expect || item.compact !== item.expect);
  assert.deepEqual(wrong, []);
});

/**
 * One title named name, as the browser indexes it: its year, its normalized name (the lookup key titleSectionSteps
 * reads) and whether it matches a TMDB title listed under key and year (none when key is "").
 */
function indexedName(title: BrowseTitle, key: string, year: string) {
  const payload = rowsPayloadWith(key ? {popular: [tmdbItem(5, key, year || '2000', ['US'], [])]} : {}, {});
  const item = buildTitleSection([title], [], payload.movie, payload.genres.movie).items[0];
  return {title: normalizeTitle(item.name), year: item.year, matched: item.tmdb === '5'};
}

test('docs/browse-cases.json: every normalize case through the compact catalogue and the browse index, however long the name', () => {
  const cases = sharedCases('normalize');
  assert.ok(cases.filter(item => item.input.length > 150).length >= 10, 'names longer than 150 characters are among the cases');
  // TMDB titles are normalized as provider names are, so a case's normalized name lists a TMDB title under itself.
  assert.deepEqual(cases.filter(item => normalizeTitle(item.title) !== item.title), []);
  const wrong = cases.map(item => {
    // The server compacts the row (lib/player-vod.ts) and sends the catalogue as JSON; the browser builds it into titles.
    const compact = JSON.parse(JSON.stringify(compactXtream('movie', {stream_id: 1, name: item.input})));
    const got = indexedName(titleFromCompact('movie', compact), item.title, item.year);
    return {input: item.input, ...got, want: {title: item.title, year: item.year, matched: Boolean(item.title)}};
  }).filter(item => item.title !== item.want.title || item.year !== item.want.year || item.matched !== item.want.matched);
  assert.deepEqual(wrong, []);
});

test('docs/browse-cases.json: every normalize case as an M3U title, through the playlist reader and the browse index', () => {
  // A name holding a line end is cut into lines by the playlist itself, and an empty one is "Channel N"; every other
  // name is an entry's title whole.
  const cases = sharedCases('normalize').filter(item => !/[\r\n]/.test(item.input) && trimField(item.input));
  assert.ok(cases.length >= 160, String(cases.length));
  const channels = parseM3U('#EXTM3U\n' + cases.map((item, i) => '#EXTINF:-1 group-title="Movies",' + item.input + '\nhttp://m3u.invalid/movie/u/p/' + i + '.mp4\n').join(''));
  assert.equal(channels.length, cases.length);
  const wrong = cases.map((item, i) => {
    const got = indexedName(titleFromM3u('movie', 'c'.repeat(43), channels[i].name, '', channels[i].group, 'mp4'), item.title, item.year);
    return {input: item.input, ...got, want: {title: item.title, year: item.year, matched: Boolean(item.title)}};
  }).filter(item => item.title !== item.want.title || item.year !== item.want.year || item.matched !== item.want.matched);
  assert.deepEqual(wrong, []);
});

test('docs/browse-cases.json: M3U playlists, through the web player\'s playlist reader', () => {
  const cases = sharedCases('m3u');
  // The web player names a missing group "Other": no case expects a group of that name, so "Other" reads as none.
  assert.deepEqual(cases.filter(item => item.expect.some(entry => entry.group === 'Other')), []);
  const wrong = cases.map(item => {
    let got: {name: string; group: string}[];
    try {got = parseM3U(item.text).map(channel => ({name: channel.name, group: channel.group === 'Other' ? '' : channel.group}));}
    catch (error) {got = [{name: 'refused: ' + (error as Error).message, group: ''}];}
    return {text: item.text, got, expect: item.expect};
  }).filter(item => JSON.stringify(item.got) !== JSON.stringify(item.expect));
  assert.deepEqual(wrong, []);
});

test('M3U playlists: Channel N counts every URL line, the ones the web player leaves out too', () => {
  const playlist = [
    '#EXTM3U', 'http://m3u.invalid/live/1.ts', '#EXTINF:-1,', 'file:///etc/passwd', '#EXTINF:-1 tvg-name="",', 'not a link',
    '#EXTINF:-1,Repeated', 'http://m3u.invalid/live/1.ts', 'ftp://m3u.invalid/live/2.ts', '#EXTINF:-1 group-title="News"', 'http://m3u.invalid/live/3.ts',
    '#EXTINF:-1 tvg-name="Heat"', 'HTTPS://m3u.invalid/live/4.ts',
  ].join('\r');
  assert.deepEqual(parseM3U(playlist).map(channel => [channel.name, channel.group, channel.url]), [
    ['Channel 1', 'Other', 'http://m3u.invalid/live/1.ts'], ['Channel 6', 'News', 'http://m3u.invalid/live/3.ts'], ['Heat', 'Other', 'https://m3u.invalid/live/4.ts'],
  ]);
  // Lines are trimmed as provider fields: U+0085, U+2028 and U+2029 are spaces there, not line ends, so a line of them is
  // empty (no entry) and one before a tag or a link is taken off.
  const spaced = [C(0x85) + '#EXTM3U', C(0x85), C(0x2028, 0x2029), C(0x85) + '#EXTINF:-1,Heat' + C(0x85), C(0x2028) + 'http://m3u.invalid/live/1.ts' + C(0x85), C(0x85) + 'http://m3u.invalid/live/2.ts'];
  assert.deepEqual(parseM3U(spaced.join('\n')).map(channel => [channel.name, channel.url]), [['Heat', 'http://m3u.invalid/live/1.ts'], ['Channel 2', 'http://m3u.invalid/live/2.ts']]);
  assert.throws(() => parseM3U('#EXTM3U\r#EXTINF:-1,Heat\rfile:///etc/passwd\r'), /No channels/);
  for (const refused of ['', '\n\r\n', 'EXTM3U\n#EXTINF:-1,Heat\nhttp://m3u.invalid/live/1.ts', '#EXTINF:-1,Heat\n#EXTM3U\nhttp://m3u.invalid/live/1.ts', '#EXTM3\nhttp://m3u.invalid/live/1.ts']) {
    assert.throws(() => parseM3U(refused), /valid playlist/, JSON.stringify(refused));
  }
});

test('M3U playlists: values and the title of an #EXTINF line, as docs/browse.md reads them', () => {
  const read = (line: string) => {
    const info = readExtinf(line);
    return [Object.fromEntries(info.values), info.title];
  };
  assert.deepEqual(read('#EXTINF:-1 tvg-name="Love" group-title="Movies",Crazy, Stupid, Love (2011)'), [{'tvg-name': 'Love', 'group-title': 'Movies'}, 'Crazy, Stupid, Love (2011)']);
  assert.deepEqual(read("#EXTINF:-1 tvg-logo=\"http://img.invalid/a,b.png\" group-title='Kids, Family',Up"), [{'tvg-logo': 'http://img.invalid/a,b.png', 'group-title': 'Kids, Family'}, 'Up']);
  assert.deepEqual(read("#EXTINF:-1 tvg-name='Bob's Burgers' group-title='Kids',"), [{'tvg-name': 'Bob', 'group-title': 'Kids'}, '']);
  assert.deepEqual(read("#EXTINF:-1 tvg-id=Bob's,Heat"), [{}, 'Heat'], 'that quote opens no value');
  assert.deepEqual(read('#EXTINF:-1 tvg-name="Heat,Heat'), [{}, 'Heat'], 'a quote without its partner opens no value');
  assert.deepEqual(read('#EXTINF:-1 GROUP-Title = "A" group-title="B" xgroup-title="C",Heat group-title="D"'), [{'group-title': 'A', 'xgroup-title': 'C'}, 'Heat group-title="D"'], 'the first value; nothing after the name comma');
  assert.deepEqual(read('#EXTINF:-1 tvg-name="Heat"'), [{'tvg-name': 'Heat'}, ''], 'no name comma');
  assert.deepEqual(read('#EXTINF:-1,' + C(0xa0, 0x85) + ' Heat ' + C(0x1f, 0x3000)), [{}, 'Heat ' + C(0x1f)], 'the title is trimmed as a provider field');
  assert.equal(trimField(C(0xfeff, 0x85, 0x2028, 9, 11) + 'A' + C(0x85) + 'B' + C(0x200a, 0x205f, 32, 13, 10)), 'A' + C(0x85) + 'B');
  assert.equal(trimField(C(0x1c, 0x180e, 0x200b) + 'A' + C(0x1f)), C(0x1c, 0x180e, 0x200b) + 'A' + C(0x1f), 'U+001C to U+001F, U+180E and U+200B stay');
  // A logo is read as every value is: a comma inside the quotes is part of it, and one after the name comma is no value.
  const [movie, live] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-logo = \'https://img.invalid/a,b.jpg\',Heat (1995)\nhttp://m3u.invalid/movie/u/p/1.mp4\n#EXTINF:-1,News tvg-logo="https://img.invalid/n.jpg"\nhttp://m3u.invalid/live/u/p/2.ts');
  assert.deepEqual([movie.name, movie.logo, live.name, live.logo], ['Heat (1995)', 'https://img.invalid/a,b.jpg', 'News tvg-logo="https://img.invalid/n.jpg"', undefined]);
});

test('performance: an M3U playlist with a 190,000-character #EXTINF line and one with 50,000 entries read in well under a second', () => {
  const values = Array.from({length: 12000}, (_, i) => 'k' + i + '="v, ' + i + '"').join(' ');
  // Every quote opens a value but the last of each kind, which has no partner.
  const quotes = 'a="b '.repeat(20000) + "c='d ".repeat(20000);
  for (const [line, name] of [['#EXTINF:-1 ' + values + ' tvg-name="Heat",Ronin', 'Ronin'], ['#EXTINF:-1 ' + quotes + ',Ronin', 'Ronin'], ['#EXTINF:-1 tvg-name="' + 'x'.repeat(190000) + '"', 'x'.repeat(190000)]] as const) {
    assert.ok(line.length >= 190000, String(line.length));
    const started = performance.now();
    const channels = parseM3U('#EXTM3U\n' + line + '\nhttp://m3u.invalid/live/1.ts\n');
    const ms = performance.now() - started;
    assert.deepEqual(channels.map(channel => channel.name), [name]);
    assert.ok(ms < 50, 'took ' + ms.toFixed(1) + ' ms');
  }
  let playlist = '#EXTM3U';
  for (let i = 1; i <= 50000; i++) playlist += '\r#EXTINF:-1 tvg-id="' + i + '" tvg-name="N' + i + '" group-title="G' + (i % 100) + '",Title ' + i + '\rhttp://m3u.invalid/live/' + i + '.ts';
  const started = performance.now();
  const channels = parseM3U(playlist);
  const ms = performance.now() - started;
  assert.deepEqual([channels.length, channels[49999].name, channels[49999].group], [50000, 'Title 50000', 'G0']);
  assert.ok(ms < 1000, 'took ' + ms.toFixed(1) + ' ms');
});

// ------------------------------------------------------------------ titles

test('normalizeTitle: more names, and the name without its leading and trailing tags', () => {
  const cases: [string, string, string][] = [
    ['|US| Dune: Part Two [4K]', 'dune part two', 'pipe and bracket tags'],
    ['EN| Spider-Man: No Way Home (2021) UHD', 'spider man no way home', 'punctuation becomes spaces'],
    ["Ocean's Eleven", 'oceans eleven', 'apostrophes are dropped'],
    ['  Blade   Runner 2049  ', 'blade runner 2049', 'years inside the title stay'],
    ['Mission: Impossible – Dead Reckoning', 'mission impossible dead reckoning', 'dashes and colons'],
    ['ŁÓDŹ Story', 'lodz story', 'ł has no decomposition'],
    ['Þór', 'thor', 'þ becomes th'],
    ['ﬁnding Nemo', 'finding nemo', 'NFKD splits ligatures'],
    ['Ocean´s Eleven', 'oceans eleven', 'an acute accent used as an apostrophe is dropped before NFKD'],
  ];
  for (const [name, expected, label] of cases) assert.equal(normalizeTitle(name), expected, label);
  assert.equal(normalizeTitle('CSI: Miami', true), 'csi miami');
  assert.equal(normalizeTitle('EN | The Matrix | 1999', true), 'en the matrix 1999');
  assert.equal(normalizeTitle('|US| Dune (2021) [4K]', true), 'dune', 'step 2 still applies');
  assert.equal(normalizeTitle('Dune | 4K | EN', true), 'dune en', 'step 3.3 still applies');
  assert.equal(normalizeTitle('Dune | 4K | EN'), 'dune', 'trailing tags go before the tags between pipes');
});

test('years come from the row, then from the name', () => {
  assert.equal(titleYearOf('Dune (2021)'), '2021');
  assert.equal(titleYearOf('Dune [2021] [4K]'), '2021');
  assert.equal(titleYearOf('Blade Runner 2049'), '');
  assert.equal(titleYearOf('EN | Wonka | 2023'), '2023');
  assert.equal(yearOfText('2021-05-01'), '2021');
  assert.equal(yearOfText(' 2021.0'), '2021');
  assert.equal(yearOfText(1999), '1999');
  assert.equal(yearOfText('1850'), '1850');
  assert.equal(yearOfText('20211'), '', 'a longer number is no year');
  assert.equal(yearOfText('1799'), '');
  assert.equal(yearOfText(undefined), '');
  assert.equal(compactXtream('movie', movieRow('7', 'Heat (1995)', '1'))!.year, '1995', 'year taken from the name when the row has none');
  assert.equal(compactXtream('movie', movieRow('7', 'EN | Wonka | 2023', '1'))!.year, '2023', 'a year after a pipe');
  assert.equal(compactXtream('movie', movieRow('7', 'Heat (1995)', '1', {year: 'n/a', release_date: '', releasedate: '1996-01-01'}))!.year, '1996', 'the first usable field, releasedate last');
  assert.equal(compactXtream('movie', movieRow('7', 'Heat (1995)', '1', {year: '2001', releaseDate: '1996-01-01'}))!.year, '2001', 'year comes first');
  const series = titleFromCompact('series', compactXtream('series', {series_id: 9, name: 'Show', category_id: '2', releaseDate: '2019-01-02', last_modified: '1700000000', rating: '8.1', cover: 'c.jpg'})!);
  assert.deepEqual([series.key, series.id, series.year, series.added, series.poster, series.rating], ['s9', '9', '2019', 1700000000, 'c.jpg', 8.1], 'series row');
  const movie = titleFromCompact('movie', compactXtream('movie', movieRow('12', 'EN| Heat', '3', {added: '1700000123', rating_5based: '4', tmdb: '949', container_extension: ''}))!);
  assert.deepEqual([movie.key, movie.cat, movie.ext, movie.added, movie.rating, movie.hint, movie.year], ['m12', '3', 'mp4', 1700000123, 8, '949', ''], 'movie row');
  assert.equal(compactXtream('movie', {name: 'No id'}), null, 'a row without an id');
});

// The Unicode spaces of docs/browse.md: U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F,
// U+3000 and U+FEFF.
const UNICODE_SPACES = [0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];

test('Unicode spaces count as spaces in provider year fields, names and origins, and no other character does', () => {
  assert.equal(unicodeSpaces(UNICODE_SPACES.map(code => C(code)).join('')), ' '.repeat(UNICODE_SPACES.length));
  assert.equal(unicodeSpaces('Heat' + C(0x200b, 0x180e, 0x1f) + 'x'), 'Heat' + C(0x200b, 0x180e, 0x1f) + 'x', 'U+200B, U+180E and U+001F are not spaces');
  for (const code of UNICODE_SPACES) {
    const space = C(code), label = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
    assert.equal(yearOfText(space + '2021-05-01'), '2021', label + ' before a year field');
    assert.equal(compactXtream('movie', movieRow('7', 'Heat', '1', {year: space + '1995'}))!.year, '1995', label + ' in a row year field');
    assert.equal(compactXtream('movie', movieRow('7', 'Heat', '1', {releasedate: space + space + '1995-12-15'}))!.year, '1995', label + ' in releasedate');
    assert.equal(titleYearOf('Heat' + space + '-' + space + '1995'), '1995', label + ' around a dash');
    assert.equal(titleYearOf('Heat (' + space + '1995' + space + ')'), '1995', label + ' inside brackets');
    assert.equal(normalizeTitle('EN |' + space + 'Heat' + space + '- 4K'), 'heat', label + ' around tags');
    assert.deepEqual(originCountries([space + 'us' + space]), ['US'], label + ' around a country');
    assert.equal(isForeignCategory('Movies' + space + 'IT'), true, label + ' before IT');
  }
  for (const code of [0x200b, 0x180e, 0x1f]) {
    assert.equal(yearOfText(C(code) + '2021'), '', 'not a space: ' + code.toString(16));
    assert.equal(titleYearOf('Heat ' + C(code) + '- 1995'), '', 'not a space: ' + code.toString(16));
    assert.deepEqual(originCountries([C(code) + 'US']), [], 'not a space: ' + code.toString(16));
  }
  assert.equal(yearOfText('\t\v\f\r\n 2021'), '2021', 'the ASCII spaces of \\s');
});

test('origin countries: two ASCII letters, spaces around them allowed, upper-cased; anything else is ignored', () => {
  const examples: [unknown, string[]][] = [
    [['US'], ['US']], [[' US'], ['US']], [['us'], ['US']], [['uS', 'gb'], ['US', 'GB']], [['\tUS\n'], ['US']], [['\vUS\f\r'], ['US']],
    [['USA'], []], [[], []], [['USA', 'GB'], ['GB']], [['U.S.'], []], [['U S'], []], [[''], []], [['u' + C(0x17f)], []], [[C(0xff35, 0xff33)], []],
    [['u' + C(0x212a)], []], [[C(0x130) + 'T'], []], [['US' + C(0x200b)], []], [[1, null, true, ['US'], {}], []], ['US', []], [null, []],
  ];
  for (const [origin, countries] of examples) assert.deepEqual(originCountries(origin), countries, JSON.stringify(origin));
  // Through the rows payload: an origin with no country is unknown, as [] is.
  const payload = rowsPayloadWith({popular: [tmdbItem(1, 'One', '2020', ['USA'], []), tmdbItem(2, 'Two', '2020', [' us'], []), tmdbItem(3, 'Three', '2020', ['USA', 'GB'], [])]}, {});
  const index = tmdbIndex(payload.movie);
  assert.deepEqual(['1', '2', '3'].map(id => [index.byId.get(id)!.known, index.byId.get(id)!.us]), [[false, false], [true, true], [true, false]]);
});

// The doc's patterns for the trailing tags, built here on their own: TRAILING and YEAR_END with docs/browse.md's TAG,
// and with the TAG it had before, which matched 4K, HD, SD, UHD, FHD and HDR in two ways.
const QUALITY_TAG = '[48][Kk]|[UuFf]?[Hh][Dd]|[Ss][Dd]|[Hh][Dd][Rr](10)?|(1080|720|2160)[Pp]';
const DOC_TAG = '[A-Z0-9+]{2,4}|(?![A-Z0-9+]{2,4}(\\s|$))(' + QUALITY_TAG + ')';
const OLD_TAG = '[A-Z0-9+]{2,4}|' + QUALITY_TAG;
const trailingWith = (tag: string) => new RegExp('\\s(\\||-|–)\\s*(' + tag + ')\\s*$');
const yearEndWith = (tag: string) => new RegExp('\\s(\\||-|–)\\s*((18|19|20)[0-9]{2})(\\s+(\\||-|–)\\s*(?!(18|19|20)[0-9]{2}(\\s|$))(' + tag + '))*\\s*$');

/** Names made of a title and up to 6 tags, picked the same way every run. */
function tagChains(count: number) {
  const tokens = ['4K', '4k', '8K', 'HD', 'hd', 'Hd', 'UHD', 'uhd', 'FHD', 'fHD', 'SD', 'sd', 'HDR', 'hdr', 'HDR10', 'hdr10', 'HDR1', '1080p', '1080P', '720p', '2160P',
    'EN', 'US', 'NF', 'D+', '+', 'ABCDE', 'A', '1999', '2012', '2100', '1799', '300', 'Heat', 'x', 'HD4K', '4K+'];
  const separators = [' | ', ' - ', ' – ', ' |', ' -', '|', '-', ' ', '  |  ', '\t|\t'];
  let seed = 7;
  const pick = <T>(list: T[]) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return list[seed % list.length];
  };
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    let name = pick(['Movie', 'EN | Heat', '', 'X']);
    for (let k = pick([0, 1, 2, 3, 4, 5, 6]); k > 0; k--) name += pick(separators) + pick(tokens);
    names.push(name + pick(['', '', ' ', '\n']));
  }
  return names;
}

test('YEAR_END gives the year met taking the trailing tags off one at a time, and the new TAG reads tags as the old one did', () => {
  const trailing = trailingWith(DOC_TAG);
  // docs/browse.md's definition of the year among the trailing tags, step by step.
  const peeled = (name: string) => {
    let s = trimEnds(unicodeSpaces(name));
    const bracketed = /[(\[]\s*((18|19|20)[0-9]{2})\s*[)\]]/.exec(s);
    if (bracketed) return bracketed[1];
    for (let tag = trailing.exec(s); tag; tag = trailing.exec(s)) {
      if (/^(18|19|20)[0-9]{2}$/.test(tag[2])) return tag[2];
      s = s.slice(0, tag.index);
    }
    return '';
  };
  const short = [
    ...tagChains(3000),
    'Heat - 1995 - 4K', 'Heat - 1995 - 4K - EN | hdr10', '2012 | 1999 | EN', 'EN | 1984 | 2010', 'Heat - 1995 - 2010 - 4k', 'Heat - 1995 - Extended - 4K',
    'Heat -1995', 'Heat-1995', 'Heat - 1995-4K', 'Heat – 1995 – 1080p', 'Heat | 1995 |', 'Heat | 1995 | 2100', 'Heat | 1799', 'Heat | 1995 | US EN', 'Heat | 19950',
  ];
  for (const name of [...sharedCases('normalize').map(item => item.input), ...short]) assert.equal(titleYearOf(name), peeled(name), JSON.stringify(name));
  // The old TAG never finishes on the shared cases' 40-tag chains that end in a word, so only these short names are compared.
  const [oldTrailing, oldYearEnd, newYearEnd] = [trailingWith(OLD_TAG), yearEndWith(OLD_TAG), yearEndWith(DOC_TAG)];
  for (const name of short) {
    const s = unicodeSpaces(name);
    assert.equal(s.replace(trailing, ''), s.replace(oldTrailing, ''), 'TRAILING ' + JSON.stringify(name));
    assert.equal(newYearEnd.exec(s)?.[2], oldYearEnd.exec(s)?.[2], 'YEAR_END ' + JSON.stringify(name));
  }
});

test('performance: a name with 40 trailing quality tags normalizes and gives its year in well under 50 ms', () => {
  const chains: [string, string, string][] = [
    // [tags, normalized name, year] for "Movie - 1999" + tags + " - Extended", which YEAR_END tries in full and fails.
    [' - 4K'.repeat(40), 'movie 1999 extended', ''],
    [' | HD'.repeat(40), 'movie 1999 extended', ''],
    [' – hdr10'.repeat(20) + ' - UHD'.repeat(20), 'movie 1999 extended', ''],
  ];
  for (const [tags, title, year] of chains) {
    const name = 'Movie - 1999' + tags + ' - Extended';
    const started = performance.now();
    const result = [normalizeTitle(name), titleYearOf(name), compactXtream('movie', movieRow('7', name, '1'))!.year];
    const ms = performance.now() - started;
    assert.deepEqual(result, [title, year, undefined], JSON.stringify(tags.slice(0, 8)));
    assert.ok(ms < 50, 'took ' + ms.toFixed(1) + ' ms');
    // Without the word at the end, the year is the last one before the tags and every tag comes off.
    assert.deepEqual([normalizeTitle('Movie - 1999' + tags), titleYearOf('Movie - 1999' + tags)], ['movie', '1999']);
  }
});

test('performance: a name with 16,000 spaces inside normalizes and gives its year in well under 50 ms', () => {
  // docs/browse.md, "Trimming": a trim written as [ \t\n\x0B\f\r]+$ takes time in proportion to the square of the run.
  for (const space of [' ', '\t', C(0xa0)]) {
    const name = 'A' + space.repeat(16000) + 'B';
    const started = performance.now();
    const result = [normalizeTitle(name), titleYearOf(name), trimEnds(name).length, providerTmdbId({tmdb: '1' + space.repeat(16000) + '2'})];
    const ms = performance.now() - started;
    assert.deepEqual(result, ['a b', '', 16002, ''], JSON.stringify(space));
    assert.ok(ms < 50, JSON.stringify(space) + ' took ' + ms.toFixed(1) + ' ms');
  }
});

test('normalize step 1 and the year from a name trim tab, line feed, vertical tab, form feed, carriage return and space only', () => {
  assert.equal(trimEnds(' \t\n\v\f\r Heat \t\n\v\f\r '), 'Heat');
  const kept = C(0x1c) + C(0x1f) + C(0x180e) + C(0x200b) + C(0x85) + ' Heat ' + C(0x85) + C(0x200b) + C(0x180e) + C(0x1f) + C(0x1c);
  assert.equal(trimEnds(kept), kept, 'U+001C to U+001F, U+180E, U+200B and, until it is replaced, U+0085 stay');
  // A name made only of tags gives one result whether or not the provider trimmed it.
  for (const [name, title, year] of [[' - 1999', '1999', ''], ['- 1999', '1999', ''], ['\t| 2023 ', '2023', ''], [' | EN', 'en', ''], [' - US - 1999', 'us', '1999'], ['EN | Heat - 1995 \n', 'heat', '1995']]) {
    assert.deepEqual([normalizeTitle(name), titleYearOf(name)], [title, year], JSON.stringify(name));
    assert.deepEqual([normalizeTitle(name.trim()), titleYearOf(name.trim())], [title, year], JSON.stringify(name.trim()));
  }
  for (const code of UNICODE_SPACES) {
    const label = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
    assert.deepEqual([normalizeTitle(C(code) + ' - 1999'), titleYearOf(C(code) + ' - 1999')], ['1999', ''], label + ' is a space, then trimmed');
    // The server trims provider names (String.prototype.trim) before the browser normalizes them: the same result.
    assert.equal(compactXtream('movie', movieRow('7', C(code) + ' - 1999', '1'))!.year, undefined, label + ' through the compact catalogue');
  }
  for (const code of [0x1c, 0x1d, 0x1e, 0x1f, 0x180e, 0x200b]) {
    const label = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
    assert.deepEqual([normalizeTitle(C(code) + ' - 1999'), titleYearOf(C(code) + ' - 1999')], ['', '1999'], label + ' is not trimmed');
    const item = compactXtream('movie', movieRow('7', C(code) + ' - 1999', '1'))!;
    assert.deepEqual([item.name, item.year], [C(code) + ' - 1999', '1999'], label + ' stays through the compact catalogue');
  }
  assert.equal(normalizeTitle(C(0x1c) + ' | EN'), '', 'U+001C keeps the space before the pipe, so EN is a trailing tag');
});

test('a shortened copy of provider text is cut between whole characters, never inside a surrogate pair', () => {
  // docs/browse.md, "Long names". U+1F600 is two UTF-16 units, a surrogate pair.
  const pair = C(0x1f600);
  assert.equal(cutText('abc', 3), 'abc');
  assert.equal(cutText('abcd', 3), 'abc');
  assert.equal(cutText('ab' + pair + 'c', 3), 'ab', 'a cut after the first half of the pair leaves the pair out');
  assert.equal(cutText('ab' + pair + 'c', 4), 'ab' + pair, 'a pair that fits stays whole');
  assert.equal(cutText('a' + pair, 3), 'a' + pair, 'a text that fits is not cut');
  assert.equal(cutText(pair, 1), '');
  // The compact catalogue's genre is cut at 100 units.
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', genre: 'g'.repeat(99) + pair + 'tail'})!.genre, 'g'.repeat(99));
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', genre: 'g'.repeat(98) + pair + 'tail'})!.genre, 'g'.repeat(98) + pair);
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', genre: ' ' + 'g'.repeat(120)})!.genre, 'g'.repeat(100), 'trimmed, then cut');
});

test('compact catalogue rows keep only what browsing needs, within limits', () => {
  const item = compactXtream('movie', {
    num: 1, name: 'x'.repeat(500), stream_type: 'movie', stream_id: 42, stream_icon: 'https://image.tmdb.org/t/p/w600/a.jpg', rating: '7.25', rating_5based: 3.6,
    added: '1700000000', is_adult: '0', category_id: '12', category_ids: [12, 13], container_extension: 'MKV', custom_sid: 'secret', direct_source: 'http://136.148.65.1/private', tmdb: '603', genre: 'Action',
  })!;
  assert.deepEqual(Object.keys(item).sort(), ['added', 'cat', 'cats', 'ext', 'genre', 'id', 'name', 'poster', 'rating', 'tmdb']);
  assert.deepEqual(item.cats, ['13'], 'category_ids other than category_id');
  assert.equal(item.name, 'x'.repeat(500), 'a long name is kept whole (docs/browse.md, "Long names")');
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
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', category_id: '1', category_ids: ['1', 1]})!.cats, undefined, 'no other categories');
  assert.deepEqual(compactXtream('movie', {stream_id: '5', name: 'A', category_ids: [4, '5', 4, [6], null]})!.cats, ['4', '5'], 'no category_id');
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', category_ids: Array.from({length: 30}, (_, i) => i + 1)})!.cats!.length, 10, 'at most 10 more');
  assert.equal(compactXtream('movie', {stream_id: '5', name: 'A', added: '1700000000123'})!.added, 1700000000, 'milliseconds become seconds');
  assert.equal(compactXtream('series', {series_id: '5', name: 'A', last_modified: 1700000000123})!.added, 1700000000);
  assert.equal(titleFromCompact('movie', {id: '5', name: 'A', added: 1700000000123}).added, 1700000000, 'also in a catalogue compacted before');
  assert.deepEqual(titleFromCompact('movie', {id: '5', name: 'A', cat: '1', cats: ['2']}).cats, ['2']);
  assert.deepEqual(compactCategory({category_id: '3', category_name: 'XXX', parent_id: 0, is_adult: 1}), {id: '3', name: 'XXX', adult: true});
  // A long category name is kept whole: USA only reads a tag at its end.
  const long = compactCategory({category_id: '4', category_name: 'Movies ' + 'and more '.repeat(20) + '| FR'})!;
  assert.deepEqual([long.name.length, isForeignCategory(long.name)], [191, true]);
  assert.equal(compactCategory({category_name: 'No id'}), null);
});

test('provider TMDB ids', () => {
  assert.equal(providerTmdbId({tmdb: '603'}), '603');
  assert.equal(providerTmdbId({tmdb_id: 603}), '603');
  assert.equal(providerTmdbId({info: {tmdb_id: '603'}}), '603');
  assert.equal(providerTmdbId({info: {tmdb: '603'}}), '603');
  assert.equal(providerTmdbId({tmdb: '603.0'}), '603', 'a trailing .0');
  assert.equal(providerTmdbId({tmdb: ' 0603 '}), '603');
  assert.equal(providerTmdbId({tmdb: 'tt0133093', tmdb_id: '', info: {tmdb_id: '0', tmdb: '949'}}), '949', 'the first usable value');
  assert.equal(providerTmdbId({tmdb: '123456789012'}), '123456789012');
  for (const value of ['0', '000', '0.0', 'tt0133093', '603.5', '1234567890123', '-603', '']) assert.equal(providerTmdbId({tmdb: value}), '', value);
  // The value's JSON type decides, never its text (docs/browse.md, Matching step 1).
  assert.equal(providerTmdbId({tmdb: 1e3}), '1000', 'a number written with an exponent');
  assert.equal(providerTmdbId({tmdb: '1e3'}), '', 'the same text as a string');
  assert.equal(providerTmdbId({tmdb: 999999999999}), '999999999999');
  assert.equal(providerTmdbId({tmdb: ['123'], tmdb_id: '77'}), '77', 'an array is no id, and the next key is read');
  for (const value of [1.5, -5, 0, -0, 1e12, NaN, Infinity, true, null, {id: 123}, ['123'], [123]]) {
    assert.equal(providerTmdbId({tmdb: value}), '', typeof value + ' ' + String(value));
  }
  assert.equal(providerTmdbId({tmdb: C(0x85) + '0123' + C(0x3000)}), '123', 'trimmed as a provider field: the Unicode spaces too, U+0085 included');
  for (const code of [0x1f, 0x180e, 0x200b]) assert.equal(providerTmdbId({tmdb: C(code) + '123'}), '', 'U+' + code.toString(16).toUpperCase().padStart(4, '0') + ' is not trimmed');
  assert.equal(providerTmdbId({tmdb: C(0x661, 0x662, 0x663)}), '', 'ASCII digits only');
});

test('USA only: more category names', () => {
  for (const name of ['IT: Serie TV', 'LAT - Peliculas', 'IN | Bollywood', 'NL Films', 'CA | Movies', 'ES | Cine', 'Movies (Spanish)', 'IN-Movies', 'IT ( Drama )', '[ IN ] Movies', 'Movies / IT']) {
    assert.ok(isForeignCategory(name), 'foreign category ' + name);
  }
  for (const name of ['Movies in 4K', 'US | Action', 'EN | Comedy', 'Kids', 'Drama', 'Adventure', 'Top Picks', 'it | Movies', 'Movies (in)', 'TV IN HD']) {
    assert.ok(!isForeignCategory(name), 'US category ' + name);
  }
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
  assert.equal(matchTmdb(index, '999', 'Dune', '2021'), null, 'an unknown provider id does not fall back to the title');
  assert.equal(matchTmdb(index, '', 'Dune (2021) [4K]', '2021')!.id, '1', 'title and year');
  assert.equal(matchTmdb(index, '', 'Dune', '2022')!.id, '1', 'year off by one');
  assert.equal(matchTmdb(index, '', 'Dune', '2023'), null, 'year off by two');
  assert.equal(matchTmdb(index, '', 'Dune', '')!.id, '1', 'no year, one candidate');
  assert.equal(matchTmdb(index, '', 'The Lion King', ''), null, 'no year, two candidates');
  assert.equal(matchTmdb(index, '', 'Lion King', '1994')!.id, '3', 'exact year wins');
  assert.equal(matchTmdb(index, '', 'Lion King', '1995')!.id, '3', 'else the first within a year');
  assert.equal(matchTmdb(index, '', 'Amelie', '2001')!.id, '4', 'accent-free provider title');
  assert.equal(matchTmdb(index, '', '', '2021'), null, 'empty title');
  assert.equal(matchTmdb(index, '', 'EN | Dune | 2021', '2021', 'dune')!.id, '1', 'a normalized name worked out before');
});

test('matching: the name without step 3 when the normalized name finds nothing', () => {
  const payload = rowsPayloadWith({popular: [tmdbItem(1366, 'Rocky II', '1979', ['US'], []), tmdbItem(1367, 'Rocky', '1976', ['US'], []), tmdbItem(1620, 'CSI: Miami', '2002', ['US'], [])]}, {});
  const index = tmdbIndex(payload.movie);
  assert.equal(matchTmdb(index, '', 'Rocky - II', '1979')!.id, '1366', '"rocky" finds no title of that year, "rocky ii" does');
  assert.equal(matchTmdb(index, '', 'Rocky - II', '1977')!.id, '1367', 'the normalized name comes first');
  assert.equal(matchTmdb(index, '', 'Rocky - III', '1982'), null);
  assert.equal(matchTmdb(index, '9', 'Rocky - II', '1979'), null, 'never with a provider id');
  assert.equal(matchTmdb(index, '', 'CSI: Miami', '2002')!.id, '1620', 'TMDB titles are normalized the same way ("miami")');
  const section = buildTitleSection([titleFromCompact('movie', {id: '5', name: 'Rocky - II', year: '1979'}), titleFromCompact('movie', {id: '6', name: 'EN | Rocky - II', year: '1979'})], [], payload.movie, []);
  assert.deepEqual(section.items.map(item => item.tmdb), ['1366', ''], '"en rocky ii" is not "rocky ii"');
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
  // The dubbed copy is newer, but the copy that passes USA only opens, where the first visible copy stands.
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.recent, {usOnly: false, adultOk: false}, 0, 20).picked), ['Le Film Local', 'Dune (2021)', 'Glass Onion', 'Amélie (2001)', 'The Avengers']);
  assert.deepEqual(namesOf(section, pickTitles(section.items, section.lists.az, {usOnly: true, adultOk: false, genre: '878'}, 0, 20).picked), ['The Avengers', 'Dune (2021)']);
  const paging = {usOnly: false, adultOk: true, seen: new Set<string>()};
  const first = pickTitles(section.items, section.lists.az, paging, 0, 3);
  const second = pickTitles(section.items, section.lists.az, paging, first.cursor, 3);
  assert.deepEqual([namesOf(section, first.picked), namesOf(section, second.picked), second.cursor], [['Amélie (2001)', 'The Avengers', 'Cartoon Time'], ['Dune (2021)', 'Glass Onion', 'Hot Stuff'], 7]);
  assert.deepEqual(pickTitles(section.items, undefined, paging, 0, 3).picked, []);
});

test('copies of one TMDB title: one poster, opening the copy that passes USA only, then the newest', () => {
  const categories = [{id: '1', name: 'EN | Movies'}, {id: '2', name: 'FR | Films'}, {id: '3', name: 'XXX'}];
  const rows = [
    movieRow('20', 'Dune (2021)', '1', {added: '100'}),
    movieRow('21', 'Dune (2021) [4K]', '3', {added: '300'}),
    movieRow('22', 'FR | Dune (2021)', '2', {added: '500'}),
    movieRow('23', 'Dune [2021]', '1', {added: '300'}),
    movieRow('24', 'Heat (1995)', '1', {added: '50'}),
  ];
  const payload = rowsPayloadWith({popular: [tmdbItem(438631, 'Dune', '2021', ['US'], [878])]}, {});
  const section = buildTitleSection(sectionTitles(rows, 'movie'), categories, payload.movie, payload.genres.movie);
  assert.deepEqual(section.items[0].copies, [1, 3, 0, 2], 'passing first, then the newest, then catalogue order');
  assert.ok(section.items.slice(0, 4).every(item => item.copies === section.items[0].copies));
  assert.equal(section.items[4].copies, undefined, 'a title with one copy');
  const pick = (list: number[], usOnly: boolean, adultOk: boolean) => namesOf(section, pickTitles(section.items, list, {usOnly, adultOk}, 0, 20).picked);
  assert.deepEqual(pick(section.lists.popular, true, true), ['Dune (2021) [4K]']);
  assert.deepEqual(pick(section.lists.popular, true, false), ['Dune [2021]'], 'the best copy that is visible');
  assert.deepEqual(pick(section.lists.recent, false, false), ['Dune [2021]', 'Heat (1995)'], 'where the first visible copy stands');
  assert.deepEqual(pick(section.lists.recent, false, true), ['Dune (2021) [4K]', 'Heat (1995)']);
});

test('USA only reads every category of a title; ids missing from the category list are left out', () => {
  const categories = [{id: '1', name: 'EN | Movies'}, {id: '2', name: 'FR | Films'}];
  const rows = [
    movieRow('30', 'Only Unknown', '99'),
    movieRow('31', 'Unknown And French', '99', {category_ids: [99, 2]}),
    movieRow('32', 'French And English', '2', {category_ids: ['2', '1']}),
    movieRow('33', 'Listed Twice', '2'),
    movieRow('33', 'Listed Twice', '1'),
    movieRow('34', 'No Category', ''),
  ];
  const empty = none();
  const section = buildTitleSection(sectionTitles(rows, 'movie'), categories, empty.movie, empty.genres.movie);
  assert.deepEqual(section.items.map(item => [item.name, item.us]), [
    ['Only Unknown', true], ['Unknown And French', false], ['French And English', true], ['Listed Twice', true], ['Listed Twice', true], ['No Category', true],
  ]);
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
