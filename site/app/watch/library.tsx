'use client';
import {useMemo} from 'react';
import {libraryKeys, libraryRefs, libraryTypeOf} from '../../lib/browse';
import {cardsFor} from './browse-cards';
import {PosterRow} from './poster';
import {CatalogueError, type BrowseBase} from './home';

/** The Library: Continue watching, favourite movies and series, and Recently watched, kept for this line in this browser. */
export default function LibraryView({catalog, library, posters, opts, onOpen, error, onRetry, saveError}: BrowseBase & {saveError: string}) {
  const sections = useMemo(() => [
    {id: 'continue', title: 'Continue watching', refs: libraryRefs(libraryKeys(library.prog), catalog, opts), empty: 'Movies and episodes you stop part-way through appear here.'},
    {id: 'fav-movies', title: 'Favorite movies', refs: libraryRefs(library.fav.filter(key => libraryTypeOf(key) === 'movies'), catalog, opts), empty: 'Choose Add to Library on a movie to keep it here.'},
    {id: 'fav-series', title: 'Favorite series', refs: libraryRefs(library.fav.filter(key => libraryTypeOf(key) === 'series'), catalog, opts), empty: 'Choose Add to Library on a series to keep it here.'},
    {id: 'seen', title: 'Recently watched', refs: libraryRefs(libraryKeys(library.seen), catalog, opts), empty: 'What you watch appears here.'},
  ], [library, catalog, opts]);
  return <div className="watch-browse watch-library">
    <h1 className="browse-title">Library</h1>
    {/* Without the catalogue the Library can't show its titles: say why, rather than show empty sections. */}
    {error ? <CatalogueError message={error} onRetry={onRetry}/> : null}
    {saveError && <p className="watch-error" role="alert">{saveError}</p>}
    {sections.map(section => section.refs.length ? <PosterRow key={section.id} id={'library-' + section.id} title={section.title} items={cardsFor(section.refs, catalog, library, posters)} onOpen={onOpen}/> :
      <section key={section.id} className="poster-row library-empty" aria-labelledby={'library-' + section.id}><div className="poster-row-head"><h2 id={'library-' + section.id}>{section.title}</h2></div><p>{error ? 'Shown once your movies and series load.' : section.empty}</p></section>)}
    <p className="browse-footnote">Your Library is kept in this browser for this line. It isn’t shared with your TV apps.</p>
  </div>;
}
