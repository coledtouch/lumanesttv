// The web player's Movies & Series server helpers (lib/player-vod-data.ts): Xtream requests, streamed JSON lists,
// poster links and details.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTER_FILE, VodError, carriesSecret, classifyPoster, compactMovieInfo, compactSeriesInfo, createPosterBook, durationOf, entryExt, entryKind, imageAddress,
  isPosterFile, readJsonArray, sniffImage, validImageToken, vodPlayURL, xtreamServer, xtreamURL, type ImageToken,
} from '../lib/player-vod-data.ts';
import {open, mac, seal, sealStable} from '../lib/player-crypto.ts';

const SECRET = 'a'.repeat(64);
const login = {username: 'runtime-user', password: 'p&ss#w+rd é'};

/** A body stream that hands out the text in the given pieces (split at arbitrary byte offsets). */
function streamOf(parts: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  let i = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) {controller.close(); return;}
      const part = parts[i++];
      controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
    },
    cancel() {cancelled = true;},
  });
  return {stream, cancelled: () => cancelled};
}
function bytesSplit(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) parts.push(bytes.slice(i, i + size));
  return parts;
}
async function readAll(parts: (string | Uint8Array)[], limits: Partial<Parameters<typeof readJsonArray>[2]> = {}) {
  const items: unknown[] = [];
  const result = await readJsonArray(streamOf(parts).stream, item => items.push(item), {maxBytes: 1 << 20, maxItems: 1000, ...limits});
  return {items, result};
}

test('the Xtream server setting: a bare host means https, nothing but an origin is accepted', () => {
  assert.deepEqual(xtreamServer('tv.lumanest.tv'), {server: 'https://tv.lumanest.tv'});
  assert.deepEqual(xtreamServer(' https://tv.lumanest.tv/// '), {server: 'https://tv.lumanest.tv'});
  assert.deepEqual(xtreamServer('http://136.148.65.50'), {server: 'http://136.148.65.50'});
  assert.deepEqual(xtreamServer('https://tv.lumanest.tv:443'), {server: 'https://tv.lumanest.tv'});
  assert.deepEqual(xtreamServer(''), {error: 'not_configured'});
  assert.deepEqual(xtreamServer(undefined), {error: 'not_configured'});
  for (const value of ['https://tv.lumanest.tv/panel', 'https://tv.lumanest.tv?x=1', 'https://user:pw@tv.lumanest.tv', 'http://tv.lumanest.tv:8080', 'javascript:alert(1)', 'https://tv.lumanest.tv#x', 'ftp://tv.lumanest.tv']) {
    assert.deepEqual(xtreamServer(value), {error: 'server_not_approved'}, value);
  }
});

test('Xtream requests: fixed actions, numeric ids, the login encoded', () => {
  const url = new URL(xtreamURL('https://tv.lumanest.tv', login, 'get_vod_streams'));
  assert.equal(url.origin + url.pathname, 'https://tv.lumanest.tv/player_api.php');
  assert.equal(url.searchParams.get('username'), 'runtime-user');
  assert.equal(url.searchParams.get('password'), 'p&ss#w+rd é');
  assert.equal(url.searchParams.get('action'), 'get_vod_streams');
  assert.equal([...url.searchParams.keys()].length, 3);
  assert.equal(new URL(xtreamURL('https://tv.lumanest.tv', login, 'get_series_info', '42')).searchParams.get('series_id'), '42');
  assert.equal(new URL(xtreamURL('https://tv.lumanest.tv', login, 'get_vod_info', '7')).searchParams.get('vod_id'), '7');
  assert.throws(() => xtreamURL('https://tv.lumanest.tv', login, 'get_live_streams' as never), VodError);
  for (const id of ['', '1&action=get_live_streams', '12345678901', '-1', '1.5', undefined]) {
    assert.throws(() => xtreamURL('https://tv.lumanest.tv', login, 'get_series_info', id as string), VodError, String(id));
  }
  assert.throws(() => xtreamURL('https://tv.lumanest.tv', login, 'get_vod_streams', '1'), VodError, 'list actions take no id');
});

