// The web player's side of subtitles, trailers and the hidden live category (docs/extras.md): the live_category cases
// of docs/extras-cases.json through the Live TV lineup (app/watch/extras.ts), which ids a title sends and that the
// endpoints accept them, the checks every answer goes through, the lookups' session cache, and the subtitle menu's
// rules (app/watch/subtitle-tracks.ts) run on stand-ins for the video's text tracks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  LOOKUP_CACHE_MAX, createExtrasClient, liveLineup, readSubtitleAnswer, readTrailerAnswer, subtitleQuery, titleTmdb, tmdbId, trailerEmbedSrc, trailerFrame,
  trailerQuery, trailerWatchURL, type ExtrasTitle,
} from '../app/watch/extras.ts';
import {
  automaticOption, automaticStep, listOptions, othersShowing, readPreference, savePreference, selectTrack, selectedKey, trackNumbers, type EngineLike,
  type ExtraNode, type SubtitleOption, type TextTrackLike, type TrackSet,
} from '../app/watch/subtitle-tracks.ts';
import {parseSubtitleQuery, parseTrailerQuery} from '../lib/extras.ts';
import {buildTitleSection, emptyRowsSection, titleFromCompact} from '../lib/browse.ts';

type LiveCase = {kind: 'live_category'; name: string; hidden: boolean};
const CASES: {kind: string}[] = JSON.parse(readFileSync(new URL('../../docs/extras-cases.json', import.meta.url), 'utf8'));
const LIVE = CASES.filter((item): item is LiveCase => item.kind === 'live_category');

// ------------------------------------------------------------------ the hidden live category

test('live_category cases: Live TV leaves out the provider\'s "Most watched now" category, by name', () => {
  assert.ok(LIVE.length >= 30, 'the shared cases are there');
  assert.ok(LIVE.some(item => item.hidden) && LIVE.some(item => !item.hidden));
  for (const item of LIVE) {
    const channel = {id: 'a', kind: 'live' as const, group: item.name};
    assert.deepEqual(liveLineup([channel]), item.hidden ? [] : [channel], JSON.stringify(item.name));
    // An entry without a kind is a live channel too.
    assert.equal(liveLineup([{group: item.name}]).length, item.hidden ? 0 : 1, JSON.stringify(item.name));
  }
});

test('the lineup keeps live channels in order and leaves movie and series entries out, whatever their group', () => {
  const channels = [
    {id: '1', kind: 'live', group: 'News'}, {id: '2', kind: 'live', group: '|USA| MOST WATCHED NOW'}, {id: '3', group: 'Sports'},
    {id: '4', kind: 'movie', group: 'Movies'}, {id: '5', kind: 'series', group: 'Most watched now'}, {id: '6', kind: 'live', group: 'Most Watched Movies'},
    {id: '7', kind: 'live', group: 'Other'}, {id: '8', kind: 'live', group: 'Most watched'},
  ];
  assert.deepEqual(liveLineup(channels).map(channel => channel.id), ['1', '3', '6', '7']);
});

// ------------------------------------------------------------------ which ids a title sends

const movie = (fields: Partial<ExtrasTitle> = {}): ExtrasTitle => ({kind: 'movie', name: 'The Matrix', year: '1999', tmdb: '', ...fields});
const series = (fields: Partial<ExtrasTitle> = {}): ExtrasTitle => ({kind: 'series', name: 'Game of Thrones', year: '2011', tmdb: '', ...fields});
const params = (query: string) => new URLSearchParams(query);

test('a movie sends its provider TMDB id, else its details\' id, else the matched id, else its name and year', () => {
  assert.equal(subtitleQuery(movie({hint: '603', tmdb: '603'})), 'v=1&type=movie&tmdb=603');
  assert.equal(subtitleQuery(movie({hint: '603', tmdb: ''}), '77'), 'v=1&type=movie&tmdb=603', 'the row\'s own id first, even when the TMDB lists lack it');
  assert.equal(subtitleQuery(movie({tmdb: '949'}), '0603'), 'v=1&type=movie&tmdb=603', 'the details\' id, without its leading zeros, before a match by name');
  assert.equal(subtitleQuery(movie({tmdb: '949'})), 'v=1&type=movie&tmdb=949');
  assert.equal(subtitleQuery(movie({tmdb: '949'}), 'tt0133093'), 'v=1&type=movie&tmdb=949', 'a details value that is no id');
  assert.equal(subtitleQuery(movie({name: 'EN | The Matrix'})), 'v=1&type=movie&name=EN+%7C+The+Matrix&year=1999');
  assert.equal(titleTmdb(movie({hint: '0', tmdb: '12'}), '000'), '12');
  for (const value of ['', '0', '000', '1234567890123', '12a', ' 12', '-5']) assert.equal(tmdbId(value), '', JSON.stringify(value));
  assert.equal(tmdbId('000123456789012'.slice(3)), '123456789012');
});

