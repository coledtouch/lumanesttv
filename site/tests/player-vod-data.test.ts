// The web player's Movies & Series server helpers (lib/player-vod-data.ts): Xtream requests, streamed JSON lists,
// poster links and details.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE_HOST, POSTER_FILE, POSTER_TAG_LENGTH, VodError, carriesSecret, catalogueHostAddress, catalogueHostOf, catalogueImageAddress, classifyPoster, compactMovieInfo,
  compactSeriesInfo, createCataloguePosters, createPosterBook, createPosterCounter, durationOf, electCatalogueHost, entryExt, entryKind, imageAddress, isPosterFile,
  isPosterPath, posterTag, readJsonArray, sniffImage, validImageToken, VOD_LIMITS, vodPlayURL, xtreamServer, xtreamURL, type ImageToken,
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
  const text = '\ufeff \n' + JSON.stringify(list, null, 1);
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

// ---------------------------------------------------------------- the catalogue image host

// lib/player.ts / lib/player-vod.ts predicates in the shape the tests use: tv.lumanest.tv is a direct provider host;
// refused (refusedImageHost) is true for provider hosts by any scheme (plain.provider.net is approved for http only)
// and for the site's own hosts (lumanest.tv and anything under it). The relay's hosts are IPv4 addresses, which the
// rule refuses on its own.
const directProvider = (url: URL) => url.hostname === 'tv.lumanest.tv';
const refused = (url: URL) => ['tv.lumanest.tv', 'plain.provider.net'].includes(url.hostname) || url.hostname === 'lumanest.tv' || url.hostname.endsWith('.lumanest.tv');
const HOST = 'https://img.posterhost.net';
const LOGIN = ['runtime-user', 'runtime-password'];
const LINE = 'line-mac';
const tagged = (address: string, line = LINE) => posterTag(SECRET, line, address);

test('catalogue image host: only a public https name on the default port that is not a provider, relay, own or TMDB host', () => {
  const of = (value: string) => catalogueHostOf(new URL(value), refused, LOGIN);
  assert.equal(of('https://img.posterhost.net/i/a.jpg'), HOST);
  assert.equal(of('https://IMG.PosterHost.net:443/i/a.jpg?x=1'), HOST, 'port 443 is the default port; case is normalised');
  assert.equal(of('https://xn--e1afmkfd.xn--p1ai/a.jpg'), 'https://xn--e1afmkfd.xn--p1ai', 'an international name');
  for (const value of [
    'http://img.posterhost.net/i/a.jpg', 'https://img.posterhost.net:8443/i/a.jpg', 'https://u:p@img.posterhost.net/a.jpg', 'https://image.tmdb.org/t/p/w600/a.jpg',
    'https://tv.lumanest.tv/posters/a.jpg', 'https://10.0.0.5/a.jpg', 'https://127.0.0.1/a.jpg', 'https://169.254.169.254/a.jpg',
    'https://192.168.1.2/a.jpg', 'https://172.20.0.1/a.jpg', 'https://100.64.0.1/a.jpg', 'https://2130706433/a.jpg', 'https://0x7f.1/a.jpg', 'https://[::1]/a.jpg', 'https://[2001:db8::1]/a.jpg',
    'https://localhost/a.jpg', 'https://posters.local/a.jpg', 'https://img.internal/a.jpg', 'https://posters/a.jpg', 'https://img.example/a.jpg',
    'https://img.posterhost.net/runtime-user/a.jpg', 'https://img.posterhost.net/a.jpg?p=runtime-password', 'https://img.posterhost.net/RUNTIME-USER.jpg',
    // Any IP address, public or not: the relay's hosts (136.148.65.x) are reached over http and refused over https too.
    'https://136.148.65.10/p/a.jpg', 'https://8.8.8.8/a.jpg',
    // Names ending in a dot, which slip past the local-name checks.
    'https://localhost./a.jpg', 'https://metadata.google.internal./a.jpg', 'https://img.posterhost.net./a.jpg', 'https://image.tmdb.org./t/p/a.jpg',
    // Names that resolve to the address written in them.
    'https://127.0.0.1.nip.io/a.jpg', 'https://10-0-0-1.sslip.io/a.jpg', 'https://app.localtest.me/a.jpg', 'https://x.lvh.me/a.jpg',
    // A provider host approved for http only, asked for over https; this site's own hosts.
    'https://plain.provider.net/a.jpg', 'https://lumanest.tv/a.jpg', 'https://streams.lumanest.tv/a.jpg', 'https://relay.lumanest.tv/a.jpg',
  ]) assert.equal(of(value), '', value);
});