test('movie and episode addresses', () => {
  assert.equal(vodPlayURL('https://tv.lumanest.tv', {username: 'u', password: 'p'}, 'movie', '123', 'mp4'), 'https://tv.lumanest.tv/movie/u/p/123.mp4');
  assert.equal(vodPlayURL('http://136.148.65.50', {username: 'u ser', password: 'p/w'}, 'episode', '456', 'mkv'), 'http://136.148.65.50/series/u%20ser/p%2Fw/456.mkv');
  for (const [id, ext] of [['12a', 'mp4'], ['1', 'exe'], ['1', 'mp4?x'], ['', 'mp4']]) assert.throws(() => vodPlayURL('https://tv.lumanest.tv', login, 'movie', id, ext), VodError);
});

test('M3U entries: movie, series or live from the address', () => {
  assert.equal(entryKind('https://tv.lumanest.tv/movie/u/p/1.mkv'), 'movie');
  assert.equal(entryKind('https://tv.lumanest.tv/series/u/p/2.mp4'), 'series');
  assert.equal(entryKind('https://cdn.example/films/heat.MP4'), 'movie');
  assert.equal(entryKind('https://cdn.example/films/heat.avi'), 'movie');
  assert.equal(entryKind('https://tv.lumanest.tv/live/u/p/1.mp4'), 'live', 'a /live/ path stays live');
  assert.equal(entryKind('https://tv.lumanest.tv/live/u/p/1.m3u8'), 'live');
  assert.equal(entryKind('http://tv.lumanest.tv/u/p/1.ts'), 'live');
  assert.equal(entryKind('not a url'), 'live');
  assert.equal(entryExt('https://tv.lumanest.tv/movie/u/p/1.MKV?token=x'), 'mkv');
  assert.equal(entryExt('https://tv.lumanest.tv/movie/u/p/1'), '');
});

test('streamed lists: elements across chunk boundaries, strings, escapes and multibyte text', async () => {
  const list = [
    {stream_id: 1, name: 'Amélie [4K] {x} "quoted" \\ back\\slash', category_ids: [1, [2, 3]], info: {a: '}]'}},
    {stream_id: 2, name: '日本語のタイトル', note: 'brackets ] } [ { in a string'},
    {stream_id: 3, name: 'emoji 🎬', escaped: 'A\n\t"'},
  ];
  const text = '﻿ \n' + JSON.stringify(list, null, 1);
  for (const size of [1, 2, 3, 7, 64, 100000]) {
    const {items, result} = await readAll(bytesSplit(text, size));
    assert.deepEqual(items, list, 'chunk size ' + size);
    assert.deepEqual([result.items, result.skipped, result.truncated], [3, 0, false]);
  }
  assert.deepEqual((await readAll(['  [ ]  '])).items, []);
  assert.deepEqual((await readAll(['[', ']'])).items, []);
  assert.deepEqual((await readAll(['[1, "a", {"x": 1}, null, [2]]'])).items, [{x: 1}, [2]], 'only objects and arrays are elements');
});

