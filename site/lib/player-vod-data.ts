// Pure helpers behind the web player's Movies & Series (lib/player-vod.ts): reading the provider's Xtream lists
// without holding them in memory, building only allowlisted Xtream requests, and turning poster addresses into
// links that never reveal a provider host. No Workers APIs here, so tests run them directly.
import {sealStable, type TokenPurpose} from './player-crypto.ts';
import {asText} from './browse.ts';
import type {PlayerSession} from './player-data.ts';

export const VOD_LIMITS = {
  /** A movie or series list is read as a stream and given up after this many bytes. */
  listBytes: 48 * 1024 * 1024,
  /** Titles kept per type; a longer list is cut here and marked truncated. */
  items: 50000,
  /**
   * The compact catalogue (movies and series, as JSON) is cut at this size and marked truncated, so building,
   * caching and sending it stays well inside a Worker's 128 MB. Movies may use up to moviesBytes of it.
   */
  catalogueBytes: 12 * 1024 * 1024,
  moviesBytes: 9 * 1024 * 1024,
  /** Sealed poster directories (or whole poster addresses) per list; posters beyond them get title cards. */
  posterBases: 500,
  /** One list element; a larger one is skipped. */
  element: 64 * 1024,
  /** A provider answer that is an object rather than an array is read whole, up to this size. */
  objectBytes: 2 * 1024 * 1024,
  categoryBytes: 2 * 1024 * 1024,
  categories: 3000,
  seriesInfoBytes: 4 * 1024 * 1024,
  movieInfoBytes: 1024 * 1024,
  seasons: 100,
  episodes: 3000,
  plot: 2000,
  episodeTitle: 200,
  posterURL: 1024,
} as const;

/** A fixed failure; the message is shown to the viewer, the code goes to logs. Never carries a URL. */
export class VodError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const vodUnavailable = () => new VodError(502, 'vod_unavailable', 'Movies and series could not be loaded from your line right now. Please try again.');
export const vodTooLarge = () => new VodError(502, 'vod_too_large', 'This line’s movie and series list is too large for the web player. Use the Tuner app on your TV.');
export const vodTimeout = () => new VodError(504, 'vod_timeout', 'Movies and series took too long to load. Please try again.');
export const vodLoginRejected = () => new VodError(401, 'invalid_line_login', 'The line login was not accepted for movies and series. Check your subscription status.');

// ------------------------------------------------------------------ the Xtream server and its requests

/**
 * TV_APP_XTREAM_SERVER as an origin ("https://tv.lumanest.tv"), the way lib/player.ts tvAccount reads it: a bare host
 * means HTTPS and trailing slashes are dropped. Anything with a path, query, login or port other than 443 is refused.
 * The caller still checks the host against the provider allowlists.
 */
