// Subtitles, trailers and the hidden live category (docs/extras.md): the pure rules. The endpoints in
// lib/extras-service.ts use them, the web player can use isHiddenLiveCategory, and tests/extras.test.ts runs every
// server case of docs/extras-cases.json against them (all kinds but vtt_cues, which only the apps that draw cues run).
// Patterns here run in JavaScript on the server only.
import {normalizeTitle} from './browse.ts';

export const EXTRAS_VERSION = 1;
export const CREDIT = 'Subtitles provided by OpenSubtitles.com';
/** A YouTube video key, checked again by every app before it builds a link. */
export const YOUTUBE_KEY = /^[A-Za-z0-9_-]{11}$/;
/** OpenSubtitles file ids the file endpoint accepts. */
export const FILE_ID_MAX = 2147483647;
/** At most this many cues of a file are kept, the first ones in file order. */
export const MAX_CUES = 20000;
/** The tracks a lookup offers at most. */
export const MAX_TRACKS = 3;
/** /api/extras/subtitles/file/<file_id>-<mac>.<vtt|srt>; anything else is 404. */
export const FILE_PATH = /^\/api\/extras\/subtitles\/file\/([1-9][0-9]{0,9})-([A-Za-z0-9_-]{22})\.(vtt|srt)$/;
/** What the file token's MAC covers (keyed with PLAYER_COOKIE_KEY, purpose 'extras-subtitle'). */
export const fileMacInput = (fileId: number) => 'extras-subtitle-v1\n' + fileId;

// ------------------------------------------------------------------ hidden live category

const CATEGORY_TAGS = new Set(['us', 'usa', 'en']);

/**
 * The provider's "Most watched now" live category, matched by name: ASCII letters lower-cased, ASCII letters and
 * digits kept, every other character a separator; one leading and then one trailing `us`, `usa` or `en` dropped;
 * hidden when the words left are exactly "most watched now" or "most watched". For live categories only.
 */
export function isHiddenLiveCategory(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const words: string[] = [];
  let word = '';
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c >= 65 && c <= 90) word += String.fromCharCode(c + 32);
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) word += name[i];
    else if (word) {
      words.push(word);
      word = '';
      // Longer names can't be one of the two.
      if (words.length > 5) return false;
    }
  }
  if (word) words.push(word);
  if (words.length && CATEGORY_TAGS.has(words[0])) words.shift();
  if (words.length && CATEGORY_TAGS.has(words[words.length - 1])) words.pop();
  const rest = words.join(' ');
  return rest === 'most watched now' || rest === 'most watched';
}

// ------------------------------------------------------------------ SRT to WebVTT

export type Cue = {start: number; end: number; lines: string[]};

const LINE_BREAK = /\r\n|\r|\n/;
const TIMING = /^[ \t]*((?:[0-9]{1,3}:)?[0-9]{1,2}:[0-9]{1,2}[,.][0-9]{1,3})[ \t]*-->[ \t]*((?:[0-9]{1,3}:)?[0-9]{1,2}:[0-9]{1,2}[,.][0-9]{1,3})(?:[ \t][\s\S]*)?$/;
const STAMP = /^(?:([0-9]{1,3}):)?([0-9]{1,2}):([0-9]{1,2})[,.]([0-9]{1,3})$/;
const BLANK = /^[ \t]*$/;
const INDEX_LINE = /^[ \t]*[0-9]+[ \t]*$/;
const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]{2,8});/g;
const NAMED_ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const BR = /<[Bb][Rr][ \t]*\/?>/g;
// A block or a tag may span lines (a line break inside a tag is still a tag to a renderer that reads markup).
const SSA_BLOCK = /\{[^{}]*\}/g;
const TAG = /<\/?[A-Za-z][^<>]*>/g;
/** SSA_BLOCK or TAG, for a test (not global, so it keeps no lastIndex). */
const MARKUP = /\{[^{}]*\}|<\/?[A-Za-z][^<>]*>/;
/** Tab and the Unicode spaces of browse.md become spaces. */
const TEXT_SPACES = /[\t\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;
/** Controls, zero width space, direction marks, embeddings, overrides and isolates are removed. */
const TEXT_REMOVED = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFFFE\uFFFF]/g;

