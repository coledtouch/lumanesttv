// The web player's side of docs/extras.md: which ids a title sends to lumanest.tv's /api/extras endpoints, the
// lookups (cached for this page load), the checks every answer goes through, the trailer's embed address, and the
// provider's "Most watched now" live category, hidden by name. Pure apart from fetch, so tests run it directly.
import {CREDIT, EPISODE_MAX, FILE_PATH, SEASON_MAX, YOUTUBE_KEY, isHiddenLiveCategory} from '../../lib/extras.ts';
import type {IndexedTitle} from '../../lib/browse.ts';

/** Shown under the OpenSubtitles tracks in the subtitle menu and in Settings > About. */
export const SUBTITLE_CREDIT = CREDIT;
/** One OpenSubtitles track a lookup offered: `src` is the same-origin path of its WebVTT file. */
export type ExtraTrack = {id: string; label: string; hi: boolean; src: string};
export type TrailerInfo = {key: string; name: string};

/** Lookups time out after 10 seconds (docs/extras.md, Implementation notes); subtitle files after 20. */
export const LOOKUP_TIMEOUT_MS = 10_000;
export const FILE_TIMEOUT_MS = 20_000;
/** Answers kept in memory for this page load, of any status. */
export const LOOKUP_CACHE_MAX = 200;
export const MAX_TRACKS = 3;
const LABEL_MAX = 100;
const NAME_MAX = 300;
const DIGITS = /^[0-9]{1,12}$/;
const YEAR = /^[0-9]{4}$/;
const TOKEN = /^[1-9][0-9]{0,9}-[A-Za-z0-9_-]{22}$/;

// ------------------------------------------------------------------ which ids a title sends

/** What a lookup needs of a title (an IndexedTitle has all of it). */
export type ExtrasTitle = Pick<IndexedTitle, 'kind' | 'name' | 'year' | 'tmdb'> & {hint?: string};
export type EpisodeNumbers = {season: number; episode: number};

/** A TMDB id in decimal digits without leading zeros, or "" (a provider details field may carry leading zeros). */
export function tmdbId(value: string | undefined) {
  if (!value || !DIGITS.test(value)) return '';
  return value.replace(/^0+/, '');
}

/**
 * The title's TMDB id (docs/extras.md, "Which ids an app sends"): the provider's own id from its row (browse.md
 * Matching step 1), else the provider's id from the title's details, else the id of the TMDB title it matched
 * (step 2), else "".
 */
export function titleTmdb(title: ExtrasTitle, detailsTmdb = '') {
  return tmdbId(title.hint) || tmdbId(detailsTmdb) || tmdbId(title.tmdb);
}

/** tmdb, or name and year when the title has no TMDB id and its year is known; null when neither. */
function idParams(title: ExtrasTitle, detailsTmdb: string): [string, string][] | null {
  const id = titleTmdb(title, detailsTmdb);
  if (id) return [['tmdb', id]];
  const year = YEAR.test(title.year) && Number(title.year) >= 1800 && Number(title.year) <= 2099 ? title.year : '';
  if (!year || !title.name || title.name.length > NAME_MAX) return null;
  return [['name', title.name], ['year', year]];
}

const query = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();

/**
 * The /api/extras/subtitles query for a movie, or for one episode of a series (the series' ids with its season and
 * episode), with the parameters in the order docs/extras.md lists them. "" when there is nothing to ask: a playlist
 * entry that is a single episode, an episode without a number, a series without an episode, or no id and no year.
 */
export function subtitleQuery(title: ExtrasTitle, detailsTmdb = '', episode: EpisodeNumbers | null = null) {
  if (title.kind === 'movie' && !episode) {
    const ids = idParams(title, detailsTmdb);
    return ids ? query([['v', '1'], ['type', 'movie'], ...ids]) : '';
  }
  if (title.kind !== 'series' || !episode) return '';
  const {season, episode: number} = episode;
  // The ranges the endpoint accepts (seasons 0 to 100, episodes 1 to 5000); anything else would only be refused.
  if (!Number.isInteger(season) || season < 0 || season > SEASON_MAX || !Number.isInteger(number) || number < 1 || number > EPISODE_MAX) return '';
  const ids = idParams(title, detailsTmdb);
  if (!ids) return '';
  const numbers: [string, string][] = [['season', String(season)], ['episode', String(number)]];
  // type, tmdb, season, episode, name, year: tmdb before the numbers, name and year after them.
  return query([['v', '1'], ['type', 'episode'], ...(ids[0][0] === 'tmdb' ? [...ids, ...numbers] : [...numbers, ...ids])]);
}

/** The /api/extras/trailer query of a movie or series details page, or "". */
export function trailerQuery(title: ExtrasTitle, detailsTmdb = '') {
  if (title.kind !== 'movie' && title.kind !== 'series') return '';
  const ids = idParams(title, detailsTmdb);
  return ids ? query([['v', '1'], ['type', title.kind === 'movie' ? 'movie' : 'tv'], ...ids]) : '';
}

// ------------------------------------------------------------------ answers

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One line of plain text, at most `max` characters (whole characters, never half a surrogate pair). */
function plainLine(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  // Controls and line breaks become spaces; React and the <track> label show the rest as text.
  let text = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    text += code < 32 || (code >= 127 && code < 160) || code === 0x2028 || code === 0x2029 ? ' ' : char;
  }
  const words = text.split(' ').filter(Boolean).join(' ');
  return Array.from(words).slice(0, max).join('');
}

/**
 * The tracks of a /api/extras/subtitles answer that this page can use: at most three, English, each with a WebVTT
 * file on this page's own origin (docs/extras.md: apps accept only URLs on the origin they called) at a path the file
 * endpoint answers. A track the browser loads is then same-origin, so the video needs no crossorigin attribute.
 */