test('catalogue image host: the most-used eligible host with at least 20% of the posters and at least 50 of them', () => {
  const run = (posters: string[]) => {
    const counter = createPosterCounter(refused, LOGIN);
    for (const poster of posters) counter.add(poster);
    return counter;
  };
  const many = (count: number, make: (i: number) => string) => Array.from({length: count}, (_, i) => make(i));
  const onHost = (i: number) => `${HOST}/i/${i}.jpg`;
  const tmdb = (i: number) => `https://image.tmdb.org/t/p/w600/${i}.jpg`;
  assert.deepEqual([CATALOGUE_HOST.share, CATALOGUE_HOST.min], [0.2, 50]);
  // Below and at 20% of 1,000 posters.
  assert.equal(run([...many(199, onHost), ...many(801, tmdb)]).elect(), null, '19.9%');
  assert.equal(run([...many(200, onHost), ...many(800, tmdb)]).elect(), HOST, '20%');
  assert.equal(run([...many(990, onHost), ...many(10, tmdb)]).elect(), HOST, '99%');
  // Fewer than 50 posters on it, however large a share.
  assert.equal(run(many(49, onHost)).elect(), null, '49 of 49');
  assert.equal(run(many(50, onHost)).elect(), HOST, '50 of 50');
  // Empty posters don't count; unreadable ones count in the total.
  const counted = run([...many(60, onHost), ...many(500, () => ''), ...many(200, () => 'not a url')]);
  assert.deepEqual([counted.total, counted.count(HOST), counted.elect()], [260, 60, HOST]);
  assert.equal(run([...many(60, onHost), ...many(241, () => 'not a url')]).elect(), null, '60 of 301');
  // An http host, another port, a relay or provider host, an IP address or an own host never qualifies, however many
  // posters it has.
  assert.equal(run(many(1000, i => `http://img.posterhost.net/i/${i}.jpg`)).elect(), null, 'http');
  assert.equal(run(many(1000, i => `https://img.posterhost.net:8443/i/${i}.jpg`)).elect(), null, 'port');
  assert.equal(run(many(1000, i => `https://136.148.65.10/i/${i}.jpg`)).elect(), null, 'relay host over https');
  assert.equal(run(many(1000, i => `https://plain.provider.net/i/${i}.jpg`)).elect(), null, 'http-only provider host over https');
  assert.equal(run(many(1000, i => `https://tv.lumanest.tv/i/${i}.jpg`)).elect(), null, 'provider host: proxied as one anyway');
  assert.equal(run(many(1000, i => `https://cdn.lumanest.tv/i/${i}.jpg`)).elect(), null, 'own host');
  assert.equal(run(many(1000, i => `https://10.1.2.3/i/${i}.jpg`)).elect(), null, 'private address');
  assert.equal(run(many(1000, i => `https://img.posterhost.net./i/${i}.jpg`)).elect(), null, 'trailing dot');
  // Posters carrying the login don't count for the host (they are never asked for).
  assert.equal(run([...many(40, onHost), ...many(960, i => `${HOST}/i/${i}.jpg?u=runtime-user`)]).elect(), null);
  // Two hosts over the line: the one with more posters (one host per line); equal counts pick the same one every time.
  const two = run([...many(300, onHost), ...many(400, i => `https://cdn.second.net/${i}.jpg`)]);
  assert.equal(two.elect(), 'https://cdn.second.net');
  assert.equal(electCatalogueHost(new Map([['https://b.net', 60], ['https://a.net', 60]]), 120), 'https://a.net');
  assert.equal(electCatalogueHost(new Map(), 0), null);
});