export function xtreamServer(raw: string | undefined): {server: string} | {error: 'not_configured' | 'server_not_approved'} {
  let value = (raw || '').trim().replace(/\/+$/, '');
  if (!value) return {error: 'not_configured'};
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
  if (!/^https?:\/\/[^\s/?#@\\]+$/i.test(value)) return {error: 'server_not_approved'};
  let url: URL;
  try {url = new URL(value);} catch {return {error: 'server_not_approved'};}
  if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return {error: 'server_not_approved'};
  return {server: url.origin};
}

export const XTREAM_ACTIONS = ['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series', 'get_series_info', 'get_vod_info'] as const;
export type XtreamAction = (typeof XTREAM_ACTIONS)[number];
export const XTREAM_ID = /^\d{1,10}$/;
const ACTION_PARAMS: Partial<Record<XtreamAction, string>> = {get_series_info: 'series_id', get_vod_info: 'vod_id'};

/** One player_api.php request. Only the fixed actions, and an id of digits for the two that take one. */
export function xtreamURL(server: string, credentials: Pick<PlayerSession, 'username' | 'password'>, action: XtreamAction, id?: string) {
  if (!XTREAM_ACTIONS.includes(action)) throw new VodError(400, 'invalid_title', 'Choose a movie or series from your line.');
  const param = ACTION_PARAMS[action];
  if (param ? !id || !XTREAM_ID.test(id) : id !== undefined) throw new VodError(400, 'invalid_title', 'Choose a movie or series from your line.');
  const url = new URL('/player_api.php', server);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  url.searchParams.set('action', action);
  if (param && id) url.searchParams.set(param, id);
  return url.href;
}

/** Containers a movie or episode link may name. */
export const VOD_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ts', 'm3u8', 'flv', 'wmv', 'mpg', 'mpeg', '3gp']);

/** A movie's or episode's stream address, as every Tuner app builds it: /movie|series/<user>/<pass>/<id>.<ext>. */
export function vodPlayURL(server: string, credentials: Pick<PlayerSession, 'username' | 'password'>, type: 'movie' | 'episode', id: string, ext: string) {
  if (!XTREAM_ID.test(id) || !VOD_EXTENSIONS.has(ext)) throw new VodError(400, 'invalid_title', 'Choose a movie or episode from your line.');
  return new URL(`/${type === 'movie' ? 'movie' : 'series'}/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${id}.${ext}`, server).href;
}

/** What an M3U entry is, from its address: Xtream /movie/ and /series/ paths, or a movie file. */
export function entryKind(value: string): 'live' | 'movie' | 'series' {
  let path: string;
  try {path = new URL(value).pathname.toLowerCase();} catch {return 'live';}
  if (path.includes('/movie/')) return 'movie';
  if (path.includes('/series/')) return 'series';
  if (path.includes('/live/')) return 'live';
  return /\.(?:mp4|m4v|mov|mkv|avi|webm)$/.test(path) ? 'movie' : 'live';
}

/** The lower-case file extension of an address's path ("mkv"), or "". */
export function entryExt(value: string) {
  try {return /\.([a-z0-9]{2,5})$/.exec(new URL(value).pathname.toLowerCase())?.[1] || '';} catch {return '';}
}

// ------------------------------------------------------------------ reading big JSON lists as a stream

export type JsonListLimits = {maxBytes: number; maxItems: number; maxElement?: number; maxObjectBytes?: number; signal?: AbortSignal};
export type JsonListResult = {items: number; skipped: number; truncated: boolean; bytes: number};

/**
 * Reads a JSON array from a body stream and hands each element to onItem, one at a time, so a 30 MB get_vod_streams
 * answer is never held whole. Elements over maxElement or that are not valid JSON are skipped and counted. Reading
 * stops (truncated) after maxItems elements or when onItem returns false, and fails with vod_too_large after
 * maxBytes. Some panels answer with an object of objects ({"1": {...}}), read whole up to maxObjectBytes;
 * {"user_info":{"auth":0}} means the login was refused. Anything else (HTML, a cut-off array) is vod_unavailable.
 */
export async function readJsonArray(body: ReadableStream<Uint8Array> | null, onItem: (item: unknown) => unknown, limits: JsonListLimits): Promise<JsonListResult> {
  if (!body) throw vodUnavailable();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const maxElement = limits.maxElement ?? VOD_LIMITS.element;
  const maxObject = limits.maxObjectBytes ?? VOD_LIMITS.objectBytes;
  const result: JsonListResult = {items: 0, skipped: 0, truncated: false, bytes: 0};
  let phase: 'start' | 'array' | 'object' | 'done' = 'start';
  let depth = 0, inString = false, escaped = false;
  let pending = '', oversized = false, objectText = '';
  const stop = async () => {try {await reader.cancel();} catch {}};
  const take = (text: string) => {
    // An element past the limit means the list is longer than what is kept.
    if (result.items >= limits.maxItems) {result.truncated = true; return;}
    let value: unknown;
    try {value = JSON.parse(text);} catch {result.skipped++; return;}
    if (onItem(value) === false) {result.truncated = true; return;}
    result.items++;
  };
  try {
    for (;;) {
      if (limits.signal?.aborted) throw vodTimeout();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {chunk = await reader.read();}
      catch {throw limits.signal?.aborted ? vodTimeout() : vodUnavailable();}
      if (chunk.done) break;
      result.bytes += chunk.value.byteLength;
      if (result.bytes > limits.maxBytes) throw vodTooLarge();
      const text = decoder.decode(chunk.value, {stream: true});
      let i = 0;
      if (phase === 'start') {
        while (i < text.length && (text.charCodeAt(i) === 0xfeff || /\s/.test(text[i]))) i++;
        if (i >= text.length) continue;
        if (text[i] === '[') {phase = 'array'; depth = 1; i++;}
        else if (text[i] === '{') phase = 'object';
        else throw vodUnavailable();
      }
      if (phase === 'object') {
        objectText += text.slice(i);
        if (objectText.length > maxObject) throw vodTooLarge();
        continue;
      }
      if (phase === 'done') continue;
      let start = depth > 1 ? i : -1;
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 92) escaped = true;
          else if (c === 34) inString = false;
          continue;
        }
        if (c === 34) inString = true;
        else if (c === 123 || c === 91) {
          if (depth === 1) {start = i; pending = ''; oversized = false;}
          depth++;
        } else if (c === 125 || c === 93) {
          depth--;
          if (depth === 1 && start >= 0) {
            const piece = text.slice(start, i + 1);
            if (oversized || pending.length + piece.length > maxElement) result.skipped++;
            else take(pending ? pending + piece : piece);
            pending = ''; start = -1;
            if (result.truncated) {await stop(); return result;}
          } else if (depth === 0) {phase = 'done'; break;}
        }
      }
      // The chunk ended inside an element: keep its start for the next chunk, unless it is already too big.
      if (phase === 'array' && depth > 1 && start >= 0) {
        if (!oversized) {
          const piece = text.slice(start);
          if (pending.length + piece.length > maxElement) {oversized = true; pending = '';}
          else pending += piece;
        }
      }
    }
    const rest = decoder.decode();
    if (phase === 'object') return readObject(objectText + rest, onItem, limits, result);
    if (phase !== 'done') throw vodUnavailable();
    return result;
  } catch (error) {
    await stop();
    throw error instanceof VodError ? error : vodUnavailable();
  }
}