export function readSubtitleAnswer(data: unknown, origin: string): ExtraTrack[] {
  if (!isRecord(data) || !Array.isArray(data.tracks)) return [];
  const tracks: ExtraTrack[] = [];
  for (const raw of data.tracks.slice(0, 10)) {
    if (tracks.length >= MAX_TRACKS) break;
    if (!isRecord(raw) || raw.lang !== 'en' || typeof raw.id !== 'string' || !TOKEN.test(raw.id) || typeof raw.vtt !== 'string') continue;
    let url: URL;
    try {url = new URL(raw.vtt);} catch {continue;}
    const path = FILE_PATH.exec(url.pathname);
    if (url.origin !== origin || !path || path[3] !== 'vtt' || url.search || url.hash || path[1] + '-' + path[2] !== raw.id) continue;
    if (tracks.some(track => track.src === url.pathname)) continue;
    const hi = raw.hi === true;
    tracks.push({id: raw.id, label: plainLine(raw.label, LABEL_MAX) || (hi ? 'English SDH' : 'English') + ' (OpenSubtitles)', hi, src: url.pathname});
  }
  return tracks;
}

/** The trailer of a /api/extras/trailer answer, or null: its key is checked before any address is built from it. */
export function readTrailerAnswer(data: unknown): TrailerInfo | null {
  if (!isRecord(data) || !isRecord(data.trailer)) return null;
  const key = data.trailer.key;
  if (typeof key !== 'string' || !YOUTUBE_KEY.test(key)) return null;
  return {key, name: plainLine(data.trailer.name, LABEL_MAX) || 'Trailer'};
}

/** YouTube's privacy-enhanced embed of a trailer; "" for a key that is not a YouTube key. */
export function trailerEmbedSrc(key: string) {
  return YOUTUBE_KEY.test(key) ? 'https://www.youtube-nocookie.com/embed/' + key + '?autoplay=1&rel=0&playsinline=1' : '';
}

/**
 * The trailer dialog's iframe: YouTube's privacy-enhanced player, sandboxed so the embed can't navigate this page
 * (no allow-top-navigation) or submit forms, yet still plays, goes full screen and opens YouTube in a new tab.
 * Null for a key that is not a YouTube key.
 */
export function trailerFrame(key: string) {
  const src = trailerEmbedSrc(key);
  return src ? {
    src, title: 'Trailer', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullScreen: true,
    referrerPolicy: 'strict-origin-when-cross-origin' as const,
    sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
  } : null;
}

/** The trailer's YouTube watch page, for a plain link; "" for a key that is not a YouTube key. */
export function trailerWatchURL(key: string) {
  return YOUTUBE_KEY.test(key) ? 'https://www.youtube.com/watch?v=' + key : '';
}

// ------------------------------------------------------------------ lookups

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export type ExtrasClient = {
  subtitles: (query: string) => Promise<ExtraTrack[]>;
  trailer: (query: string) => Promise<TrailerInfo | null>;
};

/**
 * Looks things up at /api/extras on `origin`. A 200 answer is kept for this page load (at most LOOKUP_CACHE_MAX, the
 * oldest dropped first), whatever its status; a failure (any other HTTP status, a timeout, a network error, JSON that
 * can't be read) is "nothing", silently, and is not kept, so the next time the title opens asks again. Lookups of one
 * query that overlap share one request.
 */
export function createExtrasClient(fetcher: Fetcher, origin: string, timeoutMs = LOOKUP_TIMEOUT_MS): ExtrasClient {
  const answers = new Map<string, unknown>();
  const pending = new Map<string, Promise<unknown>>();

  async function request(path: string): Promise<{ok: true; data: unknown} | {ok: false}> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(path, {credentials: 'omit', headers: {Accept: 'application/json'}, signal: controller.signal});
      if (response.status !== 200) {void response.body?.cancel().catch(() => {}); return {ok: false};}
      return {ok: true, data: await response.json()};
    } catch {
      return {ok: false};
    } finally {clearTimeout(timer);}
  }

  function lookup<T>(path: string, read: (data: unknown) => T, none: T): Promise<T> {
    if (answers.has(path)) return Promise.resolve(answers.get(path) as T);
    const running = pending.get(path);
    if (running) return running as Promise<T>;
    const started = request(path).then(result => {
      pending.delete(path);
      if (!result.ok) return none;
      const value = read(result.data);
      answers.set(path, value);
      while (answers.size > LOOKUP_CACHE_MAX) answers.delete(answers.keys().next().value!);
      return value;
    });
    pending.set(path, started);
    return started;
  }

  const NO_TRACKS: ExtraTrack[] = [];
  return {
    subtitles: query => query ? lookup('/api/extras/subtitles?' + query, data => readSubtitleAnswer(data, origin), NO_TRACKS) : Promise.resolve(NO_TRACKS),
    trailer: query => query ? lookup('/api/extras/trailer?' + query, readTrailerAnswer, null) : Promise.resolve(null),
  };
}

let pageClient: ExtrasClient | null = null;
/** This page's client (browser only). */
export function extrasClient() {
  return pageClient ??= createExtrasClient((input, init) => fetch(input, init), window.location.origin);
}

// ------------------------------------------------------------------ the hidden live category

/**
 * The live channels of the lineup: the playlist's live entries less those in the provider's "Most watched now"
 * category (docs/extras.md, "Hidden live category"). Each playlist entry has one group, so a channel in that category
 * has no other one left and is dropped; movie and series entries are never touched.
 */
export function liveLineup<T extends {kind?: string; group: string}>(channels: T[]): T[] {
  return channels.filter(channel => (!channel.kind || channel.kind === 'live') && !isHiddenLiveCategory(channel.group));
}