test('streamed lists: limits, objects of objects, refused logins and bad answers', async () => {
  const many = JSON.stringify(Array.from({length: 50}, (_, i) => ({stream_id: i})));
  const {stream, cancelled} = streamOf(bytesSplit(many, 10));
  const items: unknown[] = [];
  const truncated = await readJsonArray(stream, item => items.push(item), {maxBytes: 1 << 20, maxItems: 5});
  assert.deepEqual([truncated.items, truncated.truncated, items.length], [5, true, 5]);
  assert.ok(cancelled(), 'the rest of the body is not read');

  const exact = await readAll(bytesSplit(JSON.stringify(Array.from({length: 5}, (_, i) => ({stream_id: i}))), 7), {maxItems: 5});
  assert.deepEqual([exact.result.items, exact.result.truncated], [5, false], 'a list of exactly the limit is complete');
  await assert.rejects(readAll(bytesSplit(many, 10), {maxBytes: 100}), (error: VodError) => error.code === 'vod_too_large');
  const big = JSON.stringify([{stream_id: 1, name: 'x'.repeat(70000)}, {stream_id: 2}]);
  const skipped = await readAll(bytesSplit(big, 1000));
  assert.deepEqual([skipped.items, skipped.result.skipped], [[{stream_id: 2}], 1], 'an element over 64 KB is skipped');
  assert.deepEqual((await readAll(['[{"a":1},{bad json},{"b":2}]'])).items, [{a: 1}, {b: 2}]);

  // The reader stops when told to (the catalogue's byte budget), as at maxItems.
  const stopped = streamOf(bytesSplit(many, 10));
  const kept: unknown[] = [];
  const budget = await readJsonArray(stopped.stream, item => kept.length < 3 ? kept.push(item) && undefined : false, {maxBytes: 1 << 20, maxItems: 1000});
  assert.deepEqual([budget.items, budget.truncated, kept.length], [3, true, 3]);
  assert.ok(stopped.cancelled(), 'the rest of the body is not read');
  const objectStop = await readJsonArray(streamOf(['{"1": {"a": 1}, "2": {"a": 2}}']).stream, () => false, {maxBytes: 1 << 20, maxItems: 10});
  assert.deepEqual([objectStop.items, objectStop.truncated], [0, true]);

  assert.deepEqual((await readAll(['{"1": {"stream_id": 1}, "2": {"stream_id": 2}}'])).items, [{stream_id: 1}, {stream_id: 2}], 'object of objects');
  assert.deepEqual((await readAll(['{}'])).items, []);
  await assert.rejects(readAll(['{"user_info":{"auth":0}}']), (error: VodError) => error.code === 'invalid_line_login' && error.status === 401);
  await assert.rejects(readAll(['{"error": "x"}']), (error: VodError) => error.code === 'vod_unavailable');
  await assert.rejects(readAll(['<html><body>Login</body></html>']), (error: VodError) => error.code === 'vod_unavailable');
  await assert.rejects(readAll(['[{"stream_id": 1}, {"stream_']), (error: VodError) => error.code === 'vod_unavailable', 'a cut-off list');
  await assert.rejects(readAll([]), (error: VodError) => error.code === 'vod_unavailable', 'an empty body');
  await assert.rejects(readJsonArray(null, () => {}, {maxBytes: 1, maxItems: 1}), (error: VodError) => error.code === 'vod_unavailable');
  await assert.rejects(readAll(['{"a":' + '1'.repeat(100) + '}'], {maxObjectBytes: 50}), (error: VodError) => error.code === 'vod_too_large');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readAll(['[{"a":1}]'], {signal: controller.signal}), (error: VodError) => error.code === 'vod_timeout');
  const failing = new ReadableStream<Uint8Array>({pull(c) {c.error(new Error('reset'));}});
  await assert.rejects(readJsonArray(failing, () => {}, {maxBytes: 1, maxItems: 1}), (error: VodError) => error.code === 'vod_unavailable');
});

