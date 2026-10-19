'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {discoverLists, pickTitles, type ListKey, type MediaType} from '../../lib/browse';
import {cardsFor, TMDB_NOTICE} from './browse-cards';
import FilterMenu from './filter-menu';
import {CatalogueError, type BrowseBase} from './home';
import {PosterGrid} from './poster';
import {focusElement, keysMode} from './use-spatial-navigation';

const PAGE = 60;

/**
 * Discover: Type, List and Genre over a poster grid that grows 60 titles at a time, by scrolling (an
 * IntersectionObserver) or with Load more (keyboards and TV remotes). See all on Home opens it with Type and List set.
 * A filter change replaces this screen (Back leaves Discover rather than undoing filters). How many titles were
 * loaded is kept in the screen's history entry (initialLimit, onLimit), so Back from a title deep in the grid finds
 * that title again.
 */
export default function Discover({catalog, library, bases, opts, withTmdb, onOpen, onNavigate, error, onRetry, type, list, genre, initialLimit, onLimit}: BrowseBase & {
  type: MediaType; list: ListKey; genre: string; initialLimit?: number; onLimit: (limit: number) => void;
}) {
  const section = catalog[type];
  const lists = useMemo(() => discoverLists(withTmdb), [withTmdb]);
  const listKey = lists.some(item => item.key === list) ? list : lists[0].key;
  const genreKey = section.genres.some(item => item.key === genre) ? genre : '';
  // Each Type/List/Genre starts at one page again; the page stays mounted so focus stays on the filter just used.
  const filters = type + ':' + listKey + ':' + genreKey;
  const [pages, setPages] = useState(() => ({filters, limit: Math.max(PAGE, Math.min(Math.floor(initialLimit || PAGE), 50000))}));
  const limit = pages.filters === filters ? pages.limit : PAGE;
  const sentinel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  // After Load more with keys: the first poster it added gets focus (the button may be gone).
  const focusFrom = useRef(-1);
  const result = useMemo(() => pickTitles(section.items, section.lists[listKey], {...opts, genre: genreKey, seen: new Set()}, 0, limit), [section, listKey, opts, genreKey, limit]);
  const more = result.cursor < (section.lists[listKey]?.length || 0);
  const items = useMemo(() => cardsFor(result.picked.map(idx => ({type, idx})), catalog, library, bases), [result, type, catalog, library, bases]);
  const report = useRef(onLimit);
  useEffect(() => {report.current = onLimit;});
  useEffect(() => {report.current(limit);}, [limit]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !more || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {if (entries.some(entry => entry.isIntersecting)) setPages({filters, limit: limit + PAGE});}, {rootMargin: '600px 0px'});
    observer.observe(element);
    return () => observer.disconnect();
  }, [more, limit, filters]);

  useEffect(() => {
    const at = focusFrom.current;
    if (at < 0 || items.length <= at) return;
    focusFrom.current = -1;
    const poster = grid.current?.querySelectorAll<HTMLElement>('.poster-card')[at];
    if (poster) focusElement(poster);
  }, [items]);

  const loadMore = () => {
    if (keysMode()) focusFrom.current = items.length;
    setPages({filters, limit: limit + PAGE});
  };
  const change = (next: {type?: MediaType; list?: ListKey; genre?: string}) => onNavigate({view: 'discover', type: next.type || type, list: next.list || listKey, genre: next.genre ?? (next.type ? '' : genreKey)}, undefined, true);
  const listName = lists.find(item => item.key === listKey)?.name || '';
  return <div className="watch-browse watch-discover">
    <h1 className="sr-only">Discover</h1>
    {error && <CatalogueError message={error} onRetry={onRetry}/>}
    <div className="discover-filters" role="group" aria-label="Filters">
      <FilterMenu label="Type" value={type} options={[{value: 'movies', label: 'Movies'}, {value: 'series', label: 'Series'}]} onChange={value => change({type: value as MediaType})}/>
      <FilterMenu label="List" value={listKey} options={lists.map(item => ({value: item.key, label: item.name}))} onChange={value => change({list: value as ListKey})}/>
      <FilterMenu label="Genre" value={genreKey} options={[{value: '', label: 'All genres'}, ...section.genres.map(item => ({value: item.key, label: item.name}))]} onChange={value => change({genre: value})}/>
    </div>
    <p className="discover-count" role="status">{items.length ? `${items.length.toLocaleString()}${more ? '+' : ''} ${type === 'series' ? 'series' : items.length === 1 ? 'movie' : 'movies'} · ${listName}` : ''}</p>
    {items.length ? <PosterGrid items={items} onOpen={onOpen} list={grid} label={`${type === 'series' ? 'Series' : 'Movies'}, ${listName}`}/> : <div className="browse-empty">
      <h2>Nothing here yet</h2>
      <p>{genreKey ? 'No titles in this list have that genre.' : error ? 'Movies and series could not be loaded.' : opts.usOnly ? 'No titles from the USA are in this list. Switch Movies & Series to All in Settings to see more.' : 'Your line has no titles in this list.'}</p>
      {genreKey && <button type="button" className="small-button" onClick={() => change({genre: ''})}>Show all genres</button>}
    </div>}
    {more && <div className="discover-more" ref={sentinel}><button type="button" className="load-more" onClick={loadMore}>Load more</button></div>}
    {withTmdb && <p className="tmdb-note">{TMDB_NOTICE}</p>}
  </div>;
}
