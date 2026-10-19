'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  buildTitleSection, buildTitleSectionAsync, emptyRowsSection, parseRowsPayload, titleFromCompact, titleFromM3u, type BrowseTitle, type Catalog, type CategoryInput,
  type CompactCategory, type CompactTitle, type RowsPayload,
} from '../../lib/browse';
import {groupPlaylistSeries, type LocalSeries, type PlaylistEntry} from './local-series';
import {NO_POSTERS, tmdbPosters, type PosterSources} from './poster-choice';
import {registerLocalSeries} from './title-details';

// The line's movies and series for browsing: GET /api/player/vod (the line's catalogue, or "none") and the public
// popularity rows (GET /api/catalog/rows?v=1), built into the browse index here in the browser, in slices so a TV
// browser stays responsive. Without an Xtream catalogue, the movie and series entries of the channel list are used
// (series entries named "Show SxxEyy" grouped into one series per show, local-series.ts).

export type Channel = {id: string; name: string; group: string; format: 'hls' | 'mpegts' | 'file'; token: string | null; reason: string; kind?: 'live' | 'movie' | 'series'; ext?: string; logo?: string};
type VodSection = {categories?: CompactCategory[]; items?: CompactTitle[]; truncated?: boolean};
type VodResponse = {v?: number; source?: string; reason?: string; generated?: string; posterBases?: string[]; movies?: VodSection; series?: VodSection; error?: {code?: string; message?: string}};

export type CatalogueState = {
  /** The line this state belongs to. */
  user: string;
  status: 'idle' | 'loading' | 'ready';
  catalog: Catalog | null;
  /** Where the titles came from: the line's Xtream catalogue, its M3U playlist, or nowhere. */
  source: 'xtream' | 'm3u' | 'none';
  /** The catalogue's sealed poster bases and the rows' TMDB posters (poster-choice.ts). */
  posters: PosterSources;
  /** TMDB lists are in use (Popular and Featured, and the TMDB notice). */
  withTmdb: boolean;
  /** A problem loading the line's catalogue, shown with Try again. */
  error: string;
  truncated: boolean;
  count: number;
};

const ROWS_KEY = 'lumanest_catalog_rows_v1';
const EMPTY: CatalogueState = {user: '', status: 'idle', catalog: null, source: 'none', posters: NO_POSTERS, withTmdb: false, error: '', truncated: false, count: 0};

/**
 * The rows endpoint's answer, or, when it fails, the last good copy this browser kept, however old (docs/browse.md:
 * a stale copy is better than the fallbacks). A deliberate "none" answer (no TMDB) removes the copy.
 */
async function loadRows(signal: AbortSignal): Promise<RowsPayload> {
  let saved: {fetchedAt?: number; body?: string} | null = null;
  try {saved = JSON.parse(localStorage.getItem(ROWS_KEY) || 'null');} catch {saved = null;}
  const fallback = () => typeof saved?.body === 'string' ? parseRowsPayload(saved.body) : parseRowsPayload(null);
  try {
    const response = await fetch('/api/catalog/rows?v=1', {signal});
    if (!response.ok) {await response.body?.cancel().catch(() => {}); return fallback();}
    const body = await response.text();
    const rows = parseRowsPayload(body);
    if (!rows.valid) return fallback();
    try {
      if (rows.source === 'tmdb' && body.length <= 1024 * 1024) localStorage.setItem(ROWS_KEY, JSON.stringify({fetchedAt: Date.now(), body}));
      else if (rows.source !== 'tmdb') localStorage.removeItem(ROWS_KEY);
    } catch {}
    return rows;
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback();
  }
}

/** Hands the thread back between slices: the browser can paint and take a key press. */
const pause = () => new Promise<void>(resolve => {
  const scheduler = (globalThis as {scheduler?: {yield?: () => Promise<void>}}).scheduler;
  if (typeof scheduler?.yield === 'function') void scheduler.yield().then(resolve, () => setTimeout(resolve, 0));
  else setTimeout(resolve, 0);
});

