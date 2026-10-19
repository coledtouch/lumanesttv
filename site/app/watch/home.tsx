'use client';
import {useMemo} from 'react';
import {buildHomeRows, titleVisible, type Catalog, type Library, type PickOptions, type TitleRef} from '../../lib/browse';
import {cardsFor, TMDB_NOTICE} from './browse-cards';
import {PosterRow, RowSkeleton, type OpenTitle} from './poster';
import type {PosterSources} from './poster-choice';
import {seeAllRoute, type Route} from './watch-route';

export type BrowseBase = {
  catalog: Catalog;
  library: Library;
  /** Where posters come from (TMDB first, then the line's own): poster-choice.ts. */
  posters: PosterSources;
  opts: PickOptions;
  withTmdb: boolean;
  onOpen: OpenTitle;
  /** Shows a screen; replace swaps this screen for it (a Discover filter) instead of adding a Back step. */
  onNavigate: (route: Route, focusKey?: string, replace?: boolean) => void;
  /** A problem loading the line's catalogue (shown with Try again on every browse screen), or ''. */
  error: string;
  onRetry: () => void;
};

/** A problem loading the line's catalogue, with Try again. */
export function CatalogueError({message, onRetry}: {message: string; onRetry: () => void}) {
  return <div className="watch-error browse-error" role="alert"><p>{message}</p><button type="button" className="small-button" onClick={onRetry}>Try again</button></div>;
}

export function BrowseLoading({label}: {label: string}) {
  return <div className="watch-browse" aria-busy="true"><p className="sr-only" role="status">{label}</p><RowSkeleton/></div>;
}

/** Home: Continue watching, then the docs/browse.md rows with at least 5 titles each, 20 at most. */
export default function Home({catalog, library, posters, opts, withTmdb, onOpen, onNavigate, continueRefs, error, onRetry}: BrowseBase & {continueRefs: TitleRef[]}) {
  const rows = useMemo(() => buildHomeRows(catalog, withTmdb, opts, continueRefs), [catalog, withTmdb, opts, continueRefs]);
  const total = catalog.movies.items.length + catalog.series.items.length;
  const anyVisible = useMemo(() => [catalog.movies, catalog.series].some(section => section.items.some(item => titleVisible(item, opts))), [catalog, opts]);
  return <div className="watch-browse watch-home">
    <h1 className="sr-only">Home</h1>
    {error && <CatalogueError message={error} onRetry={onRetry}/>}
    {rows.map((row, index) => <PosterRow key={row.id} id={row.id} title={row.title} eager={index < 2} items={cardsFor(row.refs, catalog, library, posters)} onOpen={onOpen}
      onSeeAll={() => onNavigate(seeAllRoute(row), 'seeall:' + row.id)}/>)}
    {!rows.length && !(error && !total) && <div className="browse-empty">
      <h2>{!total ? 'No movies or series here yet' : anyVisible ? 'Everything is in Discover' : 'Nothing to show here'}</h2>
      <p>{!total ? 'Your line has no movies or series right now.' : anyVisible ? 'Your line has fewer titles than Home needs for its rows. Browse them all in Discover.'
        : opts.usOnly ? 'None of your line’s movies and series are from the USA. Switch Movies & Series to All in Settings to see them.' : 'Your line’s movies and series are in adult categories, which are locked.'}</p>
      {total > 0 && (anyVisible ? <button type="button" className="small-button" data-nav-start="" onClick={() => onNavigate({view: 'discover', type: catalog.movies.items.length ? 'movies' : 'series', list: 'az', genre: ''})}>Open Discover</button>
        : <button type="button" className="small-button" data-nav-start="" onClick={() => onNavigate({view: 'settings'})}>Open Settings</button>)}
    </div>}
    {withTmdb && <p className="tmdb-note">{TMDB_NOTICE}</p>}
  </div>;
}