test('catalogue image host posters are proxied like provider posters, never with the login', () => {
  assert.deepEqual(classifyPoster(`${HOST}/i/a.jpg`, directProvider, LOGIN, HOST), {kind: 'proxy', base: HOST + '/i/', file: 'a.jpg', host: true});
  assert.deepEqual(classifyPoster(`${HOST}/img.php?id=5`, directProvider, LOGIN, HOST), {kind: 'proxy', base: HOST + '/img.php?id=5', file: '', host: true});
  assert.deepEqual(classifyPoster(`${HOST}/i/a.jpg`, directProvider, LOGIN), {kind: 'none'}, 'without the host: a title card, as before');
  assert.deepEqual(classifyPoster(`${HOST}/i/a.jpg`, directProvider, LOGIN, 'https://other.net'), {kind: 'none'}, 'another host');
  for (const value of [`${HOST}/runtime-user/a.jpg`, `${HOST}/i/a.jpg?u=Runtime-User`, `${HOST}/i/runtime-password.jpg`, `${HOST}/i/a.jpg?p=runtime%2Dpassword`,
    'http://img.posterhost.net/i/a.jpg', 'https://img.posterhost.net:8443/i/a.jpg']) {
    assert.deepEqual(classifyPoster(value, directProvider, LOGIN, HOST), {kind: 'none'}, value);
  }
  // Provider and TMDB posters are unchanged.
  assert.deepEqual(classifyPoster('https://tv.lumanest.tv/p/a.jpg', directProvider, LOGIN, HOST), {kind: 'proxy', base: 'https://tv.lumanest.tv/p/', file: 'a.jpg'});
  assert.deepEqual(classifyPoster('https://image.tmdb.org/t/p/w600/a.jpg', directProvider, LOGIN, HOST), {kind: 'direct', url: 'https://image.tmdb.org/t/p/w600/a.jpg'});
  // A poster book with no tag function can't list a host directory's posters.
  assert.equal(createPosterBook(directProvider, LOGIN).add(`${HOST}/i/a.jpg`, HOST), undefined);
  assert.equal(createPosterBook(directProvider, LOGIN, 500, tagged).add(`${HOST}/i/a.jpg`, HOST), '~0:a.jpg!' + tagged(HOST + '/i/a.jpg'));
});

/**
 * Builds a catalogue's titles the way lib/player-vod.ts does: each title's JSON without its waiting poster, then
 * finish. sections: how many of the posters are movies (the rest are series).
 */
function buildTitles(posters: (string | undefined)[], {room, maxBases, movies = posters.length}: {room?: number; maxBases?: number; movies?: number} = {}) {
  const book = createCataloguePosters(directProvider, refused, LOGIN, {tag: tagged, ...(maxBases ? {maxBases} : {})});
  const lists: string[][] = [[], []];
  posters.forEach((poster, i) => {
    const section = i < movies ? 0 : 1, items = lists[section];
    const item: Record<string, unknown> = {id: String(i), name: 'T' + i};
    let waiting: {origin: string; base: string; file: string} | null = null;
    if (poster) {
      const placed = book.place(poster);
      if (typeof placed === 'string') item.poster = placed;
      else if (placed) {
        waiting = placed;
        assert.deepEqual(Object.keys(placed).sort(), ['base', 'file', 'origin'], 'a waiting poster reserves no bytes');
      }
    }
    const text = JSON.stringify(item);
    if (waiting) book.wait(items, items.length, waiting, section);
    items.push(text);
  });
  const titleBytes = lists.flat().reduce((n, text) => n + text.length, 0);
  const result = book.finish(room === undefined ? {} : {room});
  const parsed = lists.flat().map(text => JSON.parse(text) as {id: string; poster?: string});
  return {book, items: parsed, movies: lists[0].map(text => JSON.parse(text) as {poster?: string}), series: lists[1].map(text => JSON.parse(text) as {poster?: string}),
    result, titleBytes, bytes: lists.flat().reduce((n, text) => n + text.length, 0)};
}