export function useCatalogue({username, channels, channelBases, onSignedOut}: {username: string; channels: Channel[]; channelBases: string[]; onSignedOut: (message: string) => void}) {
  const [state, setState] = useState<CatalogueState>(EMPTY);
  const [vod, setVod] = useState<{data: VodResponse | null; error: string; user: string} | null>(null);
  const [rows, setRows] = useState<RowsPayload | null>(null);
  const [attempt, setAttempt] = useState(0);
  const signedOut = useRef(onSignedOut);
  useEffect(() => {signedOut.current = onSignedOut;});
  const retries = useRef(0);

  // 1. Fetch the line's catalogue and the popularity rows.
  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState(current => current.user === username ? {...current, error: ''} : {...EMPTY, user: username, status: 'loading'});
      const rowsJob = loadRows(controller.signal).catch(() => parseRowsPayload(null));
      let data: VodResponse | null = null, error = '';
      try {
        const response = await fetch('/api/player/vod?v=1', {cache: 'no-store', signal: controller.signal});
        const text = await response.text();
        const parsing = performance.now();
        try {data = JSON.parse(text) as VodResponse;} catch {data = null;}
        try {performance.measure('lumanest-catalogue-parse', {start: parsing, detail: {bytes: text.length}});} catch {}
        if (!response.ok) {
          const code = data?.error?.code || '';
          if (response.status === 401 && code.startsWith('player_')) {signedOut.current(code === 'player_login_required' ? '' : data?.error?.message || ''); return;}
          // Busy or slow: try again by itself after the server's Retry-After, a few times.
          const wait = Number(response.headers.get('Retry-After'));
          if ((code === 'vod_busy' || code === 'vod_timeout') && retries.current < 3) {
            retries.current++;
            timer = setTimeout(() => setAttempt(value => value + 1), Math.min(30, Number.isFinite(wait) && wait > 0 ? wait : 10) * 1000);
          }
          error = data?.error?.message || 'Movies and series could not be loaded. Please try again.';
          data = null;
        } else retries.current = 0;
      } catch {
        if (controller.signal.aborted) return;
        error = 'Movies and series could not be loaded. Check your connection and try again.';
      }
      const loadedRows = await rowsJob;
      if (controller.signal.aborted) return;
      setRows(loadedRows);
      setVod({data, error, user: username});
    })();
    return () => {controller.abort(); clearTimeout(timer);};
  }, [username, attempt]);

  // The channel list's movie and series entries, by what they are (a refresh with the same entries changes nothing).
  const m3uSignature = useMemo(() => channels.filter(channel => channel.kind === 'movie' || channel.kind === 'series').map(channel => channel.id + (channel.token ? '' : '!')).join(','), [channels]);
  const channelsRef = useRef(channels);
  const basesRef = useRef(channelBases);
  useEffect(() => {channelsRef.current = channels; basesRef.current = channelBases;});

  // 2. Build the browse index.
  useEffect(() => {
    if (!vod || !rows || vod.user !== username) return;
    let cancelled = false;
    void (async () => {
      const xtream = vod.data?.source === 'xtream';
      try {
        const movies: BrowseTitle[] = [];
        let series: BrowseTitle[] = [], local: LocalSeries[] = [];
        const categories: {movies: CategoryInput[]; series: CategoryInput[]} = {movies: [], series: []};
        let bases: string[];
        if (xtream) {
          for (const item of vod.data?.movies?.items || []) movies.push(titleFromCompact('movie', item));
          for (const item of vod.data?.series?.items || []) series.push(titleFromCompact('series', item));
          categories.movies = vod.data?.movies?.categories || [];
          categories.series = vod.data?.series?.categories || [];
          bases = vod.data?.posterBases || [];
        } else {
          const groups = {movies: new Set<string>(), series: new Set<string>()};
          const episodes: PlaylistEntry[] = [];
          for (const channel of channelsRef.current) {
            if (!channel.token || (channel.kind !== 'movie' && channel.kind !== 'series')) continue;
            const type = channel.kind === 'movie' ? 'movies' : 'series';
            if (type === 'movies') movies.push(titleFromM3u('movie', channel.id, channel.name, channel.logo || '', channel.group, channel.ext || ''));
            else episodes.push({id: channel.id, name: channel.name, group: channel.group, logo: channel.logo || '', ext: channel.ext || ''});
            if (!groups[type].has(channel.group)) {groups[type].add(channel.group); categories[type].push({id: channel.group, name: channel.group});}
          }
          ({titles: series, series: local} = groupPlaylistSeries(episodes));
          bases = basesRef.current;
        }
        await pause();
        if (cancelled) return;
        // Visible in the browser's performance tools (and the walkthrough): how long the index took to build.
        const started = performance.now();
        const movieSection = await buildTitleSectionAsync(movies, categories.movies, rows.movie, rows.genres.movie, pause);
        if (cancelled) return;
        const seriesSection = await buildTitleSectionAsync(series, categories.series, rows.tv, rows.genres.tv, pause);
        if (cancelled) return;
        const count = movieSection.items.length + seriesSection.items.length;
        try {performance.measure('lumanest-catalogue-build', {start: started, detail: {titles: count}});} catch {}
        registerLocalSeries(local);
        setState({
          user: username, status: 'ready', catalog: {movies: movieSection, series: seriesSection}, source: count ? (xtream ? 'xtream' : 'm3u') : 'none', posters: {bases, tmdb: tmdbPosters(rows)},
          withTmdb: rows.valid && rows.source === 'tmdb', error: vod.error, truncated: Boolean(vod.data?.movies?.truncated || vod.data?.series?.truncated), count,
        });
      } catch {
        // A catalogue that can't be indexed must not leave Home loading for ever: no titles, and Try again.
        if (cancelled) return;
        const empty = () => buildTitleSection([], [], emptyRowsSection(), []);
        setState({
          user: username, status: 'ready', catalog: {movies: empty(), series: empty()}, source: 'none', posters: NO_POSTERS, withTmdb: false,
          error: 'Movies and series could not be prepared in this browser. Please try again.', truncated: false, count: 0,
        });
      }
    })();
    return () => {cancelled = true;};
  }, [vod, rows, username, m3uSignature]);

  const retry = useCallback(() => {retries.current = 0; setAttempt(value => value + 1);}, []);

  /** "Refresh movies & series": asks the server for a fresh copy (at most once per 5 minutes). Returns a message. */
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/player/vod?v=1&refresh=1', {cache: 'no-store'});
      const data = await response.json().catch(() => null) as VodResponse | null;
      if (!response.ok) return data?.error?.message || 'Movies and series could not be refreshed. Please try again later.';
      setVod({data, error: '', user: username});
      return response.headers.get('X-Vod-Stale') ? 'Your line’s catalogue could not be reached, so the last copy is shown.' : 'Movies and series are up to date.';
    } catch {return 'Movies and series could not be refreshed. Check your connection.';}
  }, [username]);

  return {state: username && state.user === username ? state : {...EMPTY, user: username, status: username ? 'loading' as const : 'idle' as const}, retry, refresh};
}