/** A stamp in milliseconds, or null when its minutes or seconds are over 59. */
function stampMs(text: string): number | null {
  const m = STAMP.exec(text);
  if (!m) return null;
  const minutes = Number(m[2]), seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  // 1 to 3 digits of a decimal fraction: "5" and "50" are 500 ms, "005" is 5 ms.
  const ms = Number((m[4] + '00').slice(0, 3));
  return ((Number(m[1] || 0) * 60 + minutes) * 60 + seconds) * 1000 + ms;
}

function decodeEntities(text: string) {
  return text.replace(ENTITY, (whole: string, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** Markup removal passes; markup nested deeper than this loses every "<" and "{" instead (linear time on any file). */
export const MARKUP_PASSES = 10;
/** Two or more hyphens and ">": written "->", so no text line can be read as a timing line. */
const ARROW = /-{2,}>/g;

/**
 * Step 3 of SRT to WebVTT: a cue's text lines (joined with LF) as plain text lines. Entities are decoded first, so
 * encoded markup is removed with the rest; then spaces, CR (from &#13;, a line break like the files' own) and removed
 * characters, so none of them can split a tag that would come back together later. Blocks and tags are removed again
 * until nothing changes ("<<b>i>" leaves "<i>" after one pass), across line breaks too ("<b\n>", "{\an8\N}"), so the
 * result holds no tag and no {...} block, even one split over lines, and "-->" is shortened to "->", so it holds no
 * timing line either.
 */
export function cueText(input: string): string[] {
  let text = input.split('\\N').join('\n').split('\\n').join('\n').split('\\h').join(' ');
  if (text.includes('&')) text = decodeEntities(text);
  text = text.replace(TEXT_SPACES, ' ').replace(/\r/g, '\n').replace(TEXT_REMOVED, '');
  if (text.includes('<')) text = text.replace(BR, '\n');
  if (text.includes('{') || text.includes('<')) {
    for (let pass = 0; pass < MARKUP_PASSES; pass++) {
      const before = text;
      text = text.replace(SSA_BLOCK, '').replace(TAG, '');
      if (text === before) break;
    }
    // Still markup after every pass: nested deeper than any real file.
    if (MARKUP.test(text)) text = text.replace(/[<{]/g, '');
  }
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const clean = line.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '').replace(ARROW, '->');
    if (clean) lines.push(clean);
  }
  return lines;
}

/** A downloaded SRT file as cues sorted by start (equal starts in file order), at most MAX_CUES. */
export function parseSrt(input: string): Cue[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  type Raw = {start: number | null; end: number | null; raw: string[]};
  const cues: Cue[] = [];
  let current: Raw | null = null, afterBlank = false, done = false;
  const finish = (cue: Raw) => {
    if (done || cue.start === null || cue.end === null || cue.end <= cue.start) return;
    const lines = cueText(cue.raw.join('\n'));
    if (!lines.length) return;
    cues.push({start: cue.start, end: cue.end, lines});
    if (cues.length >= MAX_CUES) done = true;
  };
  for (const line of text.split(LINE_BREAK)) {
    if (done) break;
    const timing = TIMING.exec(line);
    if (timing) {
      if (current) {
        // Without a blank line before it, a number right before a timing line is the next cue's number.
        if (!afterBlank && current.raw.length && INDEX_LINE.test(current.raw[current.raw.length - 1])) current.raw.pop();
        finish(current);
      }
      current = {start: stampMs(timing[1]), end: stampMs(timing[2]), raw: []};
      afterBlank = false;
    } else if (BLANK.test(line)) {
      if (current) afterBlank = true;
    } else if (current && !afterBlank) current.raw.push(line);
  }
  if (current) finish(current);
  // Array.prototype.sort is stable: equal starts keep file order.
  return cues.sort((a, b) => a.start - b.start);
}

function stamp(ms: number, separator: string) {
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2) + separator + pad(ms % 1000, 3);
}
const escapeVtt = (line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** WebVTT: no cue ids, settings, styles or notes; &, < and > escaped. */
export function toVtt(cues: Cue[]) {
  let out = 'WEBVTT\n';
  for (const cue of cues) {
    out += '\n' + stamp(cue.start, '.') + ' --> ' + stamp(cue.end, '.') + '\n';
    for (const line of cue.lines) out += escapeVtt(line) + '\n';
  }
  return out;
}

/**
 * SRT: numbered from 1, text as it is. cueText left no tag and no {...} block (not even one split over lines), no "-->"
 * and no empty line in it, so no text line can be read as markup or as a new cue (the .vtt escapes &, < and > as well).
 */
export function toSrt(cues: Cue[]) {
  return cues.map((cue, i) => (i + 1) + '\n' + stamp(cue.start, ',') + ' --> ' + stamp(cue.end, ',') + '\n' + cue.lines.map(line => line + '\n').join('')).join('\n');
}

// ------------------------------------------------------------------ choosing subtitle files

export type SubtitleRequest = {type: 'movie'; tmdb: number} | {type: 'episode'; tmdb: number; season: number; episode: number};
export type PickedFile = {file_id: number; hi: boolean; label: string};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const asciiLower = (text: string) => text.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));