test('a catalogue is built with its image host: posters wait for the end of the lists, then join their titles, tagged', async () => {
  const posters = [
    ...Array.from({length: 60}, (_, i) => `${HOST}/covers/${i}.jpg`),
    `${HOST}/covers/x.jpg?u=runtime-user`, `${HOST}/runtime-password/y.jpg`, 'https://tv.lumanest.tv/p/a.jpg', 'https://image.tmdb.org/t/p/w600/b.jpg',
    'https://cdn.other.net/c.jpg', 'http://img.posterhost.net/covers/d.jpg', undefined, `${HOST}/show.php?id=9`,
  ];
  const built = buildTitles(posters);
  assert.deepEqual(built.result, {host: HOST, placed: 61, skipped: 0});
  assert.equal(built.items[0].poster, '~1:0.jpg!' + tagged(HOST + '/covers/0.jpg'), 'after the provider poster, which was placed first');
  assert.equal(built.items[59].poster, '~1:59.jpg!' + tagged(HOST + '/covers/59.jpg'), 'one sealed directory for all of them');
  assert.match(tagged(HOST + '/covers/0.jpg'), /^[A-Za-z0-9_-]{8}$/);
  assert.equal(built.items[60].poster, undefined, 'the login in the query: never asked for');
  assert.equal(built.items[61].poster, undefined, 'the password in the path');
  assert.equal(built.items[62].poster, '~0:a.jpg', 'provider posters are placed at once, untagged as before');
  assert.equal(built.items[63].poster, 'https://image.tmdb.org/t/p/w600/b.jpg');
  assert.equal(built.items[64].poster, undefined, 'another host');
  assert.equal(built.items[65].poster, undefined, 'the host over http');
  assert.equal(built.items[66].poster, undefined);
  assert.equal(built.items[67].poster, '~2:', 'a whole address, sealed whole: no tag needed');
  const line = await mac('runtime-user', SECRET, 'player-line');
  const bases = await built.book.book.seal(line, SECRET, Date.UTC(2026, 9, 19));
  assert.deepEqual(await open<ImageToken>(bases[1], SECRET, 'player-image'), {u: HOST + '/covers/', l: line, exp: Date.UTC(2026, 9, 27), dir: 1, h: 1});
  assert.deepEqual(await open<ImageToken>(bases[0], SECRET, 'player-image'), {u: 'https://tv.lumanest.tv/p/', l: line, exp: Date.UTC(2026, 9, 27), dir: 1}, 'provider tokens carry no h');
  assert.deepEqual(await open<ImageToken>(bases[2], SECRET, 'player-image'), {u: HOST + '/show.php?id=9', l: line, exp: Date.UTC(2026, 9, 27), h: 1});
  assert.ok(validImageToken({u: HOST + '/covers/', l: line, exp: Date.UTC(2026, 9, 27), dir: 1, h: 1}, line, Date.UTC(2026, 9, 19)));
  assert.ok(!validImageToken({u: HOST + '/covers/', l: line, exp: Date.UTC(2026, 9, 27), h: 2}, line, Date.UTC(2026, 9, 19)));

  // Under the rule's threshold nothing waits in vain: the host's posters get title cards.
  const few = buildTitles([...Array.from({length: 40}, (_, i) => `${HOST}/covers/${i}.jpg`), ...Array.from({length: 10}, () => 'https://tv.lumanest.tv/p/a.jpg')]);
  assert.deepEqual(few.result, {host: null, placed: 0, skipped: 0});
  assert.ok(few.items.slice(0, 40).every(item => item.poster === undefined));
  assert.ok(few.items.slice(40).every(item => item.poster === '~0:a.jpg'));
});

