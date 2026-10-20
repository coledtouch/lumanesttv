// The pure rules of subtitles, trailers and the hidden live category (lib/extras.ts): every server case of
// docs/extras-cases.json (all kinds but vtt_cues, which the apps that draw cues run), which the Tuner apps' tests run
// too, plus the endpoints' parameter rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CLIENT_DAILY_DOWNLOADS, CREDIT, DAILY_DOWNLOADS, EPISODE_MAX, FILE_PATH, MARKUP_PASSES, MAX_CUES, NETWORK_DAILY_DOWNLOADS, SEASON_MAX, YOUTUBE_KEY, clientMacInput,
  clientNetwork, clientPrefix, cueText,
  dailyDownloads, utcDay, isHiddenLiveCategory, matchResolved, parseSrt, parseSubtitleQuery, parseTrailerQuery, pickSubtitles,
  pickTrailer, resolveHashInput, resolveKeys, resolveObject, subtitleSearchPath, subtitlesObject, toSrt, toVtt, tmdbSearch, trackLabel, trailerName,
  trailerObject, type SubtitleRequest,
} from '../lib/extras.ts';

type Case =
  | {kind: 'srt_vtt'; note: string; srt: string; vtt: string; srt_out: string; cues: number}
  | {kind: 'cue_text'; input: string; text: string}
  | {kind: 'vtt_cues'; note: string; vtt: string; cues: {start: number; end: number; text: string}[]; at: [number, string][]}
  | {kind: 'subtitle_pick'; note: string; request: SubtitleRequest; data: unknown[]; expect: {file_id: number; hi: boolean; label: string}[]}
  | {kind: 'trailer'; note: string; results: unknown[]; expect: string | null}
  | {kind: 'live_category'; name: string; hidden: boolean};

const CASES: Case[] = JSON.parse(readFileSync(new URL('../../docs/extras-cases.json', import.meta.url), 'utf8'));
const of = <K extends Case['kind']>(kind: K) => CASES.filter((c): c is Extract<Case, {kind: K}> => c.kind === kind);

test('the shared cases file holds every kind and is all ASCII', () => {
  const raw = readFileSync(new URL('../../docs/extras-cases.json', import.meta.url), 'utf8');
  assert.match(raw, /^[\x09\x0a\x0d\x20-\x7e]*$/);
  for (const kind of ['srt_vtt', 'cue_text', 'vtt_cues', 'subtitle_pick', 'trailer', 'live_category'] as const) assert.ok(of(kind).length > 0, kind);
});

test('srt_vtt cases: WebVTT and SRT output and cue counts', () => {
  for (const c of of('srt_vtt')) {
    const cues = parseSrt(c.srt);
    assert.equal(cues.length, c.cues, c.note);
    assert.equal(toVtt(cues), c.vtt, c.note);
    assert.equal(toSrt(cues), c.srt_out, c.note);
  }
});

test('cue_text cases: step 3 alone', () => {
  for (const c of of('cue_text')) assert.equal(cueText(c.input).join('\n'), c.text, JSON.stringify(c.input));
});

test('subtitle_pick cases', () => {
  for (const c of of('subtitle_pick')) assert.deepEqual(pickSubtitles(c.request, c.data), c.expect, c.note);
});

test('trailer cases', () => {
  for (const c of of('trailer')) assert.equal(pickTrailer(c.results)?.key ?? null, c.expect, c.note);
});

test('live_category cases', () => {
  for (const c of of('live_category')) assert.equal(isHiddenLiveCategory(c.name), c.hidden, JSON.stringify(c.name));
  for (const value of [null, undefined, 5, ['Most watched now'], {name: 'Most watched now'}]) assert.equal(isHiddenLiveCategory(value), false);
});

// ------------------------------------------------------------------ the app-side reader, to check the server's output