test('posters: direct provider hosts through the image route, TMDB directly, everything else a title card', () => {
  // The predicate is lib/player.ts isDirectProviderAddress: approved hosts this Worker fetches itself (not relay hosts).
  const provider = (url: URL) => url.hostname === 'tv.lumanest.tv' || url.hostname === '136.148.65.10';
  const secrets = ['runtime-user', 'runtime-password'];
  assert.deepEqual(classifyPoster('http://136.148.65.10/posters/p1.jpg', provider, secrets), {kind: 'proxy', base: 'http://136.148.65.10/posters/', file: 'p1.jpg'});
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/images/a/b-c_d.png#x', provider, secrets), {kind: 'proxy', base: 'https://tv.lumanest.tv/images/a/', file: 'b-c_d.png'});
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/img.php?id=5', provider, secrets), {kind: 'proxy', base: 'https://tv.lumanest.tv/img.php?id=5', file: ''}, 'a query keeps the whole address sealed');
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/i/runtime-user.jpg', provider, secrets), {kind: 'proxy', base: 'https://tv.lumanest.tv/i/runtime-user.jpg', file: ''}, 'a file name with the login stays sealed');
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/i/RUNTIME-USER.jpg', provider, secrets), {kind: 'proxy', base: 'https://tv.lumanest.tv/i/RUNTIME-USER.jpg', file: ''}, 'in any case');
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/i/cover', provider, secrets), {kind: 'proxy', base: 'https://tv.lumanest.tv/i/cover', file: ''}, 'only image file names share a directory token');
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/i/player_api.php', provider, secrets).kind === 'proxy' && (classifyPoster('https://tv.lumanest.tv/i/player_api.php', provider, secrets) as {file: string}).file, '');
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/i/%2e%2e.jpg', provider, secrets).kind, 'proxy');
  assert.equal((classifyPoster('https://tv.lumanest.tv/i/%2e%2e.jpg', provider, secrets) as {file: string}).file, '', 'an encoded name is never a plain file name');
  assert.deepEqual(classifyPoster('https://image.tmdb.org/t/p/w600/a.jpg', provider, secrets), {kind: 'direct', url: 'https://image.tmdb.org/t/p/w600/a.jpg'});
  assert.deepEqual(classifyPoster('http://image.tmdb.org/t/p/w600/a.jpg', provider, secrets), {kind: 'direct', url: 'https://image.tmdb.org/t/p/w600/a.jpg'});
  for (const value of ['', 'http://other.example/a.jpg', 'https://cdn.example/a.jpg', 'https://cdn.provider.example/posters/a.jpg', 'https://image.tmdb.org:8443/a.jpg',
    'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://u:p@cdn.example/a.jpg', 'x'.repeat(1100), 'not a url', 'https://image.tmdb.org/runtime-password/a.jpg']) {
    assert.deepEqual(classifyPoster(value, provider, secrets), {kind: 'none'}, value.slice(0, 40));
  }
  assert.ok(POSTER_FILE.test('poster_01.final-v2.jpg'));
  for (const file of ['', '.hidden', '../x.jpg', 'a/b.jpg', 'a%2Fb.jpg', 'a?.jpg', 'a b.jpg', 'x'.repeat(200)]) assert.ok(!POSTER_FILE.test(file), file);
  for (const file of ['a.jpg', 'B.JPEG', 'c.png', 'd.gif', 'e.webp', 'f.avif']) assert.ok(isPosterFile(file), file);
  for (const file of ['player_api.php', 'cover', 'a.jpg.php', 'a.svg', 'index.html', '.jpg']) assert.ok(!isPosterFile(file), file);
});

test('posters that carry the line login are found however it is written', () => {
  const secrets = ['runtime-user', "pa'ss word"];
  const has = (value: string, list = secrets) => carriesSecret(new URL(value), list);
  for (const value of [
    "https://image.tmdb.org/a.jpg?p=pa%27ss%20word", "https://image.tmdb.org/a.jpg?p=pa'ss word", 'https://image.tmdb.org/a.jpg?p=pa%27ss+word', "https://image.tmdb.org/pa'ss%20word/a.jpg",
    'https://image.tmdb.org/PA%27SS%20WORD/a.jpg', 'https://image.tmdb.org/i/Runtime-User.jpg', 'https://image.tmdb.org/a.jpg?u=runtime%2Duser', 'https://image.tmdb.org/a.jpg?x=1&u=xxruntime-userxx',
  ]) assert.ok(has(value), value);
  assert.ok(!has('https://image.tmdb.org/t/p/w600/a.jpg'));
  // A short login matches only as a whole path segment, file name or query value, not inside other words.
  assert.ok(has('https://image.tmdb.org/a.jpg?p=ab', ['ab']));
  assert.ok(has('https://image.tmdb.org/x/ab/a.jpg', ['ab']));
  assert.ok(has('https://image.tmdb.org/x/AB.jpg', ['ab']));
  assert.ok(!has('https://image.tmdb.org/x/tab.jpg', ['ab']));
  assert.ok(has('https://image.tmdb.org/x/a%2Fb/c.jpg', ['a/b']), 'an encoded slash');
  assert.ok(has('https://image.tmdb.org/x.jpg?p=a%252fb', ['a%2Fb']), 'a literal %2F in any case');
  assert.ok(!has('https://image.tmdb.org/a.jpg', ['', '']));
  assert.deepEqual(classifyPoster('https://image.tmdb.org/a.jpg?p=ab', () => false, ['ab']), {kind: 'none'});
});

