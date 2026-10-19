'use client';
import {useRef, useState, type Ref} from 'react';
import {ChevronLeft, ChevronRight, Check} from 'lucide-react';
import type {IndexedTitle} from '../../lib/browse';
import {posterFocusKey} from './watch-route';
import {initials, posterFailed, shownPoster} from './poster-choice';
export {providerPosterSrc as posterSrc} from './poster-choice';

// Posters, rows of posters and poster grids for the web player's browsing. Every poster is a plain button, so a
// mouse, a finger or a TV remote (arrow keys and Enter, through use-spatial-navigation) can open it.

/** srcs: the pictures to try, best first (poster-choice.ts posterChoices); none shows the initials card. */
export type CardItem = {title: IndexedTitle; srcs: string[]; favorite: boolean; progress: number; subtitle?: string};

/** Shown when a title has no poster or its poster fails to load. */
export function TitleCard({name}: {name: string}) {
  return <span className="poster-fallback" aria-hidden="true"><b>{initials(name)}</b><span>{name}</span></span>;
}

/** The first of srcs that loads (a failed one gives way to the next), else the initials card. */
export function PosterArt({srcs, name, eager = false}: {srcs: string[]; name: string; eager?: boolean}) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const src = shownPoster(srcs, failed);
  if (!src) return <TitleCard name={name}/>;
  // eslint-disable-next-line @next/next/no-img-element -- posters come from TMDB or the line's catalogue (direct https or /api/player/image), not static assets next/image could optimise
  return <img key={src} src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" width={200} height={300} onError={() => setFailed(current => posterFailed(current, src))}/>;
}

export function cardLabel(item: CardItem) {
  const parts = [item.title.name];
  if (item.subtitle) parts.push(item.subtitle);
  else if (item.title.year && !item.title.name.includes(item.title.year)) parts.push(item.title.year);
  if (item.favorite) parts.push('in your Library');
  if (item.progress > 0) parts.push(Math.round(item.progress * 100) + '% watched');
  return parts.join(', ');
}

/** Opens a title; focusKey names the poster, so Back focuses this very poster again (a title can be in several rows). */
export type OpenTitle = (key: string, focusKey?: string) => void;

export function PosterCard({item, onOpen, eager, scope}: {item: CardItem; onOpen: OpenTitle; eager?: boolean; scope: string}) {
  const focusKey = posterFocusKey(scope, item.title.key);
  return <button type="button" className="poster-card" data-focus-key={focusKey} aria-label={cardLabel(item)} onClick={() => onOpen(item.title.key, focusKey)}>
    <span className="poster-art">
      <PosterArt srcs={item.srcs} name={item.title.name} eager={eager}/>
      {item.favorite && <span className="poster-check" aria-hidden="true"><Check size={14} strokeWidth={3}/></span>}
      {item.progress > 0 && <span className="poster-progress" aria-hidden="true"><i style={{width: Math.max(4, Math.round(item.progress * 100)) + '%'}}/></span>}
    </span>
    <span className="poster-name" aria-hidden="true">{item.title.name}{item.subtitle ? <small>{item.subtitle}</small> : null}</span>
  </button>;
}

/** A titled, sideways-scrolling row of posters ending in a See all tile. */
export function PosterRow({id, title, items, onOpen, onSeeAll, eager}: {id: string; title: string; items: CardItem[]; onOpen: OpenTitle; onSeeAll?: () => void; eager?: boolean}) {
  const scroller = useRef<HTMLDivElement>(null);
  const headingId = 'row-' + id.replace(/[^A-Za-z0-9_-]/g, '-');
  const scroll = (direction: 1 | -1) => {
    const element = scroller.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({left: direction * element.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth'});
  };
  return <section className="poster-row" aria-labelledby={headingId}>
    <div className="poster-row-head">
      <h2 id={headingId}>{title}</h2>
      {onSeeAll && <button type="button" className="see-all-link" tabIndex={-1} onClick={onSeeAll}>See all <ChevronRight size={14} aria-hidden="true"/></button>}
    </div>
    <div className="poster-row-body">
      <button type="button" className="row-scroll row-scroll-back" tabIndex={-1} aria-hidden="true" onClick={() => scroll(-1)}><ChevronLeft size={22}/></button>
      <div className="poster-row-scroll" ref={scroller} data-nav-group="">
        <ul className="poster-row-list">
          {items.map((item, index) => <li key={item.title.key}><PosterCard item={item} onOpen={onOpen} eager={eager && index < 6} scope={id}/></li>)}
          {onSeeAll && <li><button type="button" className="see-all-tile" data-focus-key={'seeall:' + id} onClick={onSeeAll} aria-label={'See all: ' + title}><span>See all</span><ChevronRight size={22} aria-hidden="true"/></button></li>}
        </ul>
      </div>
      <button type="button" className="row-scroll row-scroll-next" tabIndex={-1} aria-hidden="true" onClick={() => scroll(1)}><ChevronRight size={22}/></button>
    </div>
  </section>;
}

/** A grid of posters (Discover). data-nav-grid: arrow keys measure only the posters near the focused one. */
export function PosterGrid({items, onOpen, label, list}: {items: CardItem[]; onOpen: OpenTitle; label: string; list?: Ref<HTMLUListElement>}) {
  return <ul className="poster-grid" aria-label={label} data-nav-grid="" ref={list}>
    {items.map(item => <li key={item.title.key}><PosterCard item={item} onOpen={onOpen} scope="grid"/></li>)}
  </ul>;
}

export function RowSkeleton({count = 3}: {count?: number}) {
  return <div className="poster-skeletons" aria-hidden="true">
    {Array.from({length: count}, (_, row) => <div key={row} className="poster-row skeleton-row">
      <div className="poster-row-head"><span className="skeleton-line"/></div>
      <div className="poster-row-list">{Array.from({length: 8}, (_, i) => <span key={i} className="poster-card skeleton-card"><span className="poster-art"/></span>)}</div>
    </div>)}
  </div>;
}
