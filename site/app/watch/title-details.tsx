'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Check, Play, Plus, RotateCcw} from 'lucide-react';
import {clockText, libraryProgress, type IndexedTitle, type Library} from '../../lib/browse';
import type {MovieInfo, SeasonInfo} from '../../lib/player-vod-data';
import type {Episode, LocalSeries} from './local-series';
import FilterMenu from './filter-menu';
import {PosterArt, posterSrc} from './poster';
import {MAYBE_MESSAGE, TUNER_MESSAGE, vodPlan} from './vod-format';
import {focusElement, keysMode} from './use-spatial-navigation';

// A movie's or series' details: poster, facts, plot, Play or Resume, Library, and a series' seasons and episodes.
// Details come from /api/player/vod/movie and /api/player/vod/series (Xtream lines) and are kept for this page load.
// A series made of an M3U playlist's episode entries has its episodes listed locally (registerLocalSeries).

export type {Episode} from './local-series';
type SeriesData = {plot: string; year: string; genre: string; rating: number; poster: string; seasons: SeasonInfo[]; episodes: Episode[]};
type Loaded<T> = {status: 'loading' | 'ready' | 'error'; data?: T; message?: string};

const seriesCache = new Map<string, Loaded<SeriesData>>();
const movieCache = new Map<string, Loaded<MovieInfo>>();
const listeners = new Set<() => void>();
export function clearDetails() {seriesCache.clear(); movieCache.clear();}

/** Lists the episodes of series made from the playlist (they have no Xtream details to load). */
export function registerLocalSeries(list: LocalSeries[]) {
  for (const key of [...seriesCache.keys()]) if (key.startsWith('s~')) seriesCache.delete(key);
  for (const series of list) seriesCache.set(series.key, {status: 'ready', data: {plot: '', year: '', genre: '', rating: 0, poster: '', seasons: series.seasons, episodes: series.episodes}});
  for (const listener of listeners) listener();
}

/** "Dune (2021)" already says 2021: the year is not repeated beside it. */
export function yearShown(name: string, year: string | undefined) {
  return year && !name.includes(year) ? year : '';
}

/** A series' episodes in season and episode order, once loaded (the player needs them for Next episode). */
export function seriesEpisodes(key: string): Episode[] | null {
  return seriesCache.get(key)?.data?.episodes || null;
}

async function loadDetails(title: IndexedTitle) {
  const series = title.kind === 'series';
  const cache = series ? seriesCache : movieCache;
  const current = cache.get(title.key);
  if (current && current.status !== 'error') return;
  cache.set(title.key, {status: 'loading'});
  const notify = () => {for (const listener of listeners) listener();};
  notify();
  try {
    const response = await fetch('/api/player/vod/' + (series ? 'series' : 'movie') + '?id=' + encodeURIComponent(title.id), {cache: 'no-store'});
    const data = await response.json().catch(() => null) as (SeriesData & MovieInfo & {posterBases?: string[]; error?: {message?: string}}) | null;
    if (!response.ok || !data) throw new Error(data?.error?.message || 'Details could not be loaded.');
    if (series) {
      const episodes: Episode[] = [];
      for (const season of data.seasons || []) for (const episode of season.episodes) episodes.push({...episode, season: season.season, label: `S${season.season} E${episode.episode}`, index: episodes.length});
      seriesCache.set(title.key, {status: 'ready', data: {plot: data.plot, year: data.year, genre: data.genre, rating: data.rating, poster: posterSrc(data.poster || '', data.posterBases || []), seasons: data.seasons || [], episodes}});
    } else movieCache.set(title.key, {status: 'ready', data});
  } catch (error) {
    cache.set(title.key, {status: 'error', message: error instanceof Error ? error.message : 'Details could not be loaded.'});
  }
  notify();
}