export function trackLabel(index: number, hi: boolean) {
  return 'English' + (hi ? ' SDH' : '') + ' (OpenSubtitles' + (index > 0 ? ' ' + (index + 1) : '') + ')';
}

/** The best files of an OpenSubtitles search's `data` for the request, best first, at most MAX_TRACKS. */
export function pickSubtitles(request: SubtitleRequest, data: unknown): PickedFile[] {
  type Candidate = {fileId: number; ai: boolean; hi: boolean; downloads: number; trusted: boolean; uploaded: string};
  const candidates: Candidate[] = [], seen = new Set<number>();
  for (const item of Array.isArray(data) ? data : []) {
    const a = isObject(item) ? item.attributes : null;
    if (!isObject(a)) continue;
    if (typeof a.language !== 'string' || asciiLower(a.language) !== 'en') continue;
    // Machine translated and forced-only (foreign parts) files are not full subtitles.
    if (a.machine_translated === true || a.foreign_parts_only === true) continue;
    // Exactly one file: multi-CD subtitles are left out.
    const files = a.files;
    if (!Array.isArray(files) || files.length !== 1 || !isObject(files[0])) continue;
    const fileId = files[0].file_id;
    if (!isInteger(fileId) || fileId < 1 || fileId > FILE_ID_MAX) continue;
    const feature = isObject(a.feature_details) ? a.feature_details : {};
    const type = feature.feature_type;
    if (request.type === 'movie') {
      if (typeof type === 'string' && asciiLower(type) !== 'movie') continue;
      if (isInteger(feature.tmdb_id) && feature.tmdb_id !== request.tmdb) continue;
    } else {
      if (typeof type === 'string' && asciiLower(type) !== 'episode') continue;
      if (!isInteger(feature.season_number) || feature.season_number !== request.season) continue;
      if (!isInteger(feature.episode_number) || feature.episode_number !== request.episode) continue;
      if (isInteger(feature.parent_tmdb_id) && feature.parent_tmdb_id !== request.tmdb) continue;
    }
    if (seen.has(fileId)) continue;
    seen.add(fileId);
    candidates.push({
      fileId, ai: a.ai_translated === true, hi: a.hearing_impaired === true,
      downloads: typeof a.download_count === 'number' && Number.isFinite(a.download_count) ? a.download_count : 0,
      trusted: a.from_trusted === true, uploaded: typeof a.upload_date === 'string' ? a.upload_date : '',
    });
  }
  candidates.sort((x, y) => {
    if (x.ai !== y.ai) return x.ai ? 1 : -1;
    if (x.hi !== y.hi) return x.hi ? 1 : -1;
    if (x.downloads !== y.downloads) return x.downloads > y.downloads ? -1 : 1;
    if (x.trusted !== y.trusted) return x.trusted ? -1 : 1;
    if (x.uploaded !== y.uploaded) return x.uploaded > y.uploaded ? -1 : 1;
    return x.fileId - y.fileId;
  });
  return candidates.slice(0, MAX_TRACKS).map((c, i) => ({file_id: c.fileId, hi: c.hi, label: trackLabel(i, c.hi)}));
}