test('catalogue image host posters only use the room the titles leave, shared between movies and series', () => {
  const posters = [...Array.from({length: 90}, (_, i) => `${HOST}/covers/m${i}.jpg`), ...Array.from({length: 30}, (_, i) => `${HOST}/shows/s${i}.jpg`)];
  // Room for everything: every poster joins its title, and the bytes added are what was allowed.
  const all = buildTitles(posters, {movies: 90});
  assert.deepEqual(all.result, {host: HOST, placed: 120, skipped: 0});
  const perPoster = (all.bytes - all.titleBytes) / 120;
  assert.ok(perPoster > 20 && perPoster < 40, String(perPoster));
  // Room for about a third: no title is lost; the bytes added never pass the room; movies and series share it in
  // proportion to what their posters need (3 to 1 here).
  for (const room of [0, 1, 500, 1200, 2500, all.bytes - all.titleBytes - 1]) {
    const some = buildTitles(posters, {movies: 90, room});
    assert.equal(some.items.length, 120, 'every title is kept');
    assert.ok(some.bytes - some.titleBytes <= room, `room ${room}: added ${some.bytes - some.titleBytes}`);
    assert.equal(some.result.placed + some.result.skipped, 120);
    assert.equal(some.result.placed, some.items.filter(item => item.poster).length);
    if (room === 1200) {
      const movies = some.movies.filter(item => item.poster).length, series = some.series.filter(item => item.poster).length;
      assert.ok(movies > 0 && series > 0, `${movies} movies, ${series} series`);
      assert.ok(Math.abs(movies / series - 3) <= 1, `${movies} movies, ${series} series`);
      // The posters placed are the first of each list.
      assert.ok(some.movies.slice(0, movies).every(item => item.poster) && some.series.slice(0, series).every(item => item.poster));
    }
  }
  assert.deepEqual(buildTitles(posters, {movies: 90, room: 0}).result, {host: HOST, placed: 0, skipped: 120});
});

test('a catalogue image host with more directories than free tokens: its busiest get their own, the rest share its root', async () => {
  // Five tokens: one provider directory, then three for the host's busiest directories and one for its root.
  const posters = [
    'https://tv.lumanest.tv/p/a.jpg',
    ...Array.from({length: 30}, (_, i) => `${HOST}/big/${i}.jpg`),
    ...Array.from({length: 20}, (_, i) => `${HOST}/mid/${i}.jpg`),
    ...Array.from({length: 10}, (_, i) => `${HOST}/small/${i}.jpg`),
    ...Array.from({length: 40}, (_, i) => `${HOST}/one/${i}/poster.jpg`),
    `${HOST}/odd/a%20b/c.jpg`, `${HOST}/x.jpg?id=1`,
  ];
  const built = buildTitles(posters, {maxBases: 5});
  assert.equal(built.result.host, HOST);
  assert.equal(built.items[1].poster, '~1:0.jpg!' + tagged(HOST + '/big/0.jpg'));
  assert.equal(built.items[31].poster, '~2:0.jpg!' + tagged(HOST + '/mid/0.jpg'));
  assert.equal(built.items[51].poster, '~3:0.jpg!' + tagged(HOST + '/small/0.jpg'));
  assert.equal(built.items[61].poster, '~4:one/0/poster.jpg!' + tagged(HOST + '/one/0/poster.jpg'), 'through the root, with its path');
  assert.equal(built.items[100].poster, '~4:one/39/poster.jpg!' + tagged(HOST + '/one/39/poster.jpg'));
  assert.equal(built.items[101].poster, undefined, 'a directory name that is not a plain segment: a title card');
  assert.equal(built.items[102].poster, undefined, 'a whole address finds no free token');
  assert.deepEqual([built.result.placed, built.result.skipped], [100, 2]);
  const line = await mac('runtime-user', SECRET, 'player-line');
  const bases = await built.book.book.seal(line, SECRET, Date.UTC(2026, 9, 19));
  assert.equal(bases.length, 5);
  assert.deepEqual(await open<ImageToken>(bases[4], SECRET, 'player-image'), {u: HOST + '/', l: line, exp: Date.UTC(2026, 9, 27), dir: 1, h: 1});
  // With enough tokens, every directory gets its own.
  const roomy = buildTitles(posters);
  assert.equal(roomy.items[61].poster, '~4:poster.jpg!' + tagged(HOST + '/one/0/poster.jpg'));
  assert.equal(roomy.items[101].poster, '~44:c.jpg!' + tagged(HOST + '/odd/a%20b/c.jpg'), 'any directory can be sealed; only paths from the root must be plain');
  assert.equal(roomy.items[102].poster, '~45:');
});