/** Loads a title's details (Xtream titles only; M3U titles have none) and re-renders when they arrive. */
export function useDetails(title: IndexedTitle | null) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion(value => value + 1);
    listeners.add(listener);
    return () => {listeners.delete(listener);};
  }, []);
  useEffect(() => {
    if (!title || !title.id || title.kind === 'episode') return;
    void loadDetails(title);
  }, [title]);
  if (!title) return {series: undefined, movie: undefined};
  if (!title.id) return {series: title.kind === 'series' ? seriesCache.get(title.key) : undefined, movie: undefined};
  return {series: title.kind === 'series' ? seriesCache.get(title.key) : undefined, movie: title.kind === 'movie' ? movieCache.get(title.key) : undefined};
}

export function retryDetails(title: IndexedTitle) {void loadDetails(title);}

const canPlay = (type: string) => {
  try {return document.createElement('video').canPlayType(type);} catch {return '';}
};
const minutes = (seconds?: number) => seconds ? Math.round(seconds / 60) + ' min' : '';

export type PlayRequest = {episode?: Episode; startOver?: boolean; tryAnyway?: boolean};

/** The note shown for a title in a format browsers can't play (no Play) or may not play (Try anyway). */
function FormatNote({mode}: {mode: 'tuner' | 'maybe'}) {
  return <div className={'vod-format-note ' + mode} role="note">
    <p>{mode === 'tuner' ? TUNER_MESSAGE : MAYBE_MESSAGE}</p>
    <a className="small-button" href="/apps">Get the Tuner app ↗</a>
  </div>;
}