test('a poster book seals one stable token per directory, bound to one line, up to a limit', async () => {
  const provider = (url: URL) => url.hostname === 'tv.lumanest.tv';
  const capped = createPosterBook(provider, [], 3);
  assert.deepEqual(['a', 'b', 'c', 'd', 'a'].map(dir => capped.add(`https://tv.lumanest.tv/${dir}/p.jpg`)), ['~0:p.jpg', '~1:p.jpg', '~2:p.jpg', undefined, '~0:p.jpg'], 'a fourth directory gets a title card');
  assert.equal(capped.add('https://image.tmdb.org/t/p/w600/c.jpg'), 'https://image.tmdb.org/t/p/w600/c.jpg', 'TMDB posters need no token');
  assert.equal(capped.size, 3);
  const book = createPosterBook(provider, ['runtime-user']);
  assert.equal(book.add('https://tv.lumanest.tv/posters/a.jpg'), '~0:a.jpg');
  assert.equal(book.add('https://tv.lumanest.tv/posters/b.jpg'), '~0:b.jpg');
  assert.equal(book.add('https://tv.lumanest.tv/img.php?id=1'), '~1:');
  assert.equal(book.add('https://image.tmdb.org/t/p/w600/c.jpg'), 'https://image.tmdb.org/t/p/w600/c.jpg');
  assert.equal(book.add('http://elsewhere.example/c.jpg'), undefined);
  assert.equal(book.size, 2);
  const line = await mac('runtime-user', SECRET, 'player-line');
  const now = Date.UTC(2026, 9, 19, 10);
  const bases = await book.seal(line, SECRET, now);
  assert.equal(bases.length, 2);
  assert.deepEqual(await book.seal(line, SECRET, now + 3600000), bases, 'the same tokens all day');
  for (const base of bases) assert.ok(!base.includes('tv.lumanest.tv') && !base.includes('posters'));
  const first = await open<ImageToken>(bases[0], SECRET, 'player-image');
  assert.deepEqual(first, {u: 'https://tv.lumanest.tv/posters/', l: line, exp: Date.UTC(2026, 9, 27), dir: 1});
  assert.ok(validImageToken(first, line, now));
  assert.ok(!validImageToken(first, await mac('other-user', SECRET, 'player-line'), now), 'another line');
  assert.ok(!validImageToken(first, line, Date.UTC(2026, 9, 28)), 'expired');
  assert.equal(imageAddress(first, 'a.jpg'), 'https://tv.lumanest.tv/posters/a.jpg');
  for (const file of ['', '../player_api.php', 'player_api.php', 'cover', 'a.svg', 'a/b.jpg', 'a%2F..%2Fx']) assert.equal(imageAddress(first, file), null, file);
  const whole = await open<ImageToken>(bases[1], SECRET, 'player-image');
  assert.equal(imageAddress(whole, ''), 'https://tv.lumanest.tv/img.php?id=1');
  assert.equal(imageAddress(whole, 'a.jpg'), null);
  await assert.rejects(open(bases[0], SECRET, 'player-media'), 'an image token is not a media token');
  assert.notEqual(await sealStable({u: 'x'}, SECRET, 'player-image'), await sealStable({u: 'y'}, SECRET, 'player-image'));
  assert.notEqual(await seal({u: 'x'}, SECRET, 'player-image'), await seal({u: 'x'}, SECRET, 'player-image'), 'ordinary tokens stay random');
  assert.notEqual(await mac('x', SECRET, 'player-line'), await mac('x', SECRET, 'player-cache'), 'each purpose has its own key');
  assert.equal(await mac('x', SECRET, 'player-line'), await mac('x', SECRET, 'player-line'));
});