/** docs/extras.md "Reading WebVTT", as the apps that draw cues implement it. */
function readVtt(input: string) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lines = text.split(/\r\n|\r|\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])) return [];
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines.slice(1)) {
    if (line === '') {if (block.length) blocks.push(block); block = [];}
    else block.push(line);
  }
  if (block.length) blocks.push(block);
  const timing = /^((?:[0-9]{2,}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})[ \t]+-->[ \t]+((?:[0-9]{2,}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})(?:[ \t].*)?$/;
  const stamp = (s: string) => {
    const m = /^(?:([0-9]{2,}):)?([0-9]{2}):([0-9]{2})\.([0-9]{3})$/.exec(s)!;
    if (Number(m[2]) > 59 || Number(m[3]) > 59) return null;
    return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
  };
  const entities: Record<string, string> = {amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'"};
  const cues: {start: number; end: number; text: string}[] = [];
  for (const b of blocks) {
    const index = b.slice(0, 2).findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const m = timing.exec(b[index]);
    if (!m) continue;
    const start = stamp(m[1]), end = stamp(m[2]);
    if (start === null || end === null || end <= start) continue;
    const body = b.slice(index + 1).map(line => line.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|nbsp|quot|apos);/g, (_, name) => entities[name]).replace(/^[ \t]+|[ \t]+$/g, '')).filter(Boolean);
    if (body.length) cues.push({start, end, text: body.join('\n')});
  }
  return cues.sort((a, b) => a.start - b.start);
}
const textAt = (cues: {start: number; end: number; text: string}[], ms: number) => cues.filter(c => c.start <= ms && ms < c.end).map(c => c.text).join('\n');

test('the reference reader passes the vtt_cues cases (so the round trip below means something)', () => {
  for (const c of of('vtt_cues')) {
    const cues = readVtt(c.vtt);
    assert.deepEqual(cues, c.cues, c.note);
    for (const [ms, text] of c.at) assert.equal(textAt(cues, ms), text, c.note + ' at ' + ms);
  }
});

test("the server's .vtt output reads back as exactly its cues", () => {
  const files = [...of('srt_vtt').map(c => c.srt), ...of('cue_text').map(c => '1\n00:00:01,000 --> 00:00:02,000\n' + c.input + '\n')];
  // Text that looks like markup or a timing line once decoded must stay text.
  files.push('1\n00:00:01,000 --> 00:00:02,000\n--&gt; 00:00:05.000 --&gt; x\n&lt;c.red&gt;red&lt;/c&gt; &amp;amp; &#60;i&#62;\n');
  for (const srt of files) {
    const cues = parseSrt(srt);
    assert.deepEqual(readVtt(toVtt(cues)), cues.map(c => ({start: c.start, end: c.end, text: c.lines.join('\n')})), JSON.stringify(srt));
    assert.equal(toVtt(cues).split('\n').slice(1).filter(line => line.includes('-->')).length, cues.length, 'one arrow per cue, none in text');
  }
});

// ------------------------------------------------------------------ SRT details beyond the cases

test('conversion never lets a line break or markup through from entities', () => {
  // &#13; is a line break like the file's own CR: no output line can carry a CR, so no cue can be injected.
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nA&#13;&#13;2&#13;00:00:05,000 --> 00:59:00,000&#13;B&#10;C\n');
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].lines, ['A', '2', '00:00:05,000 -> 00:59:00,000', 'B', 'C']);
  assert.doesNotMatch(toVtt(cues) + toSrt(cues), /\r/);
  assert.match(toVtt(cues), /\n00:00:05,000 -&gt; 00:59:00,000\n/);
  assert.deepEqual(cueText('&lt;script&gt;x&lt;/script&gt;&#60;img src=x onerror=y&#62;'), ['x']);
  assert.deepEqual(cueText('a\u2028b\u2029c\u0085d'), ['a b c d']);
  assert.deepEqual(cueText('&AMP; &Amp; &amp'), ['&AMP; &Amp; &amp']);
  assert.deepEqual(cueText('&constructor; &toString;'), ['&constructor; &toString;']);
  assert.deepEqual(cueText('&#x10FFFF;&#0;&#xdfff;&#12345678;'), ['\u{10FFFF}&#0;&#xdfff;&#12345678;']);
});