test('without a TMDB id, a title needs a year from 1800 to 2099 and a name of at most 300 characters', () => {
  for (const year of ['', '199', '1799', '2100', '19999', '199a']) assert.equal(subtitleQuery(movie({year})), '', year);
  for (const year of ['1800', '2099']) assert.equal(params(subtitleQuery(movie({year}))).get('year'), year);
  assert.equal(subtitleQuery(movie({name: ''})), '');
  assert.equal(params(subtitleQuery(movie({name: 'x'.repeat(300)}))).get('name'), 'x'.repeat(300));
  assert.equal(subtitleQuery(movie({name: 'x'.repeat(301)})), '');
  assert.equal(subtitleQuery(movie({name: 'x'.repeat(301), hint: '5'})), 'v=1&type=movie&tmdb=5', 'a long name does not matter with an id');
});

test('an episode sends the series\' ids with its season and episode, in the documented order', () => {
  assert.equal(subtitleQuery(series({hint: '1399'}), '', {season: 1, episode: 3}), 'v=1&type=episode&tmdb=1399&season=1&episode=3');
  assert.equal(subtitleQuery(series(), '1399', {season: 0, episode: 12}), 'v=1&type=episode&tmdb=1399&season=0&episode=12', 'specials are season 0');
  assert.equal(subtitleQuery(series({name: 'Show | EN'}), '', {season: 2, episode: 1}), 'v=1&type=episode&season=2&episode=1&name=Show+%7C+EN&year=2011');
  for (const numbers of [{season: 1, episode: 0}, {season: -1, episode: 1}, {season: 101, episode: 1}, {season: 1, episode: 5001}, {season: 9999, episode: 9999},
    {season: 1.5, episode: 1}, {season: 1, episode: NaN}])
    assert.equal(subtitleQuery(series({hint: '1399'}), '', numbers), '', JSON.stringify(numbers));
  assert.equal(subtitleQuery(series({hint: '1399'}), '', {season: 100, episode: 5000}), 'v=1&type=episode&tmdb=1399&season=100&episode=5000', 'the widest the endpoint accepts');
  assert.equal(subtitleQuery(series({hint: '1399'})), '', 'a series without an episode');
  assert.equal(subtitleQuery({kind: 'episode', name: 'Show S01E02', year: '2011', tmdb: '5'}), '', 'a playlist entry that is a single episode');
  assert.equal(subtitleQuery(movie({hint: '603'}), '', {season: 1, episode: 1}), '', 'a movie has no episodes');
  assert.equal(subtitleQuery(series({year: ''}), '', {season: 1, episode: 1}), '', 'no id and no year');
});

test('the trailer asks for a movie or a series (type tv), never for a single episode', () => {
  assert.equal(trailerQuery(movie({hint: '603'})), 'v=1&type=movie&tmdb=603');
  assert.equal(trailerQuery(series({tmdb: '1399'})), 'v=1&type=tv&tmdb=1399');
  assert.equal(trailerQuery(series(), '01399'), 'v=1&type=tv&tmdb=1399');
  assert.equal(trailerQuery(movie()), 'v=1&type=movie&name=The+Matrix&year=1999');
  assert.equal(trailerQuery(movie({year: ''})), '');
  assert.equal(trailerQuery({kind: 'episode', name: 'Show S01E02', year: '2011', tmdb: '5', hint: '5'}), '');
});