test('image types by their first bytes; SVG and HTML are refused', () => {
  const bytes = (...values: (number | string)[]) => new Uint8Array(values.flatMap(value => typeof value === 'string' ? [...value].map(c => c.charCodeAt(0)) : [value]));
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffImage(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffImage(bytes('GIF89a')), 'image/gif');
  assert.equal(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(bytes(0, 0, 0, 0x1c, 'ftypavif')), 'image/avif');
  assert.equal(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(bytes('<!doctype html><html>')), null);
  assert.equal(sniffImage(bytes()), null);
});

test('series details: seasons in number order, episode limits and defaults', () => {
  const info = compactSeriesInfo({
    info: {name: 'Show', plot: 'p'.repeat(3000), cover: 'https://image.tmdb.org/c.jpg', genre: 'Drama', releaseDate: '2019-04-01', rating: '8.13', tmdb: '1399'},
    seasons: [{season_number: 2, name: 'Second Season'}],
    episodes: {
      '10': [{id: '1001', episode_num: 1, title: 'Ten', container_extension: 'MKV', info: {duration_secs: 3000}}],
      '2': [{id: '201', episode_num: 2, title: 'B', container_extension: '', info: {duration: '00:42:30'}}, {id: '200', episode_num: 1, title: 'A', container_extension: 'mp4', info: {plot: 'x'}}],
      '1': [{id: 'bad', episode_num: 1}, {id: '101', episode_num: 1, title: 't'.repeat(300)}],
    },
  }, '9');
  assert.deepEqual(info.seasons.map(season => season.season), [1, 2, 10]);
  assert.deepEqual(info.seasons[1], {season: 2, name: 'Second Season', episodes: [{id: '200', episode: 1, title: 'A', ext: 'mp4', plot: 'x'}, {id: '201', episode: 2, title: 'B', ext: 'mp4', duration: 2550}]});
  assert.equal(info.seasons[0].name, 'Season 1');
  assert.equal(info.seasons[0].episodes[0].title.length, 200);
  assert.equal(info.seasons[2].episodes[0].ext, 'mkv');
  assert.deepEqual([info.name, info.plot.length, info.year, info.genre, info.rating, info.tmdb], ['Show', 2000, '2019', 'Drama', 8.1, '1399']);
  const listed = compactSeriesInfo({episodes: [[{id: '1', episode_num: 1, season: 3}], [{id: '2', episode_num: 1}]]}, '5');
  assert.deepEqual(listed.seasons.map(season => [season.season, season.episodes[0].id]), [[2, '2'], [3, '1']], 'an array of seasons, an episode’s own season wins');
  const huge = compactSeriesInfo({episodes: Object.fromEntries(Array.from({length: 150}, (_, s) => [String(s + 1), Array.from({length: 30}, (_, e) => ({id: String(s * 100 + e), episode_num: e}))]))}, '6');
  assert.ok(huge.seasons.length <= 100);
  assert.equal(huge.seasons.reduce((sum, season) => sum + season.episodes.length, 0), 3000);
  assert.deepEqual(compactSeriesInfo(null, '1').seasons, []);
});

test('movie details', () => {
  assert.deepEqual(compactMovieInfo({info: {plot: 'A plot', duration: '02:11:00', genre: 'Sci-Fi', cast: 'A, B', director: 'D', releasedate: '2021-10-22', rating: '7.9', tmdb_id: '438631'}}, '123'),
    {id: '123', plot: 'A plot', duration: 7860, genre: 'Sci-Fi', cast: 'A, B', director: 'D', released: '2021-10-22', rating: 7.9, tmdb: '438631'});
  assert.equal(compactMovieInfo({info: {duration_secs: 5400}}, '1').duration, 5400);
  assert.equal(compactMovieInfo({info: {releasedate: 'soon'}}, '1').released, '');
  assert.equal(durationOf({duration: '45:10'}), 2710);
  assert.equal(durationOf({}), 0);
});
