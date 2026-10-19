// Which picture a title's poster shows (docs/browse.md "Web player"), in this order:
//   1. TMDB's poster, when the title is matched to a TMDB title of GET /api/catalog/rows?v=1 that has one: loaded
//      straight from TMDB's image CDN (https://image.tmdb.org/t/p/w342/…), which is free and cached there.
//   2. The line's own poster: a direct https link (TMDB's image host), or "~<base>:<file>" through /api/player/image
//      for a provider host or the line's catalogue image host (lib/player-vod-data.ts createPosterBook; on the
//      catalogue image host <file> is "<path>!<tag>", passed on as it is).
//   3. Nothing: the initials card (poster.tsx TitleCard).
// The picture shown falls back down the list when one fails to load (poster.tsx PosterArt). Pure, so tests run it.
import type {RowsPayload, RowsSection} from '../../lib/browse.ts';
import {TMDB_POSTER_PATH} from '../../lib/catalog.ts';

/** TMDB's poster size for the web player's cards and details (342 px wide, about 2x a 170 px card). */
export const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

/** TMDB poster paths ("/abc.jpg") by TMDB id, for movies (the rows' movie lists) and series (the tv lists). */
export type TmdbPosters = {movies: ReadonlyMap<string, string>; series: ReadonlyMap<string, string>};
/** Where a card's poster can come from: the catalogue's sealed poster bases, and TMDB's poster paths. */
export type PosterSources = {bases: string[]; tmdb: TmdbPosters};
export const NO_POSTERS: PosterSources = {bases: [], tmdb: {movies: new Map(), series: new Map()}};

const LISTS = ['popular', 'featured', 'top_rated'] as const;

function sectionPosters(section: RowsSection): Map<string, string> {
  const posters = new Map<string, string>();
  for (const list of [...LISTS.map(name => section[name]), ...Object.values(section.services)]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const {id, poster} = raw as {id?: unknown; poster?: unknown};
      const key = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : typeof id === 'string' && /^\d{1,12}$/.test(id) ? id : '';
      // Checked again here: a copy kept in this browser may come from anywhere.
      if (key && !posters.has(key) && typeof poster === 'string' && TMDB_POSTER_PATH.test(poster)) posters.set(key, poster);
    }
  }
  return posters;
}

/** Every TMDB poster path in the rows (none without TMDB data). */
export function tmdbPosters(rows: RowsPayload | null): TmdbPosters {
  if (!rows?.valid || rows.source !== 'tmdb') return NO_POSTERS.tmdb;
  return {movies: sectionPosters(rows.movie), series: sectionPosters(rows.tv)};
}

/**
 * A catalogue poster's address for an <img>: a direct https URL as it is, or "~<base>:<file>" through
 * /api/player/image with the sealed base the catalogue sent (the file part, tag included, as it is). '' when there is
 * none.
 */
export function providerPosterSrc(poster: string, bases: string[]) {
  if (!poster) return '';
  if (poster.startsWith('https://')) return poster;
  const match = /^~(\d{1,5}):(.*)$/.exec(poster);
  const base = match ? bases[Number(match[1])] : undefined;
  return base ? '/api/player/image?t=' + encodeURIComponent(base) + '&f=' + encodeURIComponent(match![2]) : '';
}

/**
 * The pictures to try for a title, best first (see the top of this file); [] means the initials card. key decides
 * movies or series ("s…" is a series); tmdb is the matched TMDB id ('' when unmatched). detailsPoster: a series'
 * cover from its details, after TMDB's poster and before the catalogue's.
 */
export function posterChoices(title: {key: string; tmdb: string; poster: string}, sources: PosterSources, detailsPoster = ''): string[] {
  const choices: string[] = [];
  const path = title.tmdb ? (title.key.startsWith('s') ? sources.tmdb.series : sources.tmdb.movies).get(title.tmdb) : undefined;
  if (path) choices.push(TMDB_POSTER_BASE + path);
  if (detailsPoster) choices.push(detailsPoster);
  const own = providerPosterSrc(title.poster, sources.bases);
  if (own) choices.push(own);
  return [...new Set(choices)];
}

/** The picture to show now: the first of srcs that hasn't failed to load, or undefined for the initials card. */
export function shownPoster(srcs: readonly string[], failed: readonly string[]): string | undefined {
  return srcs.find(src => src && !failed.includes(src));
}

/** The failed pictures once src has failed to load too (unchanged when it is already there). */
export function posterFailed(failed: readonly string[], src: string): readonly string[] {
  return failed.includes(src) ? failed : [...failed, src];
}