// ------------------------------------------------------------------ choosing the trailer

export type Trailer = {key: string; name: string};
const PUBLISHED = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/;
export const TRAILER_NAME_MAX = 100;

/** TMDB's video name as one line of plain text, at most TRAILER_NAME_MAX UTF-16 code units ("Trailer" when empty). */
export function trailerName(value: unknown) {
  let name = typeof value === 'string' ? value.replace(TEXT_SPACES, ' ').replace(/[\r\n]/g, ' ').replace(TEXT_REMOVED, '').replace(/ {2,}/g, ' ').trim() : '';
  if (name.length > TRAILER_NAME_MAX) {
    name = name.slice(0, TRAILER_NAME_MAX);
    // Never end on half of a surrogate pair.
    if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
    name = name.trim();
  }
  return name || 'Trailer';
}

/**
 * The trailer from TMDB's /videos `results`: YouTube only, an 11-character key, type Trailer or Teaser only; English
 * first, then official, then Trailer before Teaser, then the earliest well-formed published_at, then the smaller key.
 */
export function pickTrailer(results: unknown): Trailer | null {
  type Candidate = {lang: number; official: number; type: number; dated: number; published: string; key: string; name: unknown};
  let best: Candidate | null = null;
  const before = (x: Candidate, y: Candidate) => {
    for (const field of ['lang', 'official', 'type', 'dated'] as const) if (x[field] !== y[field]) return x[field] < y[field];
    if (x.published !== y.published) return x.published < y.published;
    return x.key < y.key;
  };
  for (const video of Array.isArray(results) ? results : []) {
    if (!isObject(video) || video.site !== 'YouTube') continue;
    const key = video.key, type = video.type;
    if (typeof key !== 'string' || !YOUTUBE_KEY.test(key) || (type !== 'Trailer' && type !== 'Teaser')) continue;
    const published = typeof video.published_at === 'string' && PUBLISHED.test(video.published_at) ? video.published_at : '';
    const candidate: Candidate = {
      lang: video.iso_639_1 === 'en' ? 0 : 1, official: video.official === true ? 0 : 1, type: type === 'Trailer' ? 0 : 1,
      dated: published ? 0 : 1, published, key, name: video.name,
    };
    if (!best || before(candidate, best)) best = candidate;
  }
  return best ? {key: best.key, name: trailerName(best.name)} : null;
}

export const youtubeWatchURL = (key: string) => 'https://www.youtube.com/watch?v=' + key;
export const youtubeShortText = (key: string) => 'youtu.be/' + key;
export const youtubeShortURL = (key: string) => 'https://youtu.be/' + key;

// ------------------------------------------------------------------ requests

export type Media = 'movie' | 'tv';
/** A lookup: by TMDB id, or by name and year (the name fallback). Episodes look up the series (media 'tv'). */
export type LookupQuery = {
  media: Media; episode: {season: number; episode: number} | null;
  tmdb: number | null; name: string; year: string;
};
export type QueryError = {error: 'bad_request' | 'unsupported_version'};