test('the endpoints accept every query the player sends, with the same ids', () => {
  const lookups: [string, unknown][] = [
    [subtitleQuery(movie({hint: '603'})), {media: 'movie', episode: null, tmdb: 603, name: '', year: ''}],
    [subtitleQuery(movie({name: 'Crazy, Stupid, Love & Co (2011) +1', year: '2011'})), {media: 'movie', episode: null, tmdb: null, name: 'Crazy, Stupid, Love & Co (2011) +1', year: '2011'}],
    [subtitleQuery(series({hint: '1399'}), '', {season: 0, episode: 3}), {media: 'tv', episode: {season: 0, episode: 3}, tmdb: 1399, name: '', year: ''}],
    [subtitleQuery(series({name: '\u00dcn\u00efcode | Show'}), '', {season: 4, episode: 2}), {media: 'tv', episode: {season: 4, episode: 2}, tmdb: null, name: '\u00dcn\u00efcode | Show', year: '2011'}],
  ];
  for (const [query, expected] of lookups) assert.deepEqual(parseSubtitleQuery(params(query)), expected, query);
  assert.deepEqual(parseTrailerQuery(params(trailerQuery(series({hint: '1399'})))), {media: 'tv', episode: null, tmdb: 1399, name: '', year: ''});
  assert.deepEqual(parseTrailerQuery(params(trailerQuery(movie()))), {media: 'movie', episode: null, tmdb: null, name: 'The Matrix', year: '1999'});
});

test('the browse index keeps a provider\'s TMDB id even when no TMDB list holds it', () => {
  const titles = [titleFromCompact('movie', {id: '1', name: 'Heat', tmdb: '949'}), titleFromCompact('movie', {id: '2', name: 'Dune'})];
  const items = buildTitleSection(titles, [], emptyRowsSection(), []).items;
  assert.deepEqual(items.map(item => [item.hint, item.tmdb]), [['949', ''], [undefined, '']]);
  assert.equal(subtitleQuery(items[0]), 'v=1&type=movie&tmdb=949');
});

// ------------------------------------------------------------------ answers

const ORIGIN = 'https://lumanest.tv';
const TOKEN = '4486640-kZ0n3x6m1Gm2v5PqLr8sTw';
const fileURL = (token = TOKEN, ext = 'vtt', origin = ORIGIN) => origin + '/api/extras/subtitles/file/' + token + '.' + ext;
const track = (fields: Record<string, unknown> = {}) => ({id: TOKEN, lang: 'en', label: 'English (OpenSubtitles)', hi: false, vtt: fileURL(), srt: fileURL(TOKEN, 'srt'), ...fields});
const tokenN = (n: number) => n + '-' + String(n).padStart(22, 'A');

test('a subtitles answer gives at most three English tracks, each a WebVTT file on this page\'s origin', () => {
  assert.deepEqual(readSubtitleAnswer({v: 1, status: 'ok', tmdb: 603, tracks: [track()], credit: 'x'}, ORIGIN),
    [{id: TOKEN, label: 'English (OpenSubtitles)', hi: false, src: '/api/extras/subtitles/file/' + TOKEN + '.vtt'}]);
  const five = [1, 2, 3, 4, 5].map(n => track({id: tokenN(n), vtt: fileURL(tokenN(n)), label: 'English (OpenSubtitles ' + n + ')'}));
  assert.deepEqual(readSubtitleAnswer({tracks: five}, ORIGIN).map(item => item.id), [tokenN(1), tokenN(2), tokenN(3)]);
  const refused: [string, Record<string, unknown>][] = [
    ['another origin', {vtt: fileURL(TOKEN, 'vtt', 'https://evil.example')}],
    ['http on an https page', {vtt: fileURL(TOKEN, 'vtt', 'http://lumanest.tv')}],
    ['another port', {vtt: fileURL(TOKEN, 'vtt', 'https://lumanest.tv:8443')}],
    ['the SRT file', {vtt: fileURL(TOKEN, 'srt')}],
    ['a path the file endpoint does not answer', {vtt: ORIGIN + '/api/player/stream?token=' + TOKEN}],
    ['a query string', {vtt: fileURL() + '?x=1'}],
    ['a fragment', {vtt: fileURL() + '#t=1'}],
    ['a script address', {vtt: 'javascript:alert(1)'}],
    ['not an address', {vtt: 'not a url'}],
    ['an id that is not the file\'s', {id: tokenN(9)}],
    ['an id that is no token', {id: '../x'}],
    ['another language', {lang: 'fr'}],
    ['no language', {lang: undefined}],
    ['no file', {vtt: undefined}],
  ];
  for (const [note, fields] of refused) assert.deepEqual(readSubtitleAnswer({tracks: [track(fields)]}, ORIGIN), [], note);
  for (const data of [null, 'x', [], {}, {tracks: 'x'}, {tracks: {0: track()}}, {tracks: [null, 5, 'x', []]}]) assert.deepEqual(readSubtitleAnswer(data, ORIGIN), [], JSON.stringify(data));
  assert.equal(readSubtitleAnswer({tracks: [track(), track()]}, ORIGIN).length, 1, 'one file once');
  assert.deepEqual(readSubtitleAnswer({tracks: [track({vtt: fileURL(TOKEN, 'vtt', 'http://127.0.0.1:8787')})]}, 'http://127.0.0.1:8787').map(item => item.src), ['/api/extras/subtitles/file/' + TOKEN + '.vtt']);
});