export function TitleDetails({title, library, bases, onPlay, onToggleFavorite, busy, error}: {
  title: IndexedTitle; library: Library; bases: string[]; onPlay: (request: PlayRequest) => void; onToggleFavorite: () => void; busy: boolean; error: string;
}) {
  const details = useDetails(title);
  const series = details.series?.data;
  const movie = details.movie?.data;
  const favorite = library.fav.includes(title.key);
  const progress = libraryProgress(library, title.key);
  const episodes = useMemo(() => series?.episodes || [], [series]);
  const progressEpisode = progress?.e ? episodes.find(episode => episode.id === progress.e) : undefined;
  const [season, setSeason] = useState<number | null>(null);
  const seasonShown = season ?? progressEpisode?.season ?? series?.seasons[0]?.season ?? 0;
  const seasonEpisodes = episodes.filter(episode => episode.season === seasonShown);
  const src = series?.poster || posterSrc(title.poster, bases);
  const facts = [yearShown(title.name, title.year || series?.year), movie?.duration ? minutes(movie.duration) : '', (title.rating || movie?.rating || series?.rating) ? '★ ' + (title.rating || movie?.rating || series?.rating) : '', movie?.genre || series?.genre].filter(Boolean);
  const plot = movie?.plot || series?.plot || '';

  // What Play does: a movie or M3U entry plays itself; a series resumes its episode, plays the next one, or starts at S1 E1.
  let primary: {label: string; request: PlayRequest; episode?: Episode} | null = null;
  let startOver: PlayRequest | null = null;
  let mode: ReturnType<typeof vodPlan>['mode'];
  if (title.kind === 'series') {
    const target = progressEpisode || episodes[0];
    mode = target ? vodPlan(target.ext, canPlay).mode : 'file';
    if (target && progressEpisode && progress?.nx) primary = {label: 'Play next: ' + target.label, request: {episode: target}, episode: target};
    else if (target && progressEpisode && progress && progress.p >= 15) {
      primary = {label: `Resume ${target.label} from ${clockText(progress.p)}`, request: {episode: target}, episode: target};
      startOver = {episode: target, startOver: true};
    } else if (target) primary = {label: 'Play ' + target.label, request: {episode: target}, episode: target};
  } else {
    mode = vodPlan(title.ext, canPlay).mode;
    if (progress && progress.p >= 15) {
      primary = {label: 'Resume from ' + clockText(progress.p), request: {}};
      startOver = {startOver: true};
    } else primary = {label: 'Play', request: {}};
  }
  if (mode === 'tuner') {primary = null; startOver = null;}
  if (mode === 'maybe' && primary) primary = {...primary, label: primary.label.replace(/^Play\b/, 'Try playing'), request: {...primary.request, tryAnyway: true}};
  if (mode === 'maybe' && startOver) startOver = {...startOver, tryAnyway: true};

  // A series' Play appears once its episodes have loaded. With keys, focus that had to land elsewhere meanwhile (Add
  // to Library, or nowhere) moves to it, so Enter plays rather than adds the series to the Library.
  const playButton = useRef<HTMLButtonElement>(null);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const hasPrimary = Boolean(primary);
  const primaryShown = useRef(hasPrimary);
  useEffect(() => {
    if (!hasPrimary || primaryShown.current) return;
    primaryShown.current = true;
    const active = document.activeElement;
    if (playButton.current && keysMode() && (!active || active === document.body || active === libraryButton.current)) focusElement(playButton.current);
  }, [hasPrimary]);
  // While a title starts, its buttons stay focusable (aria-disabled), so a failure leaves focus where it was.
  const guard = (action: () => void) => () => {if (!busy) action();};

  return <article className="watch-browse title-details" aria-labelledby="title-name">
    <div className="title-hero">
      <div className="title-poster"><PosterArt src={src} name={title.name} eager/></div>
      <div className="title-info">
        <p className="eyebrow">{title.kind === 'movie' ? 'MOVIE' : title.kind === 'series' ? 'SERIES' : 'EPISODE'}</p>
        <h1 id="title-name">{title.name}</h1>
        {facts.length > 0 && <p className="title-facts">{facts.map(fact => <span key={String(fact)}>{fact}</span>)}</p>}
        {plot && <p className="title-plot">{plot}</p>}
        {movie?.director && <p className="title-credits"><b>Director</b> {movie.director}</p>}
        {movie?.cast && <p className="title-credits"><b>Cast</b> {movie.cast}</p>}
        <div className="title-actions">
          {primary && <button ref={playButton} type="button" className="button primary" data-nav-start="" data-focus-key="action:play" aria-disabled={busy || undefined} onClick={guard(() => onPlay(primary!.request))}><Play size={18} aria-hidden="true"/> {busy ? 'Starting…' : primary.label}</button>}
          {startOver && <button type="button" className="small-button" data-focus-key="action:restart" aria-disabled={busy || undefined} onClick={guard(() => onPlay(startOver!))}><RotateCcw size={16} aria-hidden="true"/> Start over</button>}
          <button ref={libraryButton} type="button" className="small-button library-toggle" data-focus-key="action:library" aria-pressed={favorite} onClick={onToggleFavorite}>{favorite ? <><Check size={16} aria-hidden="true"/> In your Library</> : <><Plus size={16} aria-hidden="true"/> Add to Library</>}</button>
        </div>
        {(mode === 'tuner' || mode === 'maybe') && title.kind !== 'series' && <FormatNote mode={mode}/>}
        {error && <p className="watch-error" role="alert">{error}</p>}
        {details.series?.status === 'loading' || details.movie?.status === 'loading' ? <p className="title-loading" role="status">Loading details…</p> : null}
        {(details.series?.status === 'error' || details.movie?.status === 'error') && <div className="watch-error" role="alert"><p>{details.series?.message || details.movie?.message}</p><button type="button" className="small-button" onClick={() => retryDetails(title)}>Try again</button></div>}
      </div>
    </div>
    {title.kind === 'series' && series && <section className="title-episodes" aria-labelledby="episodes-title">
      <div className="episodes-head">
        <h2 id="episodes-title">Episodes</h2>
        {series.seasons.length > 1 && <FilterMenu label="Season" value={String(seasonShown)} options={series.seasons.map(item => ({value: String(item.season), label: item.name}))} onChange={value => setSeason(Number(value))}/>}
      </div>
      <ol className="episode-list">
        {seasonEpisodes.map(episode => {
          const plan = vodPlan(episode.ext, canPlay).mode;
          const current = progress?.e === episode.id;
          const fraction = current && !progress?.nx && progress && progress.d > 0 ? Math.min(1, progress.p / progress.d) : 0;
          return <li key={episode.id}>
            <button type="button" className="episode-button" data-focus-key={'episode:' + episode.id} disabled={plan === 'tuner'} aria-disabled={busy || undefined} aria-describedby={plan === 'tuner' ? 'episode-format-note' : undefined} onClick={guard(() => onPlay({episode, tryAnyway: plan === 'maybe'}))}>
              <span className="episode-number">{episode.episode || '•'}</span>
              <span className="episode-text"><strong>{episode.title || 'Episode ' + (episode.episode || episode.index + 1)}</strong><small>{[episode.label, minutes(episode.duration), plan === 'tuner' ? 'Tuner app only' : plan === 'maybe' ? 'May not play here' : '', current && progress?.nx ? 'Up next' : ''].filter(Boolean).join(' · ')}</small>
                {episode.plot && <span className="episode-plot">{episode.plot}</span>}</span>
              {fraction > 0 && <span className="poster-progress" aria-label={Math.round(fraction * 100) + '% watched'}><i style={{width: Math.round(fraction * 100) + '%'}}/></span>}
            </button>
          </li>;
        })}
      </ol>
      {episodes.some(episode => vodPlan(episode.ext, canPlay).mode !== 'file' && vodPlan(episode.ext, canPlay).mode !== 'hls') && <div id="episode-format-note"><FormatNote mode={episodes.some(episode => vodPlan(episode.ext, canPlay).mode === 'tuner') ? 'tuner' : 'maybe'}/></div>}
    </section>}
  </article>;
}