const TMDB_PARAM = /^[1-9][0-9]{0,11}$/;
const SMALL_NUMBER = /^[0-9]{1,4}$/;
const YEAR_PARAM = /^[0-9]{4}$/;
export const NAME_MAX = 300;
/** The seasons and episodes a lookup accepts: every made-up number would cost an upstream search. */
export const SEASON_MAX = 100;
export const EPISODE_MAX = 5000;

/** `v` is optional and means 1; any other value is unsupported. */
export function versionError(params: URLSearchParams): QueryError | null {
  const version = params.get('v');
  return version !== null && version !== '1' ? {error: 'unsupported_version'} : null;
}

function idOrName(params: URLSearchParams): Pick<LookupQuery, 'tmdb' | 'name' | 'year'> | null {
  const tmdb = params.get('tmdb');
  if (tmdb !== null) return TMDB_PARAM.test(tmdb) ? {tmdb: Number(tmdb), name: '', year: ''} : null;
  const name = params.get('name'), year = params.get('year');
  if (name === null || name.length < 1 || name.length > NAME_MAX) return null;
  if (year === null || !YEAR_PARAM.test(year) || Number(year) < 1800 || Number(year) > 2099) return null;
  return {tmdb: null, name, year};
}

/** /api/extras/subtitles parameters (docs/extras.md); unknown parameters are ignored. */
export function parseSubtitleQuery(params: URLSearchParams): LookupQuery | QueryError {
  const version = versionError(params);
  if (version) return version;
  const type = params.get('type'), lang = params.get('lang');
  if ((type !== 'movie' && type !== 'episode') || (lang !== null && lang !== 'en')) return {error: 'bad_request'};
  let episode: LookupQuery['episode'] = null;
  if (type === 'episode') {
    const s = params.get('season'), e = params.get('episode');
    if (s === null || e === null || !SMALL_NUMBER.test(s) || !SMALL_NUMBER.test(e)) return {error: 'bad_request'};
    if (Number(s) > SEASON_MAX || Number(e) < 1 || Number(e) > EPISODE_MAX) return {error: 'bad_request'};
    episode = {season: Number(s), episode: Number(e)};
  }
  const ids = idOrName(params);
  return ids ? {media: type === 'movie' ? 'movie' : 'tv', episode, ...ids} : {error: 'bad_request'};
}

/** /api/extras/trailer parameters: `type` is movie or tv. */
export function parseTrailerQuery(params: URLSearchParams): LookupQuery | QueryError {
  const version = versionError(params);
  if (version) return version;
  const type = params.get('type');
  if (type !== 'movie' && type !== 'tv') return {error: 'bad_request'};
  const ids = idOrName(params);
  return ids ? {media: type, episode: null, ...ids} : {error: 'bad_request'};
}

// ------------------------------------------------------------------ clients

const IPV4 = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const ipv4Bytes = (text: string) => {
  const m = IPV4.exec(text);
  const bytes = m ? m.slice(1).map(Number) : null;
  return bytes && bytes.every(b => b <= 255) ? bytes : null;
};

/**
 * The client's network, which the limits and the daily download count are kept per (CF-Connecting-IP): an IPv4
 * address as it is (/32), an IPv6 address as its /64 written "2001:db8:0:1::/64" (one household or phone gets a whole
 * /64, so its addresses count as one), and an IPv4-mapped IPv6 address (::ffff:192.0.2.1) as its IPv4 address.
 * Anything else, or no address, is "unknown" (one shared client).
 */