test('track labels are one line of plain text, at most 100 characters, with a default', () => {
  const label = (value: unknown, hi = false) => readSubtitleAnswer({tracks: [track({label: value, hi})]}, ORIGIN)[0].label;
  assert.equal(label('English\n<b>SDH</b>\u0000 (Open\tSubtitles)\u2028'), 'English <b>SDH</b> (Open Subtitles)', 'controls and line breaks become spaces; markup stays text');
  assert.equal(label('x'.repeat(150)), 'x'.repeat(100));
  assert.equal(label('\ud83d\ude00'.repeat(120)), '\ud83d\ude00'.repeat(100), 'never half a surrogate pair');
  assert.equal(label(''), 'English (OpenSubtitles)');
  assert.equal(label(5), 'English (OpenSubtitles)');
  assert.equal(label(undefined, true), 'English SDH (OpenSubtitles)');
  assert.equal(readSubtitleAnswer({tracks: [track({hi: 'true'})]}, ORIGIN)[0].hi, false, 'only true is true');
  assert.equal(readSubtitleAnswer({tracks: [track({hi: true})]}, ORIGIN)[0].hi, true);
});

test('a trailer answer gives a checked YouTube key and a plain name; addresses are built only from a checked key', () => {
  assert.deepEqual(readTrailerAnswer({v: 1, status: 'ok', tmdb: 603, trailer: {key: 'vKQi3bBA1y8', name: 'Official Trailer', url: 'x', short: 'y', qr: []}}), {key: 'vKQi3bBA1y8', name: 'Official Trailer'});
  assert.deepEqual(readTrailerAnswer({trailer: {key: 'a-b_C0123zZ'}}), {key: 'a-b_C0123zZ', name: 'Trailer'});
  for (const key of ['vKQi3bBA1y', 'vKQi3bBA1y8a', 'vKQi3bBA1y/', 'vKQi3bBA1y"', '../vKQi3bBA', 5, null, ' vKQi3bBA1y'])
    assert.equal(readTrailerAnswer({trailer: {key}}), null, JSON.stringify(key));
  for (const data of [null, {}, {trailer: null}, {trailer: 'vKQi3bBA1y8'}, {status: 'ok'}]) assert.equal(readTrailerAnswer(data), null, JSON.stringify(data));
  assert.equal(readTrailerAnswer({trailer: {key: 'vKQi3bBA1y8', name: 'Teaser\n\n2'}})!.name, 'Teaser 2');
  assert.equal(trailerEmbedSrc('vKQi3bBA1y8'), 'https://www.youtube-nocookie.com/embed/vKQi3bBA1y8?autoplay=1&rel=0&playsinline=1');
  assert.equal(trailerWatchURL('vKQi3bBA1y8'), 'https://www.youtube.com/watch?v=vKQi3bBA1y8');
  for (const key of ['', 'vKQi3bBA1y', 'vKQi3bBA1y8?x', 'javascript:', '"><script>']) {
    assert.equal(trailerEmbedSrc(key), '', key);
    assert.equal(trailerWatchURL(key), '', key);
    assert.equal(trailerFrame(key), null, key);
  }
});

test('the trailer iframe is sandboxed: the embed plays and opens YouTube in a new tab, but can\'t navigate this page', () => {
  const frame = trailerFrame('vKQi3bBA1y8')!;
  assert.equal(frame.src, trailerEmbedSrc('vKQi3bBA1y8'));
  assert.deepEqual(frame.sandbox.split(' ').sort(), ['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation', 'allow-same-origin', 'allow-scripts']);
  assert.doesNotMatch(frame.sandbox, /top-navigation|allow-forms|allow-modals|allow-downloads/);
  assert.equal(frame.allow, 'autoplay; encrypted-media; picture-in-picture; fullscreen', 'the existing permissions stay');
  assert.equal(frame.allowFullScreen, true);
  assert.equal(frame.referrerPolicy, 'strict-origin-when-cross-origin', 'YouTube\'s embed needs a referrer');
  // The dialog renders exactly these attributes.
  const source = readFileSync(new URL('../app/watch/trailer.tsx', import.meta.url), 'utf8');
  assert.match(source, /<iframe src=\{frame\.src\} title=\{frame\.title\} allow=\{frame\.allow\} allowFullScreen=\{frame\.allowFullScreen\} referrerPolicy=\{frame\.referrerPolicy\} sandbox=\{frame\.sandbox\}\/>/);
  assert.equal(source.match(/<iframe/g)?.length, 1);
});