test('the SRT output (Roku) carries no tag, no {...} block and no extra cue, whatever the text', () => {
  // The review's proofs of concept: markup rebuilt by removing a tag, and an encoded index and timing line.
  const srt = toSrt(parseSrt([
    '1', '00:00:01,000 --> 00:00:04,000', '<<b>font color="#ff0000">FAKE<</b>/font>', '<<i>i>visit scam.example<</i>/i>', '',
    '2', '00:00:05,000 --> 00:00:06,000', 'Hi&#10;&#10;99&#10;00:00:00,000 --&gt; 09:59:59,000&#10;OVERLAY', '',
    '3', '00:00:07,000 --> 00:00:08,000', '{\\an{x}8}top {{\\b1}}x <&#8203;b>bold</b> <{x}i>joined</{y}i> 1 ---> 2 -&#x7;-> 3', '',
  ].join('\r\n')));
  assert.equal(srt, '1\n00:00:01,000 --> 00:00:04,000\nFAKE\nvisit scam.example\n\n2\n00:00:05,000 --> 00:00:06,000\nHi\n99\n00:00:00,000 -> 09:59:59,000\nOVERLAY\n\n'
    + '3\n00:00:07,000 --> 00:00:08,000\ntop x bold joined 1 -> 2 -> 3\n');
  assert.equal(parseSrt(srt).length, 3, 'read back: the same three cues, no fake one');
  assert.equal(srt.split('\n').filter(line => line.includes('-->')).length, 3, 'one arrow per cue');
  assert.doesNotMatch(srt, /<\/?[A-Za-z]|\{[^{}\n]*\}/);
});

test('markup removal: repeated until nothing is left, linear on any nesting', () => {
  assert.deepEqual(cueText('<<<<<i>i>i>i>i>x'), ['x'], 'five levels');
  assert.deepEqual(cueText('<'.repeat(MARKUP_PASSES) + 'b>'.repeat(MARKUP_PASSES) + 'ok'), ['ok'], 'exactly MARKUP_PASSES levels: no fallback');
  assert.deepEqual(cueText('<'.repeat(MARKUP_PASSES + 1) + 'b>'.repeat(MARKUP_PASSES + 1) + 'ok < 3 {x'), ['b>ok 3 x'], 'one level more: every < and { goes');
  assert.deepEqual(cueText('x < y, <3, {not closed'), ['x < y, <3, {not closed'], 'a < or { that starts no markup stays');
  // A cue of 1.5 MB nested as deep as it can go: still quick.
  const started = Date.now();
  const deep = cueText('<'.repeat(500000) + 'b>'.repeat(500000));
  assert.ok(Date.now() - started < 2000, 'linear time');
  assert.equal(deep.join('').includes('<'), false);
  // Long runs of hyphens: one pass, no "-->" left.
  assert.deepEqual(cueText('-'.repeat(100000) + '>' + '-->'.repeat(3)), ['->->->->']);
});

test('SRT parsing: CR-only files, trailing cues without a newline, timing lines with spaces', () => {
  const cues = parseSrt('1\r00:00:01,000-->00:00:02,000\rOne\r\r2\r  00:00:03.5 --> 00:00:04,25  \rTwo');
  assert.deepEqual(cues, [{start: 1000, end: 2000, lines: ['One']}, {start: 3500, end: 4250, lines: ['Two']}]);
  assert.deepEqual(parseSrt(''), []);
  assert.deepEqual(parseSrt('\ufeff'), []);
  assert.equal(toVtt([]), 'WEBVTT\n');
  assert.equal(toSrt([]), '');
  // A timing line with a U+2028 after the stamps is still a timing line.
  assert.equal(parseSrt('00:00:01,000 --> 00:00:02,000 \u2028x\nHi\n').length, 1);
});