test('an image request for the catalogue image host may only fetch that host, as the rule still allows it', () => {
  assert.equal(catalogueHostAddress(`${HOST}/covers/1.jpg`, HOST, refused, LOGIN)?.href, `${HOST}/covers/1.jpg`);
  for (const [address, host] of [
    ['https://cdn.other.net/covers/1.jpg', HOST], [`${HOST}/covers/1.jpg`, 'https://cdn.other.net'], [`${HOST}/covers/1.jpg`, ''],
    ['http://img.posterhost.net/covers/1.jpg', HOST], ['https://img.posterhost.net:8443/covers/1.jpg', HOST], [`${HOST}/covers/runtime-user.jpg`, HOST],
    [`${HOST}/covers/1.jpg?p=runtime-password`, HOST], ['https://relay.lumanest.tv/1.jpg', 'https://relay.lumanest.tv'], ['https://10.0.0.1/1.jpg', 'https://10.0.0.1'],
    ['https://136.148.65.10/1.jpg', 'https://136.148.65.10'], ['https://plain.provider.net/1.jpg', 'https://plain.provider.net'],
    ['https://tv.lumanest.tv/p/1.jpg', 'https://tv.lumanest.tv'], [`${HOST}/covers/1.jpg#x`, HOST], ['not a url', HOST], ['https://img.posterhost.net./covers/1.jpg', 'https://img.posterhost.net.'],
  ]) assert.equal(catalogueHostAddress(address, host, refused, LOGIN), null, address + ' on ' + host);
});

