// Movies & Series browsing rules (docs/browse.md) for the web player, ported line for line from the Roku app's
// apps/roku/source/lib/BrowseLogic.brs so every Tuner app and the web player pick, match and order titles the same
// way. Pure: no DOM, no Workers APIs. The server (lib/player-vod.ts) uses the compaction helpers; the browser
// (app/watch) builds the browse index from the compact catalogue and GET /api/catalog/rows?v=1.
import {isAdultGroup} from './player-data.ts';

// ------------------------------------------------------------------ values

export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

/** Xtream marks adult categories and streams with is_adult = 1, "1" or true. */
export function isFlagOn(value: unknown) {
  const text = asText(value);
  return text === '1' || text.toLowerCase() === 'true';
}

function numberOf(value: unknown) {
  const text = asText(value).trim();
  if (!text) return 0;
  const number = parseFloat(text);
  return Number.isFinite(number) ? number : 0;
}

function integerOf(value: unknown) {
  const number = parseInt(asText(value).trim(), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const arrayOrEmpty = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

// ------------------------------------------------------------------ fixed lists

export const SERVICES = ['netflix', 'disney', 'max', 'prime', 'apple', 'hulu', 'paramount', 'peacock'] as const;
export type ServiceKey = (typeof SERVICES)[number];
const SERVICE_NAMES: Record<ServiceKey, string> = {netflix: 'Netflix', disney: 'Disney+', max: 'Max', prime: 'Prime Video', apple: 'Apple TV+', hulu: 'Hulu', paramount: 'Paramount+', peacock: 'Peacock'};
/** Streaming services in the order Home shows them. */
export function browseServices(): {key: ServiceKey; name: string}[] {
  return SERVICES.map(key => ({key, name: SERVICE_NAMES[key]}));
}

// Compiled once. The same patterns as browseRx() on Roku.
const SERVICE_RX: Record<ServiceKey, RegExp> = {
  netflix: /NETFLIX/,
  disney: /DISNEY/,
  max: /HBO|(?:^|[^A-Z0-9])MAX(?:[^A-Z0-9]|$)/,
  prime: /AMAZON|(?:^|[^A-Z0-9])PRIME(?:[^A-Z0-9]|VIDEO|$)/,
  apple: /APPLE/,
  hulu: /HULU/,
  paramount: /PARAMOUNT/,
  peacock: /PEACOCK/,
};
// The same list as the Android app (VodRegion) and Roku, plus "arab" ("ARAB MOVIES" carries no AR code).
const FOREIGN_WORDS = 'french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espanol|español|spain|castellano|latino|latina|latam|mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arabic|arab|india|indian|hindi|bollywood|tamil|telugu|malayalam|punjabi|pakistan|pakistani|urdu|dutch|netherlands|polish|poland|polska|romanian|romania|russian|russia|british|canada|canadian|quebec';
// Separators that make "IN" or "IT" a tag rather than an English word.
const TAG_SEP = '(?:[|:\\[\\]()/-]|–)';
const RX = {
  // Bracketed, pipe-delimited and short parenthesised tags: [4K], {EN}, |US|, (US), (2019).
  tags: /\[[^\]]*\]|\{[^}]*\}|\|[^|]*\||\([0-9]{4}\)|\([A-Z0-9 +]{1,4}\)/g,
  // A short upper-case tag in front of the title: "US - ", "EN| ", "NF: ".
  prefix: /^\s*[A-Z0-9+]{2,4}\s*(?:\|\s*|[:-]\s+)/,
  // The same kind of tag after the title: " | EN", " - US".
  suffix: /\s(?:\||-)\s*[A-Z0-9+]{2,4}\s*$/,
  year: /[([]\s*((?:19|20)[0-9][0-9])\s*[)\]]/,
  yearText: /^\s*((?:19|20)[0-9][0-9])/,
  digits: /^[0-9]+$/,
  apostrophe: /['`´’]/g,
  nonWord: /[^a-z0-9]+/g,
  nonAscii: /[^\x00-\x7F]/,
  genreSplit: /[,/|&;]+/,
  // Parts of a category name that can each name a genre: "EN | Action Movies", "Kids & Family".
  categorySplit: /[,/|&;:()[\]]+|\s+-\s+|–/,
  spaces: /\s+/g,
  // Country and language tags (upper case, as a whole word or a "XX |", "|XX|", "XX:" prefix)...
  foreignCode: /(?:^|[^A-Za-z0-9])(?:FR|DE|ES|LAT|MX|BR|PT|TR|AR|HINDI|PK|NL|PL|RO|RU|UK|CA)(?:[^A-Za-z0-9]|$)/,
  // ...IN and IT only as a tag: at the start or end of the name or next to a separator ("IT: Serie", "Films (IN)"),
  // never as the English word in "MOVIES IN 4K" or "NEW IN CINEMAS"...
  foreignTag: new RegExp('^\\s*(?:IN|IT)(?:[^A-Za-z0-9]|$)|(?:^|[^A-Za-z0-9])(?:IN|IT)\\s*$|' + TAG_SEP + '\\s*(?:IN|IT)(?:[^A-Za-z0-9]|$)|(?:^|[^A-Za-z0-9])(?:IN|IT)\\s*' + TAG_SEP),
  // ...and the same countries and languages written out.
  foreignWord: new RegExp('(?:^|[^a-z])(?:' + FOREIGN_WORDS + ')(?:[^a-z]|$)', 'i'),
};
const QUALITY = new Set(['4k', 'uhd', 'hd', 'fhd', 'hdr', 'hdr10', '1080p', '720p', '2160p']);
const ACCENTS: [string, string][] = [['á', 'a'], ['à', 'a'], ['â', 'a'], ['ä', 'a'], ['ã', 'a'], ['å', 'a'], ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'], ['í', 'i'], ['ì', 'i'], ['î', 'i'], ['ï', 'i'], ['ó', 'o'], ['ò', 'o'], ['ô', 'o'], ['ö', 'o'], ['õ', 'o'], ['ø', 'o'], ['ú', 'u'], ['ù', 'u'], ['û', 'u'], ['ü', 'u'], ['ñ', 'n'], ['ç', 'c'], ['ý', 'y'], ['ÿ', 'y'], ['æ', 'ae'], ['œ', 'oe'], ['ß', 'ss']];

// ------------------------------------------------------------------ titles

/**
 * Normalized title for matching (docs/browse.md): lower case; no trailing (YYYY), bracketed or pipe-delimited tags
 * or "US -" style prefixes; no quality words; & becomes and; no punctuation; single spaces; no leading "the ".
 */
export function normalizeTitle(name: string): string {
  let s = name;
  if (/[[{|(]/.test(s)) s = s.replace(RX.tags, ' ');
  if (/[|:-]/.test(s)) {
    for (let i = 0; i < 3; i++) {
      const stripped = s.replace(RX.prefix, '');
      if (stripped === s) break;
      s = stripped;
    }
    s = s.replace(RX.suffix, '');
  }
  s = s.toLowerCase();
  if (s.includes('&')) s = s.split('&').join(' and ');
  s = s.replace(RX.apostrophe, '');
  if (RX.nonAscii.test(s)) for (const [from, to] of ACCENTS) s = s.split(from).join(to);
  const words = s.replace(RX.nonWord, ' ').split(' ').filter(word => word && !QUALITY.has(word));
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

/** "Dune (2021)" or "Dune [2021]" -> "2021". */
export function titleYearOf(name: string) {
  if (!name.includes('(') && !name.includes('[')) return '';
  return RX.year.exec(name)?.[1] || '';
}

/** "2021-05-01", "2021" or 2021 -> "2021". */
export function yearOfText(value: unknown) {
  return RX.yearText.exec(asText(value))?.[1] || '';
}

/** The TMDB id a provider item carries in tmdb, tmdb_id or info.tmdb_id (numbers only), or "". */
export function providerTmdbId(row: Record<string, unknown>) {
  const values = [row.tmdb, row.tmdb_id];
  if (isRecord(row.info)) values.push(row.info.tmdb_id);
  for (const value of values) {
    const text = asText(value).trim();
    if (text && text !== '0' && RX.digits.test(text) && text.length <= 12) return text;
  }
  return '';
}

export function ratingOf(row: Record<string, unknown>) {
  let rating = numberOf(row.rating);
  if (rating <= 0) rating = numberOf(row.rating_5based) * 2;
  if (rating > 10) rating = rating / 10;
  return rating > 0 ? Math.round(Math.min(rating, 10) * 10) / 10 : 0;
}

// ------------------------------------------------------------------ the compact catalogue (server -> browser)

/**
 * One Xtream title as the web player's catalogue sends it: only what browsing needs. poster is a direct https URL,
 * or "~<base>:<file>" for a poster served through /api/player/image (see lib/player-vod.ts).
 */
export type CompactTitle = {id: string; name: string; year?: string; cat?: string; poster?: string; rating?: number; added?: number; tmdb?: string; ext?: string; genre?: string; adult?: true};
export type CompactCategory = {id: string; name: string; adult?: true};
const XTREAM_ID = /^\d{1,10}$/;
const EXTENSION = /^[a-z0-9]{2,5}$/;

/**
 * One Xtream get_vod_streams (kind "movie") or get_series (kind "series") row, or null when it has no numeric id.
 * Everything else the provider sends (direct_source, custom_sid, num, stream_type, category_ids…) is dropped.
 */
export function compactXtream(kind: 'movie' | 'series', raw: unknown): CompactTitle | null {
  if (!isRecord(raw)) return null;
  const id = asText(kind === 'movie' ? raw.stream_id : raw.series_id).trim();
  if (!XTREAM_ID.test(id)) return null;
  const name = asText(raw.name).trim().slice(0, 150);
  const year = yearOfText(raw.year) || yearOfText(raw.releaseDate) || yearOfText(raw.release_date) || yearOfText(raw.releasedate) || titleYearOf(name);
  const cat = asText(raw.category_id).trim().slice(0, 40);
  const poster = asText(kind === 'movie' ? raw.stream_icon : raw.cover).trim();
  const rating = ratingOf(raw);
  const added = integerOf(kind === 'movie' ? raw.added : raw.last_modified);
  const tmdb = providerTmdbId(raw);
  const genre = asText(raw.genre).trim().slice(0, 100);
  const item: CompactTitle = {id, name};
  if (year) item.year = year;
  if (cat) item.cat = cat;
  if (poster && poster.length <= 1024) item.poster = poster;
  if (rating) item.rating = rating;
  if (added) item.added = added;
  if (tmdb) item.tmdb = tmdb;
  if (kind === 'movie') {
    const ext = asText(raw.container_extension).trim().toLowerCase();
    item.ext = EXTENSION.test(ext) ? ext : 'mp4';
  }
  if (genre) item.genre = genre;
  if (isFlagOn(raw.is_adult)) item.adult = true;
  return item;
}

/** One Xtream category row ({category_id, category_name}), or null. */
export function compactCategory(raw: unknown): CompactCategory | null {
  if (!isRecord(raw)) return null;
  const id = asText(raw.category_id).trim().slice(0, 40);
  if (!id) return null;
  const category: CompactCategory = {id, name: asText(raw.category_name).trim().slice(0, 100)};
  if (isFlagOn(raw.is_adult)) category.adult = true;
  return category;
}

// ------------------------------------------------------------------ titles in the browse index

export type MediaType = 'movies' | 'series';
/** movie and series come from Xtream; episode is an M3U series entry that plays on its own. */
export type TitleKind = 'movie' | 'series' | 'episode';
export type BrowseTitle = {
  kind: TitleKind;
  /** Library key: "m<stream_id>", "s<series_id>", or "m~<channel id>" / "s~<channel id>" for M3U entries. */
  key: string;
  id: string;
  name: string;
  cat: string;
  adult: boolean;
  year: string;
  rating: number;
  /** The provider's TMDB id, if any. */
  hint: string;
  genre: string;
  poster: string;
  ext: string;
  added: number;
  /** M3U entries: the channel whose token plays the title. */
  channel?: string;
};

export function titleFromCompact(kind: 'movie' | 'series', item: CompactTitle): BrowseTitle {
  return {
    kind, key: kind[0] + item.id, id: item.id, name: item.name, cat: item.cat || '__other', adult: Boolean(item.adult),
    year: item.year || '', rating: item.rating || 0, hint: item.tmdb || '', genre: item.genre || '', poster: item.poster || '',
    ext: item.ext || (kind === 'movie' ? 'mp4' : ''), added: item.added || 0,
  };
}

/** One M3U movie or series entry. An M3U series entry is one episode that plays on its own. */
export function titleFromM3u(kind: 'movie' | 'episode', channel: string, name: string, poster: string, group: string, ext: string): BrowseTitle {
  return {
    kind, key: (kind === 'movie' ? 'm~' : 's~') + channel, id: '', name, cat: group || 'Other', adult: false, year: titleYearOf(name),
    rating: 0, hint: '', genre: '', poster, ext, added: 0, channel,
  };
}

// ------------------------------------------------------------------ USA only and adult rules

/** A category fails the USA filter when its name carries a non-US country or language tag. */
export function isForeignCategory(name: string) {
  if (!name) return false;
  return RX.foreignCode.test(name) || RX.foreignTag.test(name) || RX.foreignWord.test(name);
}

/** XXX, Adult, Adults, 18+ or Porn, but not Adult Swim: the web player's live-channel rule (lib/player-data.ts). */
export const isAdultName = (name: string) => isAdultGroup(name);

/** Streaming services a provider category belongs to by name ("NETFLIX 4K" -> ["netflix"]). */
export function categoryServices(name: string): ServiceKey[] {
  const upper = name.toUpperCase();
  return SERVICES.filter(key => SERVICE_RX[key].test(upper));
}

// ------------------------------------------------------------------ catalog rows endpoint

export type RowsItem = {id?: unknown; title?: unknown; original_title?: unknown; year?: unknown; origin?: unknown; genres?: unknown};
export type RowsSection = {popular: unknown[]; featured: unknown[]; top_rated: unknown[]; services: Record<ServiceKey, unknown[]>};
export type RowsPayload = {valid: boolean; source: string; generated: string; movie: RowsSection; tv: RowsSection; genres: {movie: unknown[]; tv: unknown[]}};

export function emptyRowsSection(): RowsSection {
  return {popular: [], featured: [], top_rated: [], services: Object.fromEntries(SERVICES.map(key => [key, []])) as unknown as Record<ServiceKey, unknown[]>};
}

/**
 * Reads the body of GET /api/catalog/rows?v=1 (text or parsed JSON). Any missing or malformed list becomes an empty
 * list; anything that is not version 1 counts as "no data" (source "none", valid false).
 */
export function parseRowsPayload(body: unknown): RowsPayload {
  const out: RowsPayload = {valid: false, source: 'none', generated: '', movie: emptyRowsSection(), tv: emptyRowsSection(), genres: {movie: [], tv: []}};
  let data: unknown = body;
  if (typeof body === 'string') {
    try {data = body ? JSON.parse(body) : null;} catch {data = null;}
  }
  if (!isRecord(data) || asText(data.v) !== '1') return out;
  out.valid = true;
  if (asText(data.source)) out.source = asText(data.source);
  out.generated = asText(data.generated);
  for (const kind of ['movie', 'tv'] as const) {
    const section = data[kind];
    if (!isRecord(section)) continue;
    const target = out[kind];
    target.popular = arrayOrEmpty(section.popular);
    target.featured = arrayOrEmpty(section.featured);
    target.top_rated = arrayOrEmpty(section.top_rated);
    if (isRecord(section.services)) for (const key of SERVICES) target.services[key] = arrayOrEmpty(section.services[key]);
  }
  if (isRecord(data.genres)) {
    out.genres.movie = arrayOrEmpty(data.genres.movie);
    out.genres.tv = arrayOrEmpty(data.genres.tv);
  }
  return out;
}

// ------------------------------------------------------------------ matching

export type TmdbEntry = {id: string; year: number; us: boolean; known: boolean; g: string};

function tmdbEntry(raw: unknown): TmdbEntry | null {
  if (!isRecord(raw)) return null;
  const id = asText(raw.id);
  if (!id) return null;
  // known is false when TMDB gave no country (origin []); USA only then goes by the category alone.
  let us = false, known = false;
  for (const country of arrayOrEmpty(raw.origin)) {
    const code = asText(country).toUpperCase();
    if (code) known = true;
    if (code === 'US') us = true;
  }
  let g = '';
  for (const genre of arrayOrEmpty(raw.genres)) {
    const text = asText(genre);
    if (text) g += '|' + text;
  }
  if (g) g += '|';
  return {id, year: parseInt(asText(raw.year).slice(0, 4), 10) || 0, us, known, g};
}

export type TmdbIndex = {byId: Map<string, TmdbEntry>; byTitle: Map<string, TmdbEntry[]>; count: number};

/** Every TMDB title in one section of the rows payload, by id and by normalized title (and original title). */
export function tmdbIndex(section: RowsSection): TmdbIndex {
  const byId = new Map<string, TmdbEntry>(), byTitle = new Map<string, TmdbEntry[]>();
  for (const list of [section.popular, section.featured, section.top_rated, ...SERVICES.map(key => section.services[key])]) {
    for (const raw of arrayOrEmpty(list)) {
      const entry = tmdbEntry(raw);
      if (!entry || byId.has(entry.id)) continue;
      byId.set(entry.id, entry);
      const item = raw as RowsItem;
      for (const key of [normalizeTitle(asText(item.title)), normalizeTitle(asText(item.original_title))]) {
        if (!key) continue;
        let bucket = byTitle.get(key);
        if (!bucket) byTitle.set(key, bucket = []);
        if (!bucket.length || bucket[bucket.length - 1].id !== entry.id) bucket.push(entry);
      }
    }
  }
  return {byId, byTitle, count: byId.size};
}

/**
 * 1. A provider TMDB id matches on the id alone. 2. Otherwise the normalized title must match and the years may
 * differ by 1. A title without a year matches only when exactly one TMDB title has that name.
 */
export function matchTmdb(index: TmdbIndex, hint: string, norm: string, year: string): TmdbEntry | null {
  if (hint) return index.byId.get(hint) || null;
  const candidates = norm ? index.byTitle.get(norm) : undefined;
  if (!candidates) return null;
  const wanted = parseInt(year, 10) || 0;
  if (wanted <= 0) return candidates.length === 1 ? candidates[0] : null;
  let best: TmdbEntry | null = null;
  for (const candidate of candidates) {
    if (candidate.year === wanted) return candidate;
    if (!best && candidate.year > 0 && Math.abs(candidate.year - wanted) <= 1) best = candidate;
  }
  return best;
}

// ------------------------------------------------------------------ genres

const GENRE_ALIASES: Record<string, string> = {'sci-fi': 'science fiction', scifi: 'science fiction', 'sci fi': 'science fiction', 'science-fiction': 'science fiction', documentaries: 'documentary', docs: 'documentary', docu: 'documentary', comedies: 'comedy', dramas: 'drama', thrillers: 'thriller', westerns: 'western', animated: 'animation', anime: 'animation', cartoon: 'animation', cartoons: 'animation', children: 'kids', childrens: 'kids', kid: 'kids', romantic: 'romance', musical: 'music', musicals: 'music', suspense: 'thriller', horrors: 'horror', historical: 'history', crimes: 'crime'};
const CATEGORY_NOISE = new Set(['movies', 'movie', 'films', 'film', 'series', 'shows', 'show', 'tv', 'vod', '4k', 'uhd', 'hd', 'fhd', 'en', 'us', 'usa', 'english', 'new', 'top', 'best', 'all', 'and']);
const COMMON_GENRES: Record<string, string> = {action: 'Action', adventure: 'Adventure', animation: 'Animation', comedy: 'Comedy', crime: 'Crime', documentary: 'Documentary', drama: 'Drama', family: 'Family', fantasy: 'Fantasy', history: 'History', horror: 'Horror', music: 'Music', mystery: 'Mystery', romance: 'Romance', 'science fiction': 'Science Fiction', thriller: 'Thriller', war: 'War', western: 'Western', kids: 'Kids', reality: 'Reality', sports: 'Sports'};

export function genreToken(text: string) {
  const token = text.toLowerCase().trim();
  return Object.hasOwn(GENRE_ALIASES, token) ? GENRE_ALIASES[token] : token;
}

export type GenreOption = {key: string; name: string};
export type GenreTable = {list: GenreOption[]; lookup: Map<string, string>; open: boolean};

/**
 * TMDB genres for one type ({id, name} rows) as the Discover genre list plus a lookup from a provider genre word to
 * a TMDB genre id. With no TMDB genres the table is "open": provider genre words become the genres themselves.
 */
export function genreTable(raw: unknown): GenreTable {
  const list: GenreOption[] = [], lookup = new Map<string, string>();
  for (const genre of arrayOrEmpty(raw)) {
    if (!isRecord(genre)) continue;
    const id = asText(genre.id), name = asText(genre.name);
    if (!id || !name) continue;
    list.push({key: id, name});
    lookup.set(genreToken(name), id);
    for (const part of name.split('&')) {
      const token = genreToken(part);
      if (token && !lookup.has(token)) lookup.set(token, id);
    }
  }
  return {list, lookup, open: list.length === 0};
}

const addKey = (g: string, key: string) => key && !(g + '|').includes('|' + key + '|') ? g + '|' + key : g;

/** Provider genre text ("Action, Drama") as genre keys "|28|18|" ("" when none is known). */
export function providerGenreKeys(text: string, table: GenreTable) {
  if (!text) return '';
  let g = '';
  for (const part of text.split(RX.genreSplit)) {
    const token = genreToken(part.replace(RX.spaces, ' '));
    if (!token) continue;
    let key = table.lookup.get(token) || '';
    if (!key && table.open) {
      key = token;
      table.lookup.set(token, key);
      const display = part.trim();
      table.list.push({key, name: display.slice(0, 1).toUpperCase() + display.slice(1)});
    }
    g = addKey(g, key);
  }
  return g ? g + '|' : '';
}

/**
 * A provider category named after a genre ("EN | Action Movies", "Kids & Family", "Sci-Fi") as genre keys "|28|"
 * ("" when none). Each part of the name must be a genre on its own once words such as Movies, EN or 4K are dropped,
 * so "Comedy Central" or "Netflix" never count. With no TMDB genres only common genres count.
 */
export function categoryGenreKeys(name: string, table: GenreTable) {
  if (!name) return '';
  let g = '';
  for (const part of name.split(RX.categorySplit)) {
    const words = part.toLowerCase().split(RX.nonWord).filter(word => word && !CATEGORY_NOISE.has(word));
    const token = genreToken(words.join(' '));
    let key = '';
    if (!token) key = '';
    else if (table.lookup.has(token)) key = table.lookup.get(token)!;
    else if (table.open && Object.hasOwn(COMMON_GENRES, token)) {
      key = token;
      table.lookup.set(token, key);
      table.list.push({key, name: COMMON_GENRES[token]});
    }
    g = addKey(g, key);
  }
  return g ? g + '|' : '';
}

// ------------------------------------------------------------------ building the browse index

/** A title as the screen browses it: what it is, how to show it, and its USA, adult, TMDB and genre facts. */
export type IndexedTitle = {
  kind: TitleKind; key: string; id: string; name: string; year: string; rating: number; poster: string; ext: string;
  adult: boolean; us: boolean; tmdb: string; g: string; channel?: string;
};
export type ListKey = 'popular' | 'featured' | 'recent' | 'rated' | 'az' | ServiceKey;
export type TitleSection = {items: IndexedTitle[]; lists: Record<ListKey, number[]>; byKey: Map<string, number>; genres: GenreOption[]; matched: number};
export type CategoryInput = {id: string; name: string; adult?: unknown};

type Pair<K> = {i: number; k: K};
const byNumberDesc = (pairs: Pair<number>[]) => pairs.sort((a, b) => b.k - a.k || a.i - b.i).map(pair => pair.i);

function tmdbOrder(list: unknown[], byTmdb: Map<string, number[]>) {
  const out: number[] = [];
  for (const raw of arrayOrEmpty(list)) {
    if (!isRecord(raw)) continue;
    const group = byTmdb.get(asText(raw.id));
    if (group) out.push(...group);
  }
  return out;
}

function mergeIndices(first: number[], second: number[]) {
  const seen = new Set<number>(), out: number[] = [];
  for (const list of [first, second]) for (const i of list) if (!seen.has(i)) {seen.add(i); out.push(i);}
  return out;
}

/**
 * Turns one type's titles into what the screen browses, as a generator that yields every `slice` titles so a long
 * catalogue can be built without freezing a TV browser (buildTitleSectionAsync). titles: from titleFromCompact or
 * titleFromM3u. categories: [{id, name, adult}]. section and rawGenres: from parseRowsPayload (movie or tv).
 */
export function* titleSectionSteps(titles: BrowseTitle[], categories: CategoryInput[], section: RowsSection, rawGenres: unknown, slice = 2500): Generator<void, TitleSection> {
  const index = tmdbIndex(section);
  const genres = genreTable(rawGenres);
  type CategoryInfo = {foreign: boolean; adult: boolean; services: ServiceKey[]; g: string};
  const catInfo = new Map<string, CategoryInfo>();
  for (const cat of categories) catInfo.set(cat.id, {foreign: isForeignCategory(cat.name), adult: isFlagOn(cat.adult) || cat.adult === true || isAdultName(cat.name), services: categoryServices(cat.name), g: categoryGenreKeys(cat.name, genres)});
  const plain: CategoryInfo = {foreign: false, adult: false, services: [], g: ''};
  const usedGenres = new Set<string>();
  // Provider genre texts repeat across thousands of titles ("Action, Drama"); each is worked out once.
  const genreCache = new Map<string, string>();
  const items: IndexedTitle[] = [], byKey = new Map<string, number>(), byTmdb = new Map<string, number[]>();
  const byService = new Map<ServiceKey, Pair<number>[]>(SERVICES.map(key => [key, []]));
  const recent: Pair<number>[] = [], rated: Pair<number>[] = [], az: Pair<string>[] = [];
  let matched = 0;
  for (let n = 0; n < titles.length; n++) {
    if (n && n % slice === 0) yield;
    const title = titles[n];
    const info = catInfo.get(title.cat) || plain;
    const norm = normalizeTitle(title.name);
    const entry = index.count > 0 ? matchTmdb(index, title.hint, norm, title.year) : null;
    // USA only keeps a title only if its category passes the filter and, when it is matched to TMDB and TMDB gave its
    // countries, they include US. A match with no countries (origin []) is judged by its category alone.
    let us = !info.foreign, tmdb = '', g = '';
    if (entry) {
      tmdb = entry.id; g = entry.g;
      if (entry.known) us = us && entry.us;
      matched++;
    }
    // Genres: TMDB's, else the provider's genre text, else a category named after a genre.
    if (!g && title.genre) {
      let keys = genreCache.get(title.genre);
      if (keys === undefined) genreCache.set(title.genre, keys = providerGenreKeys(title.genre, genres));
      g = keys;
    }
    if (!g) g = info.g;
    if (g) usedGenres.add(g);
    const i = items.length;
    const item: IndexedTitle = {kind: title.kind, key: title.key, id: title.id, name: title.name, year: title.year, rating: title.rating, poster: title.poster, ext: title.ext, adult: title.adult || info.adult, us, tmdb, g};
    if (title.channel) item.channel = title.channel;
    items.push(item);
    if (!byKey.has(title.key)) byKey.set(title.key, i);
    if (tmdb) {
      const group = byTmdb.get(tmdb);
      if (group) group.push(i); else byTmdb.set(tmdb, [i]);
    }
    for (const key of info.services) byService.get(key)!.push({i, k: title.added});
    if (title.added > 0) recent.push({i, k: title.added});
    if (title.rating > 0) rated.push({i, k: title.rating});
    // Catalogue order breaks ties, so copies of one title always sort the same way.
    az.push({i, k: norm || title.name.toLowerCase()});
  }
  // Copies of one TMDB title: the ones in categories that pass the USA filter come first.
  for (const [id, group] of byTmdb) {
    if (group.length > 1) byTmdb.set(id, [...group.filter(i => items[i].us), ...group.filter(i => !items[i].us)]);
  }
  yield;
  const lists = {
    popular: tmdbOrder(section.popular, byTmdb),
    featured: tmdbOrder(section.featured, byTmdb),
    recent: byNumberDesc(recent),
    rated: mergeIndices(tmdbOrder(section.top_rated, byTmdb), byNumberDesc(rated)),
    az: az.sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i).map(pair => pair.i),
  } as Record<ListKey, number[]>;
  for (const key of SERVICES) lists[key] = mergeIndices(tmdbOrder(section.services[key], byTmdb), byNumberDesc(byService.get(key)!));
  let genreList = genres.list;
  if (genres.open) {
    // Provider and category genres: only those some title has, by name.
    const used = new Set<string>();
    for (const g of usedGenres) for (const key of g.split('|')) if (key) used.add(key);
    genreList = genres.list.filter(genre => used.has(genre.key)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  return {items, lists, byKey, genres: genreList, matched};
}

export function buildTitleSection(titles: BrowseTitle[], categories: CategoryInput[], section: RowsSection, rawGenres: unknown): TitleSection {
  const steps = titleSectionSteps(titles, categories, section, rawGenres);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Builds a section, handing the thread back (pause) between slices so the page stays responsive. */
export async function buildTitleSectionAsync(titles: BrowseTitle[], categories: CategoryInput[], section: RowsSection, rawGenres: unknown, pause: () => Promise<void>, slice = 2500): Promise<TitleSection> {
  const steps = titleSectionSteps(titles, categories, section, rawGenres, slice);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}

// ------------------------------------------------------------------ picking titles for the screen

export type PickOptions = {usOnly: boolean; adultOk: boolean; genre?: string; seen?: Set<string>};

export function titleVisible(item: IndexedTitle, opts: PickOptions) {
  if (!opts.adultOk && item.adult) return false;
  if (opts.usOnly && !item.us) return false;
  if (opts.genre && !(item.g || '').includes('|' + opts.genre + '|')) return false;
  return true;
}

/** Walks indices from cursor and returns up to limit visible titles, one per TMDB title. */
export function pickTitles(items: IndexedTitle[], indices: number[] | undefined | null, opts: PickOptions, cursor: number, limit: number) {
  const picked: number[] = [], list = indices || [], seen = opts.seen || (opts.seen = new Set());
  let i = cursor;
  while (i < list.length && picked.length < limit) {
    const index = list[i++];
    const item = items[index];
    if (!item || !titleVisible(item, opts)) continue;
    const seenKey = item.tmdb ? 'tmdb:' + item.tmdb : item.key;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    picked.push(index);
  }
  return {picked, cursor: i};
}

/** Lower case without accents ("Amélie" -> "amelie"), so a search finds a title however its accents are typed. */
export function foldText(text: string) {
  const lower = text.toLowerCase();
  return /[^\x00-\x7f]/.test(lower) ? lower.normalize('NFD').replace(/\p{M}/gu, '') : lower;
}

/** Search: up to limit visible titles whose names contain query (ignoring case and accents), names starting with it first. */
export function searchTitles(items: IndexedTitle[], query: string, opts: PickOptions, limit: number) {
  const text = foldText(query.trim());
  if (text.length < 2) return [];
  const starts: number[] = [], contains: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const position = foldText(items[i].name).indexOf(text);
    if (position < 0 || !titleVisible(items[i], opts)) continue;
    if (position === 0) {
      starts.push(i);
      if (starts.length >= limit) break;
    } else if (contains.length < limit) contains.push(i);
  }
  return pickTitles(items, [...starts, ...contains], {...opts, seen: new Set()}, 0, limit).picked;
}

export type RowSpec = {type: MediaType; list: ListKey; title: string};

/** Home rows after Continue watching, in the order docs/browse.md gives. Popular and Featured need TMDB. */
export function homeRowSpecs(withTmdb: boolean): RowSpec[] {
  const specs: RowSpec[] = [];
  if (withTmdb) {
    specs.push({type: 'movies', list: 'popular', title: 'Popular – Movies'}, {type: 'series', list: 'popular', title: 'Popular – Series'});
    specs.push({type: 'movies', list: 'featured', title: 'Featured – Movies'}, {type: 'series', list: 'featured', title: 'Featured – Series'});
  }
  for (const service of browseServices()) {
    specs.push({type: 'movies', list: service.key, title: service.name + ' – Movies'}, {type: 'series', list: service.key, title: service.name + ' – Series'});
  }
  specs.push({type: 'movies', list: 'recent', title: 'Recently added – Movies'}, {type: 'series', list: 'recent', title: 'Recently added – Series'});
  specs.push({type: 'movies', list: 'rated', title: 'Top rated – Movies'}, {type: 'series', list: 'rated', title: 'Top rated – Series'});
  return specs;
}

/** Discover's List choices. Popular and Featured need TMDB. */
export function discoverLists(withTmdb: boolean): {key: ListKey; name: string}[] {
  const lists: {key: ListKey; name: string}[] = [];
  if (withTmdb) lists.push({key: 'popular', name: 'Popular'}, {key: 'featured', name: 'Featured'});
  lists.push({key: 'rated', name: 'Top rated'}, {key: 'recent', name: 'Recently added'}, {key: 'az', name: 'A–Z'});
  for (const service of browseServices()) lists.push({key: service.key, name: service.name});
  return lists;
}

export type TitleRef = {type: MediaType; idx: number};
export type Catalog = {movies: TitleSection; series: TitleSection};
export type HomeRow = {id: string; title: string; type: MediaType | 'library'; list: ListKey | 'continue'; refs: TitleRef[]};

/** Home: Continue watching (refs from continueRefs) and then every row with at least 5 titles, 20 at most. */
export function buildHomeRows(catalog: Catalog, withTmdb: boolean, opts: PickOptions, continueRefs: TitleRef[]): HomeRow[] {
  const rows: HomeRow[] = [];
  if (continueRefs.length >= 5) rows.push({id: 'continue', title: 'Continue watching', type: 'library', list: 'continue', refs: continueRefs.slice(0, 20)});
  for (const spec of homeRowSpecs(withTmdb)) {
    const section = catalog[spec.type];
    const result = pickTitles(section.items, section.lists[spec.list], {usOnly: opts.usOnly, adultOk: opts.adultOk, genre: '', seen: new Set()}, 0, 20);
    if (result.picked.length >= 5) rows.push({id: spec.type + ':' + spec.list, title: spec.title, type: spec.type, list: spec.list, refs: result.picked.map(idx => ({type: spec.type, idx}))});
  }
  return rows;
}

// ------------------------------------------------------------------ Library (favorites, progress, history)

/**
 * Stored per line in this browser (app/watch/use-library.ts), in the same shape as on Roku.
 *   fav:  [key], newest first.
 *   prog: [{k, p (seconds), d (duration), t (time), e (episode id), l (episode label), n (episode index), nx}],
 *         newest first; nx marks "the next episode is ready" after one finishes.
 *   seen: [{k, t}], newest first.
 */
export type ProgressEntry = {k: string; p: number; d: number; t?: number; e?: string; l?: string; n?: number; nx?: boolean};
export type Library = {v: 1; line: string; fav: string[]; prog: ProgressEntry[]; seen: {k: string; t: number}[]};
export const LIBRARY_KEY = /^[ms](?:\d{1,10}|~[A-Za-z0-9_-]{20,64})$/;
export const FAVORITES_MAX = 150;
export const PROGRESS_MAX = 30;
export const SEEN_MAX = 30;

export function libraryNew(line: string): Library {
  return {v: 1, line, fav: [], prog: [], seen: []};
}

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
function progressEntry(raw: unknown): ProgressEntry | null {
  if (!isRecord(raw) || typeof raw.k !== 'string' || !LIBRARY_KEY.test(raw.k)) return null;
  const entry: ProgressEntry = {k: raw.k, p: Math.max(0, finite(raw.p)), d: Math.max(0, finite(raw.d))};
  if (finite(raw.t)) entry.t = finite(raw.t);
  if (typeof raw.e === 'string' && XTREAM_ID.test(raw.e)) entry.e = raw.e;
  if (typeof raw.l === 'string') entry.l = raw.l.slice(0, 60);
  if (finite(raw.n)) entry.n = finite(raw.n);
  if (raw.nx === true) entry.nx = true;
  return entry;
}

/** A stored library for this line, or a new one when it is missing, damaged or for another line. */
export function libraryFor(stored: unknown, line: string): Library {
  if (!isRecord(stored) || asText(stored.line) !== line) return libraryNew(line);
  const fav = arrayOrEmpty(stored.fav).filter((key): key is string => typeof key === 'string' && LIBRARY_KEY.test(key)).slice(0, FAVORITES_MAX);
  const prog = arrayOrEmpty(stored.prog).map(progressEntry).filter((entry): entry is ProgressEntry => Boolean(entry)).slice(0, PROGRESS_MAX);
  const seen = arrayOrEmpty(stored.seen).filter((entry): entry is {k: string; t: number} => isRecord(entry) && typeof entry.k === 'string' && LIBRARY_KEY.test(entry.k))
    .map(entry => ({k: entry.k, t: finite(entry.t)})).slice(0, SEEN_MAX);
  return {v: 1, line, fav, prog, seen};
}

export const libraryTypeOf = (key: string): MediaType => key.startsWith('s') ? 'series' : 'movies';
export const libraryIsFavorite = (store: Library, key: string) => store.fav.includes(key);
export const libraryProgress = (store: Library, key: string) => store.prog.find(entry => entry.k === key) || null;
export const libraryKeys = (entries: {k: string}[]) => entries.map(entry => entry.k);

/** Adds or removes a favorite (newest first, at most 150). */
export function libraryToggleFavorite(store: Library, key: string): {library: Library; favorite: boolean} {
  if (store.fav.includes(key)) return {library: {...store, fav: store.fav.filter(item => item !== key)}, favorite: false};
  return {library: {...store, fav: [key, ...store.fav].slice(0, FAVORITES_MAX)}, favorite: true};
}

export function libraryRemoveProgress(store: Library, key: string): Library {
  return {...store, prog: store.prog.filter(entry => entry.k !== key)};
}

/**
 * Records where playback stopped. A finished title (95% or more) leaves Continue watching; a stop in the first 15
 * seconds changes nothing; a "next episode" entry (nx) is always kept. At most 30 entries.
 */
export function libraryRecordProgress(store: Library, entry: ProgressEntry, now: number): Library {
  const position = Math.floor(finite(entry.p)), duration = Math.floor(finite(entry.d));
  const nextUp = entry.nx === true;
  if (!nextUp && duration > 0 && position >= duration * 0.95) return libraryRemoveProgress(store, entry.k);
  if (!nextUp && position < 15) return store;
  const recorded: ProgressEntry = {...entry, p: position, d: duration, t: now};
  return {...store, prog: [recorded, ...store.prog.filter(item => item.k !== entry.k)].slice(0, PROGRESS_MAX)};
}

export function libraryRecordWatched(store: Library, key: string, now: number): Library {
  return {...store, seen: [{k: key, t: now}, ...store.seen.filter(entry => entry.k !== key)].slice(0, SEEN_MAX)};
}

/** How far through a title is, 0 to 1, for the progress bar. */
export function progressFraction(entry: ProgressEntry | null | undefined) {
  if (!entry || entry.nx) return 0;
  const duration = finite(entry.d);
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, finite(entry.p) / duration));
}

/** Library keys as refs to visible titles in the catalogue (titles no longer on the line drop out). */
export function libraryRefs(keys: string[], catalog: Catalog, opts: PickOptions): TitleRef[] {
  const refs: TitleRef[] = [];
  for (const key of keys) {
    const type = libraryTypeOf(key);
    const index = catalog[type].byKey.get(key);
    if (index !== undefined && titleVisible(catalog[type].items[index], opts)) refs.push({type, idx: index});
  }
  return refs;
}

/** "1:02:03" or "12:34". */
export function clockText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds) || 0);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