test('at most MAX_CUES cues are kept, the first ones in file order, quickly', () => {
  const parts: string[] = [];
  for (let i = 0; i < MAX_CUES + 50; i++) {
    const s = MAX_CUES + 50 - i; // descending starts, so the kept ones are the file's first
    parts.push(`${i + 1}\n00:${String(Math.floor(s / 3600) % 60).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')},${String(s % 60).padStart(3, '0')} --> 59:59:59,999\nLine ${i}\n`);
  }
  const started = Date.now();
  const cues = parseSrt(parts.join('\n'));
  assert.equal(cues.length, MAX_CUES);
  assert.ok(cues.some(c => c.lines[0] === 'Line 0'));
  assert.ok(!cues.some(c => c.lines[0] === 'Line ' + (MAX_CUES + 49)));
  assert.ok(Date.now() - started < 2000, 'a big file converts quickly');
  // A long line of almost-stamps doesn't make the timing pattern slow.
  const slow = Date.now();
  parseSrt('1\n' + '0:'.repeat(100000) + '\nText\n' + '1'.repeat(200000) + ' --> \n');
  assert.ok(Date.now() - slow < 1000);
});

// ------------------------------------------------------------------ picking beyond the cases

test('subtitle picks: at most three, labels, SDH last, multi-file and bad shapes skipped', () => {
  const entry = (fileId: number, extra: Record<string, unknown> = {}) => ({attributes: {language: 'en', download_count: 100 - fileId, files: [{file_id: fileId}], feature_details: {feature_type: 'Movie', tmdb_id: 603}, ...extra}});
  const data = [entry(1, {hearing_impaired: true}), entry(2), entry(3), entry(4), entry(5, {files: [{file_id: 5}, {file_id: 6}]}), 'junk', null, {attributes: null}];
  assert.deepEqual(pickSubtitles({type: 'movie', tmdb: 603}, data), [
    {file_id: 2, hi: false, label: 'English (OpenSubtitles)'},
    {file_id: 3, hi: false, label: 'English (OpenSubtitles 2)'},
    {file_id: 4, hi: false, label: 'English (OpenSubtitles 3)'},
  ]);
  assert.deepEqual(pickSubtitles({type: 'movie', tmdb: 603}, [entry(1, {hearing_impaired: true}), entry(9)]).map(f => f.label), ['English (OpenSubtitles)', 'English SDH (OpenSubtitles 2)']);
  assert.deepEqual(pickSubtitles({type: 'movie', tmdb: 603}, {data: []}), []);
  assert.deepEqual(pickSubtitles({type: 'movie', tmdb: 603}, [entry(2147483648), entry(0), entry(1.5)]), []);
  assert.equal(trackLabel(0, true), 'English SDH (OpenSubtitles)');
  assert.equal(trackLabel(2, true), 'English SDH (OpenSubtitles 3)');
});

test('trailer picks: key pattern, names as plain text', () => {
  assert.ok(YOUTUBE_KEY.test('vKQi3bBA1y8'));
  for (const bad of ['vKQi3bBA1y', 'vKQi3bBA1y8x', 'vKQi3bBA1y.', 'vKQi3bBA1y8\n', '']) assert.ok(!YOUTUBE_KEY.test(bad), bad);
  const video = (extra: Record<string, unknown>) => ({iso_639_1: 'en', site: 'YouTube', type: 'Trailer', key: 'vKQi3bBA1y8', official: true, published_at: '2020-01-01T00:00:00.000Z', ...extra});
  assert.deepEqual(pickTrailer([video({name: '  Official\u00a0Trailer\n#2 \u202e '})]), {key: 'vKQi3bBA1y8', name: 'Official Trailer #2'});
  assert.equal(pickTrailer([video({name: 7})])?.name, 'Trailer');
  assert.equal(pickTrailer([video({site: 'youtube'})]), null);
  assert.equal(pickTrailer([video({type: 'Clip'}), video({type: 'Featurette'}), video({type: 'trailer'})]), null);
  assert.equal(pickTrailer('nope'), null);
  const long = trailerName('x'.repeat(99) + '\u{1F600}' + 'y'.repeat(10));
  assert.equal(long, 'x'.repeat(99), 'never half a surrogate pair');
  assert.equal(trailerName('a'.repeat(150)).length, 100);
});

