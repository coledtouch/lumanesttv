// Which screen of the web player is showing, kept in the address (/watch?view=…) so the browser's, a phone's and a TV
// remote's Back button all step back through it. Pure: parsing and building only (use-watch-route.ts does history).
import {LIBRARY_KEY, SERVICES, type ListKey, type MediaType} from '../../lib/browse.ts';

export type View = 'home' | 'live' | 'discover' | 'library' | 'search' | 'settings' | 'title' | 'play';
export type Route =
  | {view: 'home' | 'live' | 'library' | 'settings'}
  | {view: 'discover'; type: MediaType; list: ListKey; genre: string}
  | {view: 'search'; q: string}
  | {view: 'title'; key: string}
  | {view: 'play'; key: string; ep?: string};
/** What the line offers: any movies or series at all, and TMDB lists (Popular, Featured). */
export type RouteCaps = {titles: boolean; tmdb: boolean};
export type StartView = 'home' | 'live';

export const LISTS: readonly ListKey[] = ['popular', 'featured', 'rated', 'recent', 'az', ...SERVICES];
/** A genre key: TMDB's number, or a provider genre's name in any language ("Comédie", "Children's", "Sci-Fi & Fantasy"). */
const GENRE = /^[\p{L}\p{N}][\p{L}\p{N} &+'’.-]{0,39}$/u;
/** An Xtream episode id, or an M3U episode's channel id. */
const EPISODE = /^(?:\d{1,10}|[A-Za-z0-9_-]{20,64})$/;
/** Views that need movies or series. */
const BROWSE_VIEWS = new Set<View>(['home', 'discover', 'library', 'title', 'play']);

/** The route named by an address's query, or null when it names none (the start view applies). */
export function parseRoute(search: string): Route | null {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  switch (view) {
    case 'home': case 'live': case 'library': case 'settings': return {view};
    case 'discover': {
      const type = params.get('type') === 'series' ? 'series' : 'movies';
      const list = params.get('list') as ListKey | null;
      const genre = params.get('genre') || '';
      return {view, type, list: list && LISTS.includes(list) ? list : 'popular', genre: GENRE.test(genre) ? genre : ''};
    }
    case 'search': return {view, q: (params.get('q') || '').slice(0, 100)};
    case 'title': case 'play': {
      const key = params.get('title') || '';
      if (!LIBRARY_KEY.test(key)) return null;
      const ep = params.get('ep') || '';
      return view === 'play' && EPISODE.test(ep) ? {view, key, ep} : {view, key};
    }
    default: return null;
  }
}

export function startRoute(caps: RouteCaps, start: StartView): Route {
  return caps.titles && start === 'home' ? {view: 'home'} : {view: 'live'};
}

/**
 * A route the line can show: browse views fall back to the start view when there are no titles, and Popular or
 * Featured fall back to Top rated without TMDB.
 */
export function normalizeRoute(route: Route | null, caps: RouteCaps, start: StartView): Route {
  if (!route) return startRoute(caps, start);
  if (BROWSE_VIEWS.has(route.view) && !caps.titles) return startRoute(caps, start);
  if (route.view === 'discover' && !caps.tmdb && (route.list === 'popular' || route.list === 'featured')) return {...route, list: 'rated'};
  return route;
}

export function routeHref(route: Route): string {
  const params = new URLSearchParams({view: route.view});
  if (route.view === 'discover') {
    params.set('type', route.type);
    params.set('list', route.list);
    if (route.genre) params.set('genre', route.genre);
  } else if (route.view === 'search') {
    if (route.q) params.set('q', route.q);
  } else if (route.view === 'title' || route.view === 'play') {
    params.set('title', route.key);
    if (route.view === 'play' && route.ep) params.set('ep', route.ep);
  }
  return '/watch?' + params.toString();
}

export const sameRoute = (a: Route | null, b: Route | null) => Boolean(a && b) && routeHref(a!) === routeHref(b!);

/** Where a row's See all leads: Discover with its type and list, or the Library for Continue watching. */
export function seeAllRoute(row: {type: MediaType | 'library'; list: ListKey | 'continue'}): Route {
  if (row.type === 'library' || row.list === 'continue') return {view: 'library'};
  return {view: 'discover', type: row.type, list: row.list, genre: ''};
}

export type Section = 'home' | 'live' | 'discover' | 'library' | 'search' | 'settings';
/** The section a screen belongs to by itself: a title or the player belong to Home unless opened elsewhere. */
export function baseSection(route: Route): Section {
  if (route.view === 'title' || route.view === 'play') return 'home';
  return route.view;
}
/** The section the navigation highlights for a route; `from` is the section a title was opened from. */
export function sectionOf(route: Route, from: Section | '' = ''): Section {
  if ((route.view === 'title' || route.view === 'play') && from) return from;
  return baseSection(route);
}

const VIEW_NAMES: Record<View, string> = {home: 'Home', live: 'Live TV', discover: 'Discover', library: 'Library', search: 'Search', settings: 'Settings', title: 'Details', play: 'Playing'};
/** A short spoken name for a screen ("Discover: Movies, Popular"), for screen readers after a change. */
export function routeLabel(route: Route, listName?: string) {
  if (route.view === 'discover') return `Discover: ${route.type === 'series' ? 'Series' : 'Movies'}${listName ? ', ' + listName : ''}`;
  return VIEW_NAMES[route.view];
}

/** A poster's focus key: its row (or grid) and title, so Back focuses the poster chosen even when the title is in several rows. */
export const posterFocusKey = (scope: string, key: string) => 'title:' + scope + ':' + key;