function readObject(text: string, onItem: (item: unknown) => unknown, limits: JsonListLimits, result: JsonListResult) {
  let data: unknown;
  try {data = JSON.parse(text);} catch {throw vodUnavailable();}
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw vodUnavailable();
  const record = data as Record<string, unknown>;
  const info = record.user_info as {auth?: unknown} | undefined;
  if (info && typeof info === 'object' && (info.auth === 0 || info.auth === '0')) throw vodLoginRejected();
  const values = Object.values(record);
  if (values.some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw vodUnavailable();
  for (const value of values) {
    if (result.items >= limits.maxItems || onItem(value) === false) {result.truncated = true; break;}
    result.items++;
  }
  return result;
}

// ------------------------------------------------------------------ posters

/** A file name the image route may append to a sealed directory: one path segment, no %, no dot first. */
export const POSTER_FILE = /^[A-Za-z0-9][A-Za-z0-9._~+-]{0,159}$/;
const IMAGE_NAME = /\.(?:jpe?g|png|gif|webp|avif)$/i;
/** A plain image file name (poster.jpg): the only names a sealed directory serves. */
export const isPosterFile = (file: string) => POSTER_FILE.test(file) && IMAGE_NAME.test(file);
/** Posters the browser loads itself: TMDB's public image host. Any other host would see the viewer's address. */
const DIRECT_POSTER_HOSTS = new Set(['image.tmdb.org']);
export type PosterClass = {kind: 'none'} | {kind: 'direct'; url: string} | {kind: 'proxy'; base: string; file: string};

function decoded(text: string) {
  try {return decodeURIComponent(text);} catch {return text;}
}

/**
 * True when an address carries one of the secrets (the line's username or password), in any case and however it is
 * encoded: as a whole path segment, file name or query value (any length), or inside the path or query (3 characters
 * or more, so short logins don't match every address).
 */
export function carriesSecret(url: URL, secrets: string[]) {
  const wanted = secrets.map(secret => secret.toLowerCase()).filter(Boolean);
  if (!wanted.length) return false;
  const exact = new Set<string>();
  for (const segment of url.pathname.split('/')) {
    const piece = decoded(segment).toLowerCase();
    exact.add(piece);
    exact.add(piece.replace(/\.[a-z0-9]{1,5}$/, ''));
  }
  // URLSearchParams decodes %xx and "+" (a space).
  for (const [name, value] of url.searchParams) {exact.add(name.toLowerCase()); exact.add(value.toLowerCase());}
  const text = [url.href, decoded(url.pathname), decoded(url.search.replace(/\+/g, ' ')), [...url.searchParams].join('&')].join('\n').toLowerCase();
  return wanted.some(secret => exact.has(secret) || (secret.length >= 3 && (text.includes(secret) || text.includes(encodeURIComponent(secret).toLowerCase()))));
}

/**
 * How the browser gets a poster. A poster on a provider host this Worker fetches itself (isProvider) goes through
 * /api/player/image, so the page never sees that host: as its directory (sealed) plus a plain image file name, or the
 * whole sealed address otherwise (a query, another kind of name, or a name carrying the login). TMDB posters load
 * directly (http upgraded to https). Anything else (other hosts, relay hosts, posters carrying the login) gets a title
 * card.
 */
export function classifyPoster(raw: string, isProvider: (url: URL) => boolean, secrets: string[] = []): PosterClass {
  const value = raw.trim();
  if (!value || value.length > VOD_LIMITS.posterURL) return {kind: 'none'};
  let url: URL;
  try {url = new URL(value);} catch {return {kind: 'none'};}
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return {kind: 'none'};
  url.hash = '';
  if (isProvider(url)) {
    const slash = url.pathname.lastIndexOf('/');
    const file = url.pathname.slice(slash + 1);
    if (!url.search && isPosterFile(file) && !carriesSecret(new URL('https://poster.invalid/' + file), secrets)) {
      return {kind: 'proxy', base: url.origin + url.pathname.slice(0, slash + 1), file};
    }
    return {kind: 'proxy', base: url.href, file: ''};
  }
  if (!DIRECT_POSTER_HOSTS.has(url.hostname) || url.port || carriesSecret(url, secrets)) return {kind: 'none'};
  url.protocol = 'https:';
  return {kind: 'direct', url: url.href};
}

/** The sealed part of a proxied poster: its directory (dir) or whole address, the line it belongs to, and its expiry. */
export type ImageToken = {u: string; l: string; exp: number; dir?: 1};
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Collects a list's posters. Each proxied poster becomes "~<base>:<file>", where base indexes `bases`: one sealed
 * token per distinct directory, so a 50,000-title list usually costs a handful of seals and stays small. A list whose
 * posters each need their own token (one directory per title, or a query per poster) stops at maxBases tokens; the
 * posters after that get title cards. Direct posters stay https URLs; posters the browser can't load are left out.
 */
export function createPosterBook(isProvider: (url: URL) => boolean, secrets: string[], maxBases: number = VOD_LIMITS.posterBases) {
  const index = new Map<string, number>();
  const sources: {u: string; dir: boolean}[] = [];
  return {
    add(raw: string): string | undefined {
      const poster = classifyPoster(raw, isProvider, secrets);
      if (poster.kind === 'none') return undefined;
      if (poster.kind === 'direct') return poster.url;
      const dir = poster.file !== '';
      const id = (dir ? 'd:' : 'u:') + poster.base;
      let position = index.get(id);
      if (position === undefined) {
        if (sources.length >= maxBases) return undefined;
        position = sources.length;
        index.set(id, position);
        sources.push({u: poster.base, dir});
      }
      return '~' + position + ':' + poster.file;
    },
    get size() {return sources.length;},
    /**
     * Seals every base for one line (line: mac of the username, 'player-line'). Tokens expire 7 to 8 days later, at a
     * day boundary, so the same poster keeps the same link all day and the browser's cache can serve it.
     */
    async seal(line: string, secret: string, now = Date.now()) {
      const exp = (Math.floor(now / DAY_MS) + 8) * DAY_MS;
      const purpose: TokenPurpose = 'player-image';
      return Promise.all(sources.map(source => sealStable({u: source.u, l: line, exp, ...(source.dir ? {dir: 1} : {})} satisfies ImageToken, secret, purpose)));
    },
  };
}

export function validImageToken(value: unknown, line: string, now = Date.now()): value is ImageToken {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ImageToken>;
  return typeof item.u === 'string' && item.u.length > 0 && item.u.length <= VOD_LIMITS.posterURL && item.l === line &&
    typeof item.exp === 'number' && Number.isFinite(item.exp) && item.exp > now && (item.dir === undefined || item.dir === 1);
}

/** The address an image request asks for: a sealed directory plus a plain image file name, or a sealed address alone. */
export function imageAddress(token: ImageToken, file: string) {
  if (token.dir === 1) {
    if (!isPosterFile(file) || !token.u.endsWith('/')) return null;
    return token.u + file;
  }
  return file === '' ? token.u : null;
}

/** The type of a raster image from its first bytes; SVG, HTML and anything else is refused (null). */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  const ascii = (offset: number, text: string) => [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif';
  return null;
}

// ------------------------------------------------------------------ series and movie details

export type EpisodeInfo = {id: string; episode: number; title: string; ext: string; duration?: number; plot?: string};
export type SeasonInfo = {season: number; name: string; episodes: EpisodeInfo[]};
export type SeriesInfo = {id: string; name: string; plot: string; year: string; genre: string; rating: number; poster: string; tmdb: string; seasons: SeasonInfo[]};
export type MovieInfo = {id: string; plot: string; duration: number; genre: string; cast: string; director: string; released: string; rating: number; tmdb: string};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clip = (value: unknown, max: number) => asText(value).trim().slice(0, max);

/** Seconds from duration_secs, or from "HH:MM:SS" / "MM:SS". */
export function durationOf(info: Record<string, unknown>) {
  const secs = parseInt(asText(info.duration_secs), 10);
  if (Number.isSafeInteger(secs) && secs > 0 && secs < 100000) return secs;
  const parts = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(asText(info.duration).trim());
  if (!parts) return 0;
  return parts[3] === undefined ? Number(parts[1]) * 60 + Number(parts[2]) : Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
}

function ratingText(value: unknown) {
  const rating = parseFloat(asText(value));
  if (!Number.isFinite(rating) || rating <= 0) return 0;
  return Math.round(Math.min(rating > 10 ? rating / 10 : rating, 10) * 10) / 10;
}

function tmdbText(...values: unknown[]) {
  for (const value of values) {
    const text = asText(value).trim();
    if (text && text !== '0' && /^\d{1,12}$/.test(text)) return text;
  }
  return '';
}

/**
 * get_series_info as seasons in number order ("10" after "2") with their episodes, within VOD_LIMITS. Panels send
 * episodes as {"1": [...]} or as an array; either way an episode's own season number wins.
 */
export function compactSeriesInfo(raw: unknown, id: string): SeriesInfo {
  const data = record(raw), info = record(data.info);
  const bySeason = new Map<number, EpisodeInfo[]>();
  let count = 0;
  const add = (season: number, rawEpisode: unknown) => {
    const episode = record(rawEpisode), details = record(episode.info);
    const episodeId = asText(episode.id).trim();
    if (!XTREAM_ID.test(episodeId) || count >= VOD_LIMITS.episodes) return;
    const number = parseInt(asText(episode.season), 10);
    const key = Number.isSafeInteger(number) && number >= 0 ? number : season;
    if (!bySeason.has(key) && bySeason.size >= VOD_LIMITS.seasons) return;
    const ext = asText(episode.container_extension).trim().toLowerCase();
    const item: EpisodeInfo = {id: episodeId, episode: parseInt(asText(episode.episode_num), 10) || 0, title: clip(episode.title, VOD_LIMITS.episodeTitle), ext: /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'mp4'};
    const duration = durationOf(details);
    if (duration) item.duration = duration;
    const plot = clip(details.plot, VOD_LIMITS.plot);
    if (plot) item.plot = plot;
    let list = bySeason.get(key);
    if (!list) bySeason.set(key, list = []);
    list.push(item);
    count++;
  };
  const episodes = data.episodes;
  if (Array.isArray(episodes)) {
    episodes.forEach((entry, position) => {for (const item of Array.isArray(entry) ? entry : [entry]) add(position + 1, item);});
  } else {
    for (const [key, list] of Object.entries(record(episodes))) {
      const season = parseInt(key, 10);
      for (const item of Array.isArray(list) ? list : []) add(Number.isSafeInteger(season) ? season : 0, item);
    }
  }
  const names = new Map<number, string>();
  for (const season of Array.isArray(data.seasons) ? data.seasons : []) {
    const entry = record(season);
    const number = parseInt(asText(entry.season_number), 10);
    const name = clip(entry.name, 100);
    if (Number.isSafeInteger(number) && name) names.set(number, name);
  }
  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, list]) => ({
    season, name: names.get(season) || (season ? 'Season ' + season : 'Specials'),
    episodes: list.sort((a, b) => a.episode - b.episode),
  }));
  return {
    id, name: clip(info.name, 150), plot: clip(info.plot, VOD_LIMITS.plot), year: (/^\s*((?:19|20)\d\d)/.exec(asText(info.releaseDate || info.release_date || info.year))?.[1]) || '',
    genre: clip(info.genre, 100), rating: ratingText(info.rating), poster: asText(info.cover).trim(), tmdb: tmdbText(info.tmdb, info.tmdb_id), seasons,
  };
}

/** get_vod_info as what the details screen shows. */
export function compactMovieInfo(raw: unknown, id: string): MovieInfo {
  const info = record(record(raw).info);
  const released = asText(info.releasedate || info.release_date || info.releaseDate).trim();
  return {
    id, plot: clip(info.plot || info.description, VOD_LIMITS.plot), duration: durationOf(info), genre: clip(info.genre, 100),
    cast: clip(info.cast || info.actors, 300), director: clip(info.director, 150), released: /^\d{4}(-\d{2}-\d{2})?$/.test(released) ? released : '',
    rating: ratingText(info.rating), tmdb: tmdbText(info.tmdb_id, info.tmdb),
  };
}