// ------------------------------------------------------------------ requests

test('subtitle lookup parameters', () => {
  const parse = (query: string) => parseSubtitleQuery(new URLSearchParams(query));
  assert.deepEqual(parse('v=1&type=movie&tmdb=603'), {media: 'movie', episode: null, tmdb: 603, name: '', year: ''});
  assert.deepEqual(parse('type=movie&tmdb=603&name=x&year=1&lang=en&extra=1&season=x'), {media: 'movie', episode: null, tmdb: 603, name: '', year: ''}, 'v defaults to 1; name, year and season ignored for this movie');
  assert.deepEqual(parse('v=1&type=episode&tmdb=1399&season=01&episode=0003'), {media: 'tv', episode: {season: 1, episode: 3}, tmdb: 1399, name: '', year: ''});
  assert.deepEqual(parse('v=1&type=episode&tmdb=1399&season=0&episode=1'), {media: 'tv', episode: {season: 0, episode: 1}, tmdb: 1399, name: '', year: ''}, 'season 0 is specials');
  assert.deepEqual(parse('v=1&type=movie&name=EN+%7C+The+Matrix&year=1999'), {media: 'movie', episode: null, tmdb: null, name: 'EN | The Matrix', year: '1999'});
  assert.deepEqual(parse('v=1&type=movie&tmdb=999999999999'), {media: 'movie', episode: null, tmdb: 999999999999, name: '', year: ''});
  assert.deepEqual(parse('v=2&type=movie&tmdb=603'), {error: 'unsupported_version'});
  assert.deepEqual(parse('v=&type=movie&tmdb=603'), {error: 'unsupported_version'});
  for (const bad of [
    'type=film&tmdb=603', 'tmdb=603', 'type=movie', 'type=movie&tmdb=0603', 'type=movie&tmdb=0', 'type=movie&tmdb=1000000000000', 'type=movie&tmdb=60%203',
    'type=movie&tmdb=%EF%BC%96', 'type=movie&tmdb=603&lang=fr', 'type=movie&tmdb=603&lang=', 'type=episode&tmdb=1399&season=1', 'type=episode&tmdb=1399&episode=1',
    'type=episode&tmdb=1399&season=1&episode=0', 'type=episode&tmdb=1399&season=12345&episode=1', 'type=episode&tmdb=1399&season=-1&episode=1',
    'type=episode&tmdb=1399&season=101&episode=1', 'type=episode&tmdb=1399&season=0101&episode=1', 'type=episode&tmdb=1399&season=9999&episode=1',
    'type=episode&tmdb=1399&season=1&episode=5001', 'type=episode&tmdb=1399&season=1&episode=9999', 'type=episode&tmdb=1399&season=1&episode=0000',
    'type=movie&name=Heat', 'type=movie&name=Heat&year=1799', 'type=movie&name=Heat&year=2100', 'type=movie&name=Heat&year=95', 'type=movie&name=&year=1995',
    'type=movie&name=' + 'x'.repeat(301) + '&year=1995',
  ]) assert.deepEqual(parse(bad), {error: 'bad_request'}, bad);
  assert.equal('error' in parse('type=movie&name=' + 'x'.repeat(300) + '&year=1995'), false);
  // The widest season and episode accepted: 0 to 100 and 1 to 5000 (each made-up number costs an upstream search).
  assert.equal(SEASON_MAX, 100);
  assert.equal(EPISODE_MAX, 5000);
  assert.deepEqual(parse('type=episode&tmdb=1399&season=100&episode=5000'), {media: 'tv', episode: {season: 100, episode: 5000}, tmdb: 1399, name: '', year: ''});
  assert.deepEqual(parse('type=episode&tmdb=1399&season=0100&episode=05000'), {error: 'bad_request'}, 'at most 4 digits');
  assert.deepEqual(parse('type=episode&tmdb=1399&season=0100&episode=0001'), {media: 'tv', episode: {season: 100, episode: 1}, tmdb: 1399, name: '', year: ''});
  assert.deepEqual(parse('type=episode&name=Dark&year=2017&season=100&episode=5000'), {media: 'tv', episode: {season: 100, episode: 5000}, tmdb: null, name: 'Dark', year: '2017'});
  assert.deepEqual(parse('type=episode&name=Dark&year=2017&season=101&episode=1'), {error: 'bad_request'});
});

