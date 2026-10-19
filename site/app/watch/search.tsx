'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {foldText, searchTitles, type Catalog, type Library, type PickOptions} from '../../lib/browse';
import {cardsFor} from './browse-cards';
import {CatalogueError} from './home';
import {PosterRow, type OpenTitle} from './poster';
import type {Channel} from './use-catalogue';
import {channelBadge, type PosterSources} from './poster-choice';

/** Search: movies and series (names starting with the text first) and live channels, from 2 letters, ignoring accents. */
export default function Search({query, catalog, library, posters, opts, channels, error, onRetry, onQuery, onOpen, onChannel}: {
  query: string; catalog: Catalog | null; library: Library; posters: PosterSources; opts: PickOptions; channels: Channel[]; error: string; onRetry: () => void;
  onQuery: (value: string) => void; onOpen: OpenTitle; onChannel: (channel: Channel) => void;
}) {
  const [text, setText] = useState(query);
  const [search, setSearch] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  const report = useRef(onQuery);
  // What the address already says: it is only rewritten when the text changes (not when Back brings Search back).
  const reported = useRef(query);
  useEffect(() => {report.current = onQuery;});
  useEffect(() => {input.current?.focus({preventScroll: true});}, []);
  // 200 ms after the last key, the results and the address follow.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(text);
      if (text !== reported.current) {reported.current = text; report.current(text);}
    }, 200);
    return () => clearTimeout(timer);
  }, [text]);
  const needle = foldText(search.trim());
  const movies = useMemo(() => catalog && needle.length >= 2 ? cardsFor(searchTitles(catalog.movies.items, needle, opts, 60).map(idx => ({type: 'movies' as const, idx})), catalog, library, posters) : [], [catalog, needle, opts, library, posters]);
  const series = useMemo(() => catalog && needle.length >= 2 ? cardsFor(searchTitles(catalog.series.items, needle, opts, 60).map(idx => ({type: 'series' as const, idx})), catalog, library, posters) : [], [catalog, needle, opts, library, posters]);
  const live = useMemo(() => needle.length >= 2 ? channels.filter(channel => foldText(channel.name + ' ' + channel.group).includes(needle)).slice(0, 30) : [], [channels, needle]);
  const nothing = needle.length >= 2 && !movies.length && !series.length && !live.length;
  return <div className="watch-browse watch-search">
    <h1 className="browse-title">Search</h1>
    <label className="search-label watch-search-field">Search movies, series and channels
      <input ref={input} type="search" value={text} maxLength={100} placeholder="A title, a channel…" aria-keyshortcuts="/" onChange={event => setText(event.target.value)} enterKeyHint="search"/>
    </label>
    {error && <CatalogueError message={error} onRetry={onRetry}/>}
    <p className="sr-only" role="status">{needle.length < 2 ? '' : nothing ? 'No results' : `${movies.length} movies, ${series.length} series, ${live.length} channels`}</p>
    {needle.length < 2 && <p className="browse-footnote">Type at least 2 letters.</p>}
    {nothing && <div className="browse-empty"><h2>No results</h2><p>Nothing matches “{search.trim()}”.{opts.usOnly && !error ? ' Movies & Series show titles from the USA only; switch to All in Settings to search everything.' : ''}</p></div>}
    {movies.length > 0 && <PosterRow id="search-movies" title="Movies" items={movies} onOpen={onOpen}/>}
    {series.length > 0 && <PosterRow id="search-series" title="Series" items={series} onOpen={onOpen}/>}
    {live.length > 0 && <section className="search-channels" aria-labelledby="search-channels">
      <div className="poster-row-head"><h2 id="search-channels">Channels</h2></div>
      <ul>{live.map(channel => <li key={channel.id}><button type="button" className="channel-choice" data-focus-key={'channel:' + channel.id} disabled={!channel.token} onClick={() => onChannel(channel)}>
        <span className="channel-icon" aria-hidden="true">{channelBadge(channel.name)}</span><span><strong>{channel.name}</strong><small>{channel.token ? channel.group : 'Stream unavailable'}</small></span>
      </button></li>)}</ul>
    </section>}
  </div>;
}