test('a catalogue image host poster is asked for by its listed path and tag only', () => {
  const token = (u: string, dir = true): ImageToken => ({u, l: LINE, exp: Date.now() + 60000, h: 1, ...(dir ? {dir: 1} : {})});
  const sign = (address: string) => tagged(address);
  const dir = token(HOST + '/covers/'), root = token(HOST + '/');
  assert.equal(catalogueImageAddress(dir, '1.jpg!' + tagged(HOST + '/covers/1.jpg'), sign), HOST + '/covers/1.jpg');
  assert.equal(catalogueImageAddress(root, 'one/7/poster.jpg!' + tagged(HOST + '/one/7/poster.jpg'), sign), HOST + '/one/7/poster.jpg');
  // A name the catalogue didn't list (no tag, another file's tag, another line's or secret's tag) is refused.
  for (const f of ['1.jpg', '1.jpg!', '2.jpg!' + tagged(HOST + '/covers/1.jpg'), '1.jpg!' + tagged(HOST + '/covers/1.jpg', 'other-line'),
    '1.jpg!' + posterTag('b'.repeat(64), LINE, HOST + '/covers/1.jpg'), '1.jpg!' + tagged(HOST + '/covers/1.jpg').toLowerCase().replace(/^./, 'Z'),
    '!' + tagged(HOST + '/covers/'), '1.jpg!' + tagged(HOST + '/covers/1.jpg') + 'x']) {
    assert.equal(catalogueImageAddress(dir, f, sign), null, f);
  }
  // Only plain path segments ending in an image name, whatever the tag.
  for (const path of ['../x.jpg', 'a/../x.jpg', './x.jpg', 'a//x.jpg', '/x.jpg', '.x.jpg', 'x.svg', 'x.jpg?a=1', 'x%2F.jpg', 'a b.jpg', 'a\\b.jpg', '1/2/3/4/5/6/7/8/9.jpg', 'x'.repeat(301) + '.jpg']) {
    assert.equal(catalogueImageAddress(root, path + '!' + tagged(HOST + '/' + path), sign), null, path);
    assert.equal(isPosterPath(path), false, path);
  }
  assert.ok(isPosterPath('t/p/w600_and_h900_bestv2/abc.jpg'));
  // A whole sealed address needs no file name, and accepts none.
  assert.equal(catalogueImageAddress(token(HOST + '/x.php?id=1', false), '', sign), HOST + '/x.php?id=1');
  assert.equal(catalogueImageAddress(token(HOST + '/x.php?id=1', false), 'a.jpg!' + tagged(HOST + '/x.php?id=1a.jpg'), sign), null);
  // A directory token must name a directory.
  assert.equal(catalogueImageAddress(token(HOST + '/covers'), '1.jpg!' + tagged(HOST + '/covers1.jpg'), sign), null);
  // Tags: fixed length, stable, bound to the secret, the line and the whole address.
  assert.equal(tagged(HOST + '/covers/1.jpg'), tagged(HOST + '/covers/1.jpg'));
  assert.equal(new Set([tagged(HOST + '/covers/1.jpg'), tagged(HOST + '/covers/2.jpg'), tagged(HOST + '/covers/1.jpg', 'other'), posterTag('b'.repeat(64), LINE, HOST + '/covers/1.jpg')]).size, 4);
  assert.equal(POSTER_TAG_LENGTH, 8);
  assert.throws(() => posterTag('not hex', LINE, HOST + '/1.jpg'));
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

test('details text is cut between whole characters, never inside a surrogate pair', () => {
  // docs/browse.md, "Long names": each text below is trimmed, then cut where its limit falls on the first half of a
  // surrogate pair (U+1F600), so the pair is left out rather than halved.
  const pair = String.fromCodePoint(0x1f600);
  const long = (max: number) => '  ' + 'a'.repeat(max - 1) + pair + 'tail';
  const series = compactSeriesInfo({
    info: {name: long(150), plot: long(VOD_LIMITS.plot), genre: long(100)},
    seasons: [{season_number: 1, name: long(100)}],
    episodes: {'1': [{id: '1', episode_num: 1, title: long(VOD_LIMITS.episodeTitle), info: {plot: long(VOD_LIMITS.plot)}}]},
  }, '9');
  const episode = series.seasons[0].episodes[0];
  const movie = compactMovieInfo({info: {plot: long(VOD_LIMITS.plot), genre: long(100), cast: long(300), director: long(150)}}, '1');
  const cuts: [string, string | undefined, number][] = [
    ['series name', series.name, 150], ['series plot', series.plot, VOD_LIMITS.plot], ['series genre', series.genre, 100], ['season name', series.seasons[0].name, 100],
    ['episode title', episode.title, VOD_LIMITS.episodeTitle], ['episode plot', episode.plot, VOD_LIMITS.plot],
    ['movie plot', movie.plot, VOD_LIMITS.plot], ['movie genre', movie.genre, 100], ['cast', movie.cast, 300], ['director', movie.director, 150],
  ];
  for (const [label, text, max] of cuts) assert.equal(text, 'a'.repeat(max - 1), label);
  assert.equal(compactMovieInfo({info: {director: 'a'.repeat(148) + pair + 'tail'}}, '1').director, 'a'.repeat(148) + pair, 'a pair that fits stays whole');
  assert.equal(compactMovieInfo({info: {director: ' ' + 'b'.repeat(200) + ' '}}, '1').director, 'b'.repeat(150), 'other text is still cut at its limit');
  assert.equal(compactMovieInfo({info: {director: ' ' + pair + ' '}}, '1').director, pair);
});

test('movie details', () => {
  assert.deepEqual(compactMovieInfo({info: {plot: 'A plot', duration: '02:11:00', genre: 'Sci-Fi', cast: 'A, B', director: 'D', releasedate: '2021-10-22', rating: '7.9', tmdb_id: '438631'}}, '123'),
    {id: '123', plot: 'A plot', duration: 7860, genre: 'Sci-Fi', cast: 'A, B', director: 'D', released: '2021-10-22', rating: 7.9, tmdb: '438631'});
  assert.equal(compactMovieInfo({info: {duration_secs: 5400}}, '1').duration, 5400);
  assert.equal(compactMovieInfo({info: {releasedate: 'soon'}}, '1').released, '');
  assert.equal(durationOf({duration: '45:10'}), 2710);
  assert.equal(durationOf({}), 0);
});