test('trailer lookup parameters', () => {
  const parse = (query: string) => parseTrailerQuery(new URLSearchParams(query));
  assert.deepEqual(parse('v=1&type=movie&tmdb=603'), {media: 'movie', episode: null, tmdb: 603, name: '', year: ''});
  assert.deepEqual(parse('v=1&type=tv&name=Dark&year=2017'), {media: 'tv', episode: null, tmdb: null, name: 'Dark', year: '2017'});
  assert.deepEqual(parse('v=3&type=tv&tmdb=1'), {error: 'unsupported_version'});
  for (const bad of ['type=episode&tmdb=1', 'type=series&tmdb=1', 'type=tv', 'type=tv&tmdb=abc']) assert.deepEqual(parse(bad), {error: 'bad_request'}, bad);
});

test('OpenSubtitles search paths: alphabetical, lower case, defaults left out', () => {
  assert.equal(subtitleSearchPath(603, null), '/subtitles?languages=en&order_by=download_count&order_direction=desc&tmdb_id=603&type=movie');
  assert.equal(subtitleSearchPath(1399, {season: 1, episode: 3}),
    '/subtitles?episode_number=3&languages=en&order_by=download_count&order_direction=desc&parent_tmdb_id=1399&season_number=1&type=episode');
});

test('R2 object names', () => {
  assert.equal(subtitlesObject(603, null), 'extras/v1/subtitles/movie/603/en.json');
  assert.equal(subtitlesObject(1399, {season: 1, episode: 3}), 'extras/v1/subtitles/tv/1399/s1/e3/en.json');
  assert.equal(trailerObject('tv', 1399), 'extras/v1/trailers/tv/1399.json');
  assert.equal(resolveObject('movie', 'ab'), 'extras/v1/resolve/movie/ab.json');
  assert.equal(resolveHashInput('matrix', 'en the matrix', '1999'), 'matrix\nen the matrix\n1999');
});

test('file paths', () => {
  assert.ok(FILE_PATH.test('/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt'));
  assert.ok(FILE_PATH.test('/api/extras/subtitles/file/2147483647-kZ0n3x6m1Gm2v5PqLr8sTw.srt'));
  for (const bad of ['/api/extras/subtitles/file/04486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt', '/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sT.vtt',
    '/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.ass', '/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt/',
    '/api/extras/subtitles/file/12345678901-kZ0n3x6m1Gm2v5PqLr8sTw.vtt', '/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8+Tw.vtt']) assert.ok(!FILE_PATH.test(bad), bad);
});