export function clientPrefix(address: string | null | undefined): string {
  const text = typeof address === 'string' ? address.trim().toLowerCase() : '';
  const v4 = ipv4Bytes(text);
  if (v4) return v4.join('.');
  if (!text.includes(':') || text.length > 45) return 'unknown';
  // A dotted IPv4 tail (::ffff:192.0.2.1) is the last two groups.
  let groupsText = text;
  const lastColon = text.lastIndexOf(':'), tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const bytes = ipv4Bytes(tail);
    if (!bytes) return 'unknown';
    groupsText = text.slice(0, lastColon + 1) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = groupsText.split('::');
  if (halves.length > 2) return 'unknown';
  const split = (part: string) => part === '' ? [] : part.split(':');
  const left = split(halves[0]), right = halves.length === 2 ? split(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  // "::" stands for at least one group of zeros; without it there must be eight groups.
  if (halves.length === 2 ? missing < 1 : missing !== 0) return 'unknown';
  const groups = [...left, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (!groups.every(group => HEX_GROUP.test(group))) return 'unknown';
  const words = groups.map(group => parseInt(group, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  return words.slice(0, 4).map(word => word.toString(16)).join(':') + '::/64';
}

/** What the client's keyed hash covers (keyed with PLAYER_COOKIE_KEY, purpose 'extras-client'); never stored as it is. */
export const clientMacInput = (prefix: string) => 'extras-client-v1\n' + prefix;

/** The UTC day of a time, "YYYY-MM-DD": the daily download count's day. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** OpenSubtitles downloads a day for every client together, unless OPENSUBTITLES_DAILY_DOWNLOADS says otherwise. */
export const DAILY_DOWNLOADS = 1800;
/** OpenSubtitles downloads a day for one client (clientPrefix). */
export const CLIENT_DAILY_DOWNLOADS = 60;
/** OpenSubtitles downloads a day for all the IPv6 clients of one /48 together (clientNetwork). */
export const NETWORK_DAILY_DOWNLOADS = 240;

const IPV6_64 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/;
/**
 * The wider network a client's /64 lies in, which the daily download count also caps: its /48, written
 * "2001:db8:0::/48". A household's /56, a free tunnel's /48 and a 6to4 address (one IPv4 address as a /48) each hold
 * many /64s, so without this one person could spread requests over hundreds of clients. An IPv4 address and "unknown"
 * are their own network.
 */
export function clientNetwork(prefix: string): string {
  const m = IPV6_64.exec(prefix);
  return m ? m[1] + ':' + m[2] + ':' + m[3] + '::/48' : prefix;
}

/** OPENSUBTITLES_DAILY_DOWNLOADS: a positive whole number (text or a number); anything else means DAILY_DOWNLOADS. */
export function dailyDownloads(value: unknown): number {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : DAILY_DOWNLOADS;
  return typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value.trim()) ? Number(value.trim()) : DAILY_DOWNLOADS;
}

/** The OpenSubtitles search path and query: parameters in alphabetical order, lower case, defaults left out. */
export function subtitleSearchPath(tmdb: number, episode: LookupQuery['episode']) {
  return episode
    ? `/subtitles?episode_number=${episode.episode}&languages=en&order_by=download_count&order_direction=desc&parent_tmdb_id=${tmdb}&season_number=${episode.season}&type=episode`
    : `/subtitles?languages=en&order_by=download_count&order_direction=desc&tmdb_id=${tmdb}&type=movie`;
}

// ------------------------------------------------------------------ the name and year fallback

/** The two keys a name is resolved under (browse.md Normalize): with and without the leading and trailing tags. */
export function resolveKeys(name: string) {
  return {key: normalizeTitle(name), whole: normalizeTitle(name, true)};
}

/** TMDB search path and query for the name fallback (the key is the query). */
export function tmdbSearch(media: Media, key: string, year: string): [string, Record<string, string>] {
  return media === 'movie'
    ? ['/search/movie', {query: key, year, include_adult: 'false', language: 'en-US', page: '1'}]
    : ['/search/tv', {query: key, first_air_date_year: year, include_adult: 'false', language: 'en-US', page: '1'}];
}

/**
 * The TMDB id a search's results give: a result matches when its normalized title or original title (series: name,
 * original_name) equals `key` or `whole` and its date starts with the year. Exactly one distinct id is the answer;
 * none or several is null.
 */
export function matchResolved(media: Media, results: unknown, key: string, whole: string, year: string): number | null {
  if (!key) return null;
  const ids = new Set<number>();
  for (const result of Array.isArray(results) ? results : []) {
    if (!isObject(result)) continue;
    const id = result.id;
    if (!isInteger(id) || id < 1 || id > 999999999999) continue;
    const date = media === 'movie' ? result.release_date : result.first_air_date;
    if (typeof date !== 'string' || date.slice(0, 4) !== year) continue;
    const titles = media === 'movie' ? [result.title, result.original_title] : [result.name, result.original_name];
    if (titles.some(title => {
      if (typeof title !== 'string') return false;
      const normal = normalizeTitle(title);
      return normal === key || normal === whole;
    })) ids.add(id);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

// ------------------------------------------------------------------ R2 object names (under extras/v1/)

export const OBJECT_PREFIX = 'extras/v1/';
export function subtitlesObject(tmdb: number, episode: LookupQuery['episode']) {
  return OBJECT_PREFIX + (episode ? `subtitles/tv/${tmdb}/s${episode.season}/e${episode.episode}/en.json` : `subtitles/movie/${tmdb}/en.json`);
}
export const trailerObject = (media: Media, tmdb: number) => OBJECT_PREFIX + `trailers/${media}/${tmdb}.json`;
export const resolveObject = (media: Media, hash: string) => OBJECT_PREFIX + `resolve/${media}/${hash}.json`;
export const STATE_OBJECT = OBJECT_PREFIX + 'state/opensubtitles.json';
/** What the resolve object's name hashes (hex SHA-256). */
export const resolveHashInput = (key: string, whole: string, year: string) => key + '\n' + whole + '\n' + year;

// ------------------------------------------------------------------ the edge cache (each location's Workers Cache API)

/** Part of every edge cache key: raise it when an answer's shape, or a rule that decides an answer, changes. */
export const EDGE_CACHE_VERSION = 1;
export type EdgeKind = 'trailer' | 'subtitles';

/**
 * The path, on the site's own origin, that a lookup's answer is kept under in a location's Cache API. It is made from
 * the parsed query, never the request's URL, so equivalent requests (parameters in any order, `v` left out, leading
 * zeros in season and episode, unknown parameters, names that normalize alike) share one entry and unknown parameters
 * can't make a new one. A lookup by name is kept under `nameHash`, the hash its R2 resolve object is named by
 * (resolveHashInput). Subtitle answers carry file links signed with PLAYER_COOKIE_KEY, so their path also holds `keyId`,
 * an id of that key: answers made with an earlier key are never served.
 */
export function edgeCachePath(kind: EdgeKind, query: LookupQuery, nameHash: string, keyId: string): string {
  const title = query.media + '/' + (query.tmdb !== null ? String(query.tmdb) : 'name/' + nameHash);
  const base = '/__lumanest-cache/extras-v' + EDGE_CACHE_VERSION + '/';
  if (kind === 'trailer') return base + 'trailer/' + title;
  const episode = query.episode ? '/s' + query.episode.season + '/e' + query.episode.episode : '';
  return base + 'subtitles/' + keyId + '/' + title + episode + '/en';
}

/**
 * The Cache-Tag of an answer kept at the edge, for purging by tag: `extras` (every answer), `extras-<kind>`, and
 * `extras-<kind>-<movie|tv>-<tmdb>` when the answer names a TMDB id (a series' episodes share the series' tag).
 */
export function edgeCacheTags(kind: EdgeKind, media: Media, tmdb: number | null): string {
  return ['extras', 'extras-' + kind, ...(tmdb !== null ? ['extras-' + kind + '-' + media + '-' + tmdb] : [])].join(',');
}
