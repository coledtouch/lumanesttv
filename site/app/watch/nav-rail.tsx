'use client';
import {Compass, House, Library, Search, Settings, Tv} from 'lucide-react';
import type {Route, Section} from './watch-route';

// The web player's sections. A rail on the left on computers and TVs, a strip under the header on tablets, a tab bar
// at the bottom on phones (watch.css / browse.css). Without movies or series, only Live TV, Search and Settings.

const SECTIONS: {id: Section; label: string; icon: typeof House; route: Route; browse?: boolean}[] = [
  {id: 'home', label: 'Home', icon: House, route: {view: 'home'}, browse: true},
  {id: 'live', label: 'Live TV', icon: Tv, route: {view: 'live'}},
  {id: 'discover', label: 'Discover', icon: Compass, route: {view: 'discover', type: 'movies', list: 'popular', genre: ''}, browse: true},
  {id: 'library', label: 'Library', icon: Library, route: {view: 'library'}, browse: true},
  {id: 'search', label: 'Search', icon: Search, route: {view: 'search', q: ''}},
  {id: 'settings', label: 'Settings', icon: Settings, route: {view: 'settings'}},
];

export default function NavRail({current, titles, onNavigate}: {current: Section; titles: boolean; onNavigate: (route: Route, focusKey: string) => void}) {
  return <nav className="watch-rail" aria-label="Web player" data-nav-rail="">
    <ul>
      {SECTIONS.filter(section => titles || !section.browse).map(section => {
        const Icon = section.icon;
        return <li key={section.id}>
          <button type="button" data-focus-key={'rail:' + section.id} aria-current={section.id === current ? 'page' : undefined} onClick={() => onNavigate(section.route, 'rail:' + section.id)}>
            <Icon size={22} aria-hidden="true"/><span>{section.label}</span>
          </button>
        </li>;
      })}
    </ul>
  </nav>;
}