test('the name fallback: exact normalized title, exact year, one distinct id', () => {
  const {key, whole} = resolveKeys('EN | The Matrix (1999)');
  assert.equal(key, 'matrix');
  assert.deepEqual(tmdbSearch('movie', key, '1999'), ['/search/movie', {query: 'matrix', year: '1999', include_adult: 'false', language: 'en-US', page: '1'}]);
  assert.deepEqual(tmdbSearch('tv', 'dark', '2017'), ['/search/tv', {query: 'dark', first_air_date_year: '2017', include_adult: 'false', language: 'en-US', page: '1'}]);
  const movie = (id: unknown, title: string, date: unknown, original = title) => ({id, title, original_title: original, release_date: date});
  assert.equal(matchResolved('movie', [movie(603, 'The Matrix', '1999-03-30'), movie(604, 'The Matrix Reloaded', '2003-05-15')], key, whole, '1999'), 603);
  assert.equal(matchResolved('movie', [movie(603, 'The Matrix', '1999-03-30'), movie(603, 'Matrix', '1999-01-01')], key, whole, '1999'), 603, 'one distinct id');
  assert.equal(matchResolved('movie', [movie(603, 'The Matrix', '1999-03-30'), movie(9999, 'Matrix', '1999-01-01')], key, whole, '1999'), null, 'two ids');
  assert.equal(matchResolved('movie', [movie(603, 'The Matrix', '2000-03-30')], key, whole, '1999'), null, 'another year');
  assert.equal(matchResolved('movie', [movie(603, 'Matrix Revisited', '1999-03-30')], key, whole, '1999'), null);
  assert.equal(matchResolved('movie', [movie(77, 'Der Film', '1999-01-01', 'The Matrix')], key, whole, '1999'), 77, 'original title');
  assert.equal(matchResolved('movie', [movie('603', 'The Matrix', '1999-03-30'), movie(603.5, 'The Matrix', '1999'), movie(0, 'The Matrix', '1999')], key, whole, '1999'), null);
  assert.equal(matchResolved('movie', [movie(603, 'The Matrix', null)], key, whole, '1999'), null);
  assert.equal(matchResolved('movie', {results: []}, key, whole, '1999'), null);
  assert.equal(matchResolved('movie', [movie(1, '', '1999')], '', '', '1999'), null, 'an empty key never matches');
  // Series: name, original_name and first_air_date; the whole name (tags kept) matches too.
  const keys = resolveKeys('CSI: Miami');
  assert.equal(matchResolved('tv', [{id: 1620, name: 'CSI: Miami', original_name: 'CSI: Miami', first_air_date: '2002-09-23'}], keys.key, keys.whole, '2002'), 1620);
  assert.equal(matchResolved('tv', [{id: 1620, title: 'CSI: Miami', release_date: '2002-09-23'}], keys.key, keys.whole, '2002'), null, 'movie fields are not read for series');
});

test('the credit', () => {
  assert.equal(CREDIT, 'Subtitles provided by OpenSubtitles.com');
});

// ------------------------------------------------------------------ clients and the daily count

