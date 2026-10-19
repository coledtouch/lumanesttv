'use client';
import {useRef, useState, type Ref} from 'react';
import {ChevronLeft, ChevronRight, Check} from 'lucide-react';
import type {IndexedTitle} from '../../lib/browse';
import {posterFocusKey} from './watch-route';

// Posters, rows of posters and poster grids for the web player's browsing. Every poster is a plain button, so a
// mouse, a finger or a TV remote (arrow keys and Enter, through use-spatial-navigation) can open it.

/**
 * A poster's address for an <img>: a direct https URL as it is, or "~<base>:<file>" through /api/player/image with
 * the sealed base the catalogue sent (lib/player-vod-data.ts createPosterBook). '' when there is none.
 */
export function posterSrc(poster: string, bases: string[]) {
  if (!poster) return '';
  if (poster.startsWith('https://')) return poster;
  const match = /^~(\d{1,5}):(.*)$/.exec(poster);
  const base = match ? bases[Number(match[1])] : undefined;
  return base ? '/api/player/image?t=' + encodeURIComponent(base) + '&f=' + encodeURIComponent(match![2]) : '';
}

export type CardItem = {title: IndexedTitle; src: string; favorite: boolean; progress: number; subtitle?: string};

function initials(name: string) {
  const words = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s+/).filter(word => /^[\p{L}\p{N}]/u.test(word));
  return (words.slice(0, 2).map(word => word[0]).join('') || name.slice(0, 2)).toUpperCase();
}

/** Shown when a title has no poster or its poster fails to load. */
export function TitleCard({name}: {name: string}) {
  return <span className="poster-fallback" aria-hidden="true"><b>{initials(name)}</b><span>{name}</span></span>;
}

export function PosterArt({src, name, eager = false}: {src: string; name: string; eager?: boolean}) {
  const [failed, setFailed] = useState('');
  if (!src || failed === src) return <TitleCard name={name}/>;
  // eslint-disable-next-line @next/next/no-img-element -- posters come from the line's catalogue (direct https or /api/player/image), not static assets next/image could optimise
  return <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" width={200} height={300} onError={() => setFailed(src)}/>;
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
      <PosterArt src={item.src} name={item.title.name} eager={eager}/>
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