// ------------------------------------------------------------------ lookups

type Call = {path: string; init: RequestInit};
function fakeServer(answer: (path: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetcher = async (path: string, init: RequestInit) => {calls.push({path, init}); return answer(path, init);};
  return {calls, fetcher};
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const OK = {v: 1, status: 'ok', tmdb: 603, tracks: [track()], credit: 'Subtitles provided by OpenSubtitles.com'};

test('lookups go to /api/extras without cookies, and a 200 answer of any status is kept for the page load', async () => {
  const server = fakeServer(path => path.includes('trailer') ? json({v: 1, status: 'ok', trailer: {key: 'vKQi3bBA1y8', name: 'T'}}) :
    path.includes('tmdb=1') ? json({v: 1, status: 'not_configured', tmdb: null, tracks: []}) : json(OK));
  const client = createExtrasClient(server.fetcher, ORIGIN);
  const first = await client.subtitles('v=1&type=movie&tmdb=603');
  assert.equal(first.length, 1);
  assert.equal(await client.subtitles('v=1&type=movie&tmdb=603'), first, 'the same answer, not asked again');
  assert.deepEqual(await client.subtitles('v=1&type=movie&tmdb=1'), []);
  assert.deepEqual(await client.subtitles('v=1&type=movie&tmdb=1'), []);
  assert.deepEqual(await client.trailer('v=1&type=movie&tmdb=603'), {key: 'vKQi3bBA1y8', name: 'T'});
  await client.trailer('v=1&type=movie&tmdb=603');
  assert.deepEqual(server.calls.map(call => call.path), ['/api/extras/subtitles?v=1&type=movie&tmdb=603', '/api/extras/subtitles?v=1&type=movie&tmdb=1', '/api/extras/trailer?v=1&type=movie&tmdb=603']);
  for (const call of server.calls) {
    assert.equal(call.init.credentials, 'omit');
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.deepEqual(await client.subtitles(''), []);
  assert.equal(await client.trailer(''), null);
  assert.equal(server.calls.length, 3, 'nothing to ask, no request');
});

test('lookups that overlap share one request', async () => {
  let release: (response: Response) => void = () => {};
  const server = fakeServer(() => new Promise<Response>(resolve => {release = resolve;}));
  const client = createExtrasClient(server.fetcher, ORIGIN);
  const both = Promise.all([client.subtitles('v=1&type=movie&tmdb=603'), client.subtitles('v=1&type=movie&tmdb=603')]);
  await Promise.resolve();
  release(json(OK));
  const [a, b] = await both;
  assert.equal(a, b);
  assert.equal(server.calls.length, 1);
});

test('a failure is "nothing", silently, and is asked again next time', async () => {
  const failures: (() => Response | Promise<Response>)[] = [
    () => json({v: 1, error: {code: 'rate_limited', message: 'x'}}, 429), () => json(OK, 503), () => json(OK, 404), () => json(OK, 201), () => json(OK, 202),
    () => new Response('not json', {status: 200}), () => Promise.reject(new TypeError('offline')),
  ];
  for (const failure of failures) {
    let calls = 0;
    const client = createExtrasClient(async () => {calls++; return failure();}, ORIGIN);
    assert.deepEqual(await client.subtitles('v=1&type=movie&tmdb=603'), []);
    assert.equal(await client.trailer('v=1&type=movie&tmdb=603'), null);
    assert.deepEqual(await client.subtitles('v=1&type=movie&tmdb=603'), []);
    assert.equal(calls, 3, String(failure));
  }
});

test('a lookup gives up after its timeout', async () => {
  let aborted = false;
  const client = createExtrasClient((_path, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => {aborted = true; reject(new DOMException('aborted', 'AbortError'));});
  }), ORIGIN, 30);
  const started = Date.now();
  assert.deepEqual(await client.subtitles('v=1&type=movie&tmdb=603'), []);
  assert.ok(aborted, 'the request was aborted');
  assert.ok(Date.now() - started < 2000);
});

test('at most 200 answers are kept, the oldest dropped first', async () => {
  const server = fakeServer(() => json({v: 1, status: 'none', tracks: []}));
  const client = createExtrasClient(server.fetcher, ORIGIN);
  for (let i = 1; i <= LOOKUP_CACHE_MAX + 1; i++) await client.subtitles('v=1&type=movie&tmdb=' + i);
  assert.equal(server.calls.length, LOOKUP_CACHE_MAX + 1);
  await client.subtitles('v=1&type=movie&tmdb=2');
  assert.equal(server.calls.length, LOOKUP_CACHE_MAX + 1, 'the second is still kept');
  await client.subtitles('v=1&type=movie&tmdb=1');
  assert.equal(server.calls.length, LOOKUP_CACHE_MAX + 2, 'the first was dropped');
});

// ------------------------------------------------------------------ the subtitle menu (stand-ins for the video)

const text = (kind: string, label: string, language: string, mode: TextTrackLike['mode'] = 'disabled'): TextTrackLike => ({kind, label, language, mode});
/** A video with an hls.js subtitle playlist (its own <track>), captions hls.js found, chapters, and two OpenSubtitles tracks. */
function video() {
  const playlist = text('subtitles', 'Deutsch', 'de');
  const captions = text('captions', '', 'en');
  const chapters = text('chapters', 'Chapters', '');
  const osA = text('subtitles', 'English (OpenSubtitles)', 'en');
  const osB = text('subtitles', 'English SDH (OpenSubtitles 2)', 'en');
  const engine: EngineLike = {subtitleTracks: [{name: 'Deutsch', lang: 'de', trackNode: {track: playlist}}], subtitleTrack: -1, subtitleDisplay: false};
  const set: TrackSet = {textTracks: [playlist, captions, chapters, osA, osB], extras: [{id: 'a', label: osA.label, track: osA}, {id: 'b', label: osB.label, track: osB}]};
  return {set, engine, playlist, captions, chapters, osA, osB, numberOf: trackNumbers()};
}

test('the menu lists the stream\'s tracks, then the OpenSubtitles ones', () => {
  const {set, engine, numberOf} = video();
  assert.deepEqual(listOptions(set, engine, numberOf), [
    {key: 'hls:0', label: 'Deutsch', lang: 'de', source: 'stream'},
    {key: 'text:0', label: 'EN', lang: 'en', source: 'stream'},
    {key: 'os:a', label: 'English (OpenSubtitles)', lang: 'en', source: 'opensubtitles'},
    {key: 'os:b', label: 'English SDH (OpenSubtitles 2)', lang: 'en', source: 'opensubtitles'},
  ]);
  assert.deepEqual(listOptions({textTracks: [], extras: []}, null, numberOf), []);
  assert.deepEqual(listOptions({textTracks: [text('subtitles', '', '')], extras: []}, null, trackNumbers()).map(item => item.label), ['Subtitles 1']);
});

test('one track shows at a time, and a track that isn\'t shown is disabled, never hidden (so its file isn\'t fetched)', () => {
  const {set, engine, captions, osA, osB, numberOf} = video();
  const modes = () => [engine.subtitleTrack, captions.mode, osA.mode, osB.mode];
  selectTrack(set, engine, 'os:a', numberOf);
  assert.deepEqual(modes(), [-1, 'disabled', 'showing', 'disabled']);
  assert.equal(selectedKey(set, engine, numberOf), 'os:a');
  selectTrack(set, engine, 'text:0', numberOf);
  assert.deepEqual(modes(), [-1, 'showing', 'disabled', 'disabled'], 'choosing the stream\'s captions turns OpenSubtitles off');
  assert.equal(selectedKey(set, engine, numberOf), 'text:0');
  selectTrack(set, engine, 'os:b', numberOf);
  assert.deepEqual(modes(), [-1, 'disabled', 'disabled', 'showing']);
  selectTrack(set, engine, 'hls:0', numberOf);
  assert.deepEqual([...modes(), engine.subtitleDisplay], [0, 'disabled', 'disabled', 'disabled', true], 'a subtitle playlist turns OpenSubtitles off');
  assert.equal(selectedKey(set, engine, numberOf), 'hls:0');
  osA.mode = 'hidden';
  selectTrack(set, engine, 'off', numberOf);
  assert.deepEqual(modes(), [-1, 'disabled', 'disabled', 'disabled']);
  assert.equal(selectedKey(set, engine, numberOf), 'off');
  const seen: string[] = [];
  const watched = video();
  for (const item of [watched.captions, watched.osA, watched.osB]) {
    let mode = item.mode;
    Object.defineProperty(item, 'mode', {get: () => mode, set: (value: TextTrackLike['mode']) => {seen.push(value); mode = value;}});
  }
  for (const key of ['os:a', 'os:b', 'text:0', 'off']) selectTrack(watched.set, null, key, watched.numberOf);
  assert.ok(!seen.includes('hidden'), seen.join());
});

test('an OpenSubtitles track becomes a <track> only when it is shown, and only once', () => {
  const {set, engine, numberOf, osA} = video();
  const attached: string[] = [];
  const lazy = text('subtitles', 'English (OpenSubtitles 3)', 'en');
  const node: ExtraNode = {id: 'c', label: lazy.label, track: null, attach: () => {
    attached.push('c'); node.track = lazy; (set.textTracks as TextTrackLike[]).push(lazy); return lazy;
  }};
  set.extras.push(node);
  assert.deepEqual(listOptions(set, engine, numberOf).map(item => item.key).slice(-1), ['os:c'], 'listed before it exists');
  assert.equal(selectedKey(set, engine, numberOf), 'off');
  for (const key of ['os:a', 'text:0', 'hls:0', 'os:b', 'off']) selectTrack(set, engine, key, numberOf);
  assert.deepEqual(attached, [], 'nothing attached for the other choices');
  selectTrack(set, engine, 'os:c', numberOf);
  assert.deepEqual([attached, lazy.mode, osA.mode, selectedKey(set, engine, numberOf)], [['c'], 'showing', 'disabled', 'os:c']);
  selectTrack(set, engine, 'os:a', numberOf);
  assert.deepEqual([lazy.mode, osA.mode], ['disabled', 'showing']);
  selectTrack(set, engine, 'os:c', numberOf);
  assert.deepEqual(attached, ['c'], 'attached once');
  set.extras.push({id: 'd', label: 'x', track: null, attach: () => null});
  selectTrack(set, engine, 'os:d', numberOf);
  assert.equal(selectedKey(set, engine, numberOf), 'off', 'a track that could not be attached shows nothing');
});

test('a track the browser turns on beside the one shown is noticed, so the player can turn it off again', () => {
  const {set, engine, captions, osA, numberOf} = video();
  selectTrack(set, engine, 'os:a', numberOf);
  assert.equal(othersShowing(set, engine, 'os:a', numberOf), false);
  captions.mode = 'showing';
  assert.equal(othersShowing(set, engine, 'os:a', numberOf), true, 'Chrome turned the captions on');
  selectTrack(set, engine, 'os:a', numberOf);
  assert.deepEqual([captions.mode, osA.mode, othersShowing(set, engine, 'os:a', numberOf)], ['disabled', 'showing', false]);
  engine.subtitleTrack = 0; engine.subtitleDisplay = true;
  assert.equal(othersShowing(set, engine, 'os:a', numberOf), true, 'hls.js shows a playlist beside it');
  selectTrack(set, engine, 'hls:0', numberOf);
  assert.equal(othersShowing(set, engine, 'hls:0', numberOf), false);
  osA.mode = 'showing';
  assert.equal(othersShowing(set, engine, 'hls:0', numberOf), true);
  selectTrack(set, engine, 'off', numberOf);
  captions.mode = 'showing';
  assert.equal(othersShowing(set, engine, 'os:a', numberOf), false, 'the shown track was turned off: nothing to put back');
  assert.equal(othersShowing(set, engine, 'off', numberOf), false);
  osA.mode = 'showing';
  assert.equal(othersShowing(set, engine, 'hls:0', numberOf), false, 'two others show, but not the track the player showed');
});

test('track keys stay with their track as tracks come and go', () => {
  const numberOf = trackNumbers();
  const first = text('captions', 'A', 'en'), second = text('captions', 'B', 'fr');
  assert.deepEqual(listOptions({textTracks: [first, second], extras: []}, null, numberOf).map(item => item.key), ['text:0', 'text:1']);
  assert.deepEqual(listOptions({textTracks: [text('subtitles', 'C', 'de'), second], extras: []}, null, numberOf).map(item => item.key), ['text:2', 'text:1']);
});

const option = (key: string, lang: string, source: SubtitleOption['source'] = 'stream', label = key): SubtitleOption => ({key, label, lang, source});

test('the automatic choice: the stream\'s track in the last language, its English one, the first OpenSubtitles track, its first track', () => {
  const de = option('hls:0', 'de'), en = option('text:0', 'en-US'), fr = option('text:1', 'fr'), osA = option('os:a', 'en', 'opensubtitles'), osB = option('os:b', 'en', 'opensubtitles');
  assert.equal(automaticOption([de, fr, osA, osB], 'fr')?.key, 'text:1');
  assert.equal(automaticOption([de, en, osA], 'es')?.key, 'text:0', 'English before OpenSubtitles');
  assert.equal(automaticOption([de, option('text:5', '', 'stream', 'English CC'), osA], '')?.key, 'text:5', 'English by its label');
  assert.equal(automaticOption([de, option('text:6', 'eng'), osA], '')?.key, 'text:6');
  assert.equal(automaticOption([de, fr, osB, osA], 'es')?.key, 'os:b', 'the first OpenSubtitles track before the stream\'s fallback');
  assert.equal(automaticOption([de, fr], 'es')?.key, 'hls:0', 'the old fallback');
  assert.equal(automaticOption([osA, en], 'en')?.key, 'text:0', 'the last language picks among the stream\'s tracks first');
  assert.equal(automaticOption([osA], 'en')?.key, 'os:a');
  assert.equal(automaticOption([], 'en'), undefined);
});

test('Settings > Subtitles On shows OpenSubtitles when they arrive, unless the viewer or a better stream track decided', () => {
  const de = option('hls:0', 'de'), en = option('text:0', 'en'), osA = option('os:a', 'en', 'opensubtitles'), osB = option('os:b', 'en', 'opensubtitles');
  const none = new Set<string>();
  const on = {on: true, lang: ''};
  assert.equal(automaticStep([osA, osB], 'off', null, '', none), null, 'never chosen: leave the stream as it is');
  assert.equal(automaticStep([osA, osB], 'os:a', {on: false, lang: 'en'}, '', none), 'off', 'Off');
  assert.equal(automaticStep([osA, osB], 'off', on, '', none), 'os:a', 'On: the first OpenSubtitles track');
  assert.equal(automaticStep([osA, osB], 'off', on, '', new Set(['os:a'])), 'os:b', 'not a track whose file failed');
  assert.equal(automaticStep([osA], 'off', on, '', new Set(['os:a'])), null);
  assert.equal(automaticStep([de, osA], 'hls:0', on, 'hls:0', none), 'os:a', 'OpenSubtitles replace the fallback the automatic choice showed');
  assert.equal(automaticStep([de, osA], 'hls:0', on, '', none), null, 'but not a track the stream showed by default');
  assert.equal(automaticStep([en, osA], 'text:0', on, 'text:0', none), null, 'nor the stream\'s English track');
  assert.equal(automaticStep([en, osA], 'os:a', on, 'os:a', none), 'text:0', 'the stream\'s English track, found later, comes first');
});

test('the saved preference: on or off and the last language, read safely', () => {
  const store = (value: string | null) => {
    const saved: string[] = [];
    return {saved, getItem: () => value, setItem: (_key: string, item: string) => {saved.push(item);}};
  };
  assert.deepEqual(readPreference(store('{"on":true,"lang":"en"}')), {on: true, lang: 'en'});
  assert.deepEqual(readPreference(store('{"on":false}')), {on: false, lang: ''});
  assert.deepEqual(readPreference(store('{"on":true,"lang":"' + 'x'.repeat(30) + '"}')), {on: true, lang: 'x'.repeat(20)});
  for (const value of [null, '', 'not json', '5', '{"on":"yes"}', '[true]']) assert.equal(readPreference(store(value)), null, String(value));
  assert.equal(readPreference(null), null);
  assert.equal(readPreference({getItem: () => {throw new Error('blocked');}, setItem: () => {}}), null);
  const target = store(null);
  assert.equal(savePreference({on: true, lang: 'en'}, target), true);
  assert.deepEqual(target.saved, ['{"on":true,"lang":"en"}']);
  assert.equal(savePreference({on: true, lang: 'en'}, {getItem: () => null, setItem: () => {throw new Error('full');}}), false);
  assert.equal(savePreference({on: true, lang: 'en'}, null), false);
});