test('clients: IPv4 as it is, IPv6 as its /64, IPv4-mapped IPv6 as IPv4, anything else "unknown"', () => {
  const cases: [string | null | undefined, string][] = [
    ['203.0.113.77', '203.0.113.77'], [' 203.0.113.77 ', '203.0.113.77'], ['010.001.000.255', '10.1.0.255'], ['0.0.0.0', '0.0.0.0'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'], ['2001:DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'], ['2001:db8:1:2::', '2001:db8:1:2::/64'], ['2001:db8:1::2:3', '2001:db8:1:0::/64'],
    ['::', '0:0:0:0::/64'], ['::1', '0:0:0:0::/64'], ['fe80::1:2:3:4', 'fe80:0:0:0::/64'], ['1:2:3:4:5:6:7::', '1:2:3:4::/64'], ['::2:3:4:5:6:7:8', '0:2:3:4::/64'],
    ['::ffff:192.0.2.1', '192.0.2.1'], ['::FFFF:c000:0201', '192.0.2.1'], ['0:0:0:0:0:ffff:192.0.2.1', '192.0.2.1'], ['64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
    ['2001:db8:1:2:3:4:192.0.2.1', '2001:db8:1:2::/64'],
    [null, 'unknown'], [undefined, 'unknown'], ['', 'unknown'], ['unknown', 'unknown'], ['256.1.1.1', 'unknown'], ['1.2.3', 'unknown'], ['1.2.3.4.5', 'unknown'],
    ['1:2:3:4:5:6:7', 'unknown'], ['1:2:3:4:5:6:7:8:9', 'unknown'], ['1::2::3', 'unknown'], ['1:2:3:4:5:6:7:8::', 'unknown'], ['::1:2:3:4:5:6:7:8', 'unknown'],
    ['12345::1', 'unknown'], ['g::1', 'unknown'], [':1:2:3:4:5:6:7', 'unknown'], ['fe80::1%eth0', 'unknown'], ['::ffff:1.2.3.256', 'unknown'], ['::ffff:1.2.3', 'unknown'],
    ['1:2:3:4:5:6:7:1.2.3.4', 'unknown'], ['2001:db8::' + '1'.repeat(40), 'unknown'], ['１.2.3.4', 'unknown'], ['1.2.3.4/32', 'unknown'],
  ];
  for (const [input, expected] of cases) assert.equal(clientPrefix(input), expected, JSON.stringify(input));
  // Every address of one /64 is the same client; the next /64 is another.
  assert.equal(clientPrefix('2001:db8:aa:bb::1'), clientPrefix('2001:db8:aa:bb:ffff:ffff:ffff:ffff'));
  assert.notEqual(clientPrefix('2001:db8:aa:bb::1'), clientPrefix('2001:db8:aa:bc::1'));
  assert.equal(clientMacInput('2001:db8:aa:bb::/64'), 'extras-client-v1\n2001:db8:aa:bb::/64');
});

test('the wider network: an IPv6 /64 is in its /48; IPv4 and "unknown" are their own network', () => {
  for (const [address, expected] of [
    ['2001:db8:aa00:1:2:3:4:5', '2001:db8:aa00::/48'], ['2001:db8:aa00:ffff::1', '2001:db8:aa00::/48'], ['2001:db8::1', '2001:db8:0::/48'],
    ['2002:c633:6414:1::1', '2002:c633:6414::/48'], ['::1', '0:0:0::/48'], ['203.0.113.77', '203.0.113.77'], ['::ffff:192.0.2.1', '192.0.2.1'],
    ['garbage', 'unknown'],
  ]) assert.equal(clientNetwork(clientPrefix(address)), expected, address);
  // Every /64 of a household's /56 or a tunnel's /48 is in one network; the next /48 is another.
  assert.equal(clientNetwork(clientPrefix('2001:db8:aa00:1::1')), clientNetwork(clientPrefix('2001:db8:aa00:ff00::1')));
  assert.notEqual(clientNetwork(clientPrefix('2001:db8:aa00:1::1')), clientNetwork(clientPrefix('2001:db8:aa01:1::1')));
  // Only clientPrefix's own /64 form is widened.
  for (const text of ['2001:db8:aa00::/48', '2001:db8::/64', '1:2:3:4:5::/64', '2001:DB8:1:2::/64']) assert.equal(clientNetwork(text), text);
  assert.equal(NETWORK_DAILY_DOWNLOADS, 4 * CLIENT_DAILY_DOWNLOADS);
});

test('the daily count: UTC days, the budget variable, the per-client cap', () => {
  assert.equal(utcDay(Date.parse('2026-10-20T23:59:59.999Z')), '2026-10-20');
  assert.equal(utcDay(Date.parse('2026-10-21T00:00:00.000Z')), '2026-10-21');
  assert.equal(DAILY_DOWNLOADS, 1800, 'under the Light plan\'s 2,000');
  assert.equal(CLIENT_DAILY_DOWNLOADS, 60);
  for (const [value, expected] of [['2000', 2000], [' 25 ', 25], ['1', 1], [25, 25], ['999999999', 999999999]] as const) assert.equal(dailyDownloads(value), expected, JSON.stringify(value));
  for (const value of [undefined, null, '', '0', '-5', '+5', '1e3', '12.5', '0x10', '1000000000', 'lots', 0, -1, 2.5, Number.NaN, Infinity, true, {}]) {
    assert.equal(dailyDownloads(value), DAILY_DOWNLOADS, JSON.stringify(value));
  }
});