/** Beside the player while a movie or episode plays: what it is, the Library, and the season's other episodes. */
export function PlayAside({title, episodeId, library, bases, onPlay, onToggleFavorite, onDetails}: {
  title: IndexedTitle; episodeId?: string; library: Library; bases: string[]; onPlay: (request: PlayRequest) => void; onToggleFavorite: () => void; onDetails: () => void;
}) {
  const details = useDetails(title);
  const episodes = details.series?.data?.episodes || [];
  const playing = episodes.find(episode => episode.id === episodeId);
  const season = episodes.filter(episode => episode.season === playing?.season);
  const favorite = library.fav.includes(title.key);
  return <aside className="channel-panel play-aside" aria-label={title.kind === 'series' ? 'Episodes' : 'About this title'}>
    <div className="play-aside-head">
      <div className="play-aside-poster"><PosterArt src={details.series?.data?.poster || posterSrc(title.poster, bases)} name={title.name}/></div>
      <div><h2>{title.name}</h2><p>{playing ? playing.label + (playing.title ? ' · ' + playing.title : '') : yearShown(title.name, title.year)}</p></div>
    </div>
    <div className="play-aside-actions">
      <button type="button" className="small-button" aria-pressed={favorite} onClick={onToggleFavorite}>{favorite ? '✓ In your Library' : '+ Add to Library'}</button>
      <button type="button" className="small-button" onClick={onDetails}>Details</button>
    </div>
    {season.length > 0 && <ol className="episode-list compact">
      {season.map(episode => <li key={episode.id}><button type="button" className="episode-button" aria-current={episode.id === episodeId ? 'true' : undefined} disabled={vodPlan(episode.ext, canPlay).mode === 'tuner'} onClick={() => onPlay({episode, tryAnyway: vodPlan(episode.ext, canPlay).mode === 'maybe'})}>
        <span className="episode-number">{episode.episode || '•'}</span><span className="episode-text"><strong>{episode.title || 'Episode ' + (episode.episode || episode.index + 1)}</strong><small>{episode.label}{episode.duration ? ' · ' + minutes(episode.duration) : ''}</small></span>
      </button></li>)}
    </ol>}
  </aside>;
}
