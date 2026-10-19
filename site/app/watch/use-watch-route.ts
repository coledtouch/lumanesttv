'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {baseSection, parseRoute, routeHref, sameRoute, type Route, type Section} from './watch-route';

// The web player's screens live in the browser history: each screen change is a history entry, so Back (the
// browser's, a phone's or a TV remote's) returns to the previous screen and to the poster or button that opened it.
// An entry also remembers the section a title was opened from (the navigation highlights it) and small per-screen
// values (how many Discover pages were loaded), so Back finds the screen as it was.
type Entry = {lumanestWatch: 1; route: Route | null; depth: number; focusKey?: string; section?: Section; data?: Record<string, number>};

function entryOf(value: unknown): Entry | null {
  return value && typeof value === 'object' && (value as Entry).lumanestWatch === 1 ? value as Entry : null;
}

export type NavigateOptions = {
  /** Replaces the current entry instead of adding one (Back skips it). */
  replace?: boolean;
  /** The element (data-focus-key) that Back to the screen being left should focus again. */
  focusKey?: string;
  /** Only the address changes (typing in Search): no new screen, so nothing moves focus or scrolls. */
  silent?: boolean;
};

export type WatchRouter = {
  /** The route in the address, or null for the start view. Undefined until the page has read its address. */
  route: Route | null | undefined;
  /** Shows a screen. */
  navigate: (route: Route, options?: NavigateOptions) => void;
  /** One screen back, or to the start view when this page opened on the current screen. */
  back: () => void;
  /** Set when Back has just restored a screen: the element to focus there. */
  restoreKey: string;
  /** Increases on every screen change, so the page can move focus after it. */
  changes: number;
  /** The section a title or player screen was opened from ('' for others, or when not known). */
  from: Section | '';
  /** A value this screen's history entry keeps (see setValue), or undefined. */
  value: (name: string) => number | undefined;
  /** Keeps a small value in this screen's history entry, for when Back returns to it. */
  setValue: (name: string, value: number) => void;
};

export function useWatchRoute(): WatchRouter {
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [restoreKey, setRestoreKey] = useState('');
  const [changes, setChanges] = useState(0);
  const [from, setFrom] = useState<Section | ''>('');
  const current = useRef<Entry | null>(null);

  useEffect(() => {
    let disposed = false;
    // The player puts focus (and so the scroll position) back itself after Back; the browser's own restoring would
    // run before the screen is drawn.
    try {history.scrollRestoration = 'manual';} catch {}
    void Promise.resolve().then(() => {
      if (disposed) return;
      const existing = entryOf(history.state);
      const entry: Entry = existing || {lumanestWatch: 1, route: parseRoute(location.search), depth: 0};
      if (!existing) {try {history.replaceState(entry, '');} catch {}}
      current.current = entry;
      setRoute(entry.route);
      setFrom(entry.section || '');
    });
    const onPop = (event: PopStateEvent) => {
      const known = entryOf(event.state);
      const now = current.current;
      // An entry the player didn't make (a #fragment link) on the same screen is not a screen change: it takes this
      // screen's entry, so Back from it keeps counting screens.
      if (!known && now && sameRoute(parseRoute(location.search), now.route)) {
        try {history.replaceState(now, '');} catch {}
        return;
      }
      const entry = known || {lumanestWatch: 1, route: parseRoute(location.search), depth: 0};
      current.current = entry;
      setRoute(entry.route);
      setFrom(entry.section || '');
      setRestoreKey(entry.focusKey || '');
      setChanges(value => value + 1);
    };
    window.addEventListener('popstate', onPop);
    return () => {disposed = true; window.removeEventListener('popstate', onPop);};
  }, []);

  const navigate = useCallback((next: Route, options: NavigateOptions = {}) => {
    const now = current.current;
    if (now && sameRoute(now.route, next) && !options.replace) return;
    const depth = now ? now.depth : 0;
    // A title or the player belongs to the section it was opened from; going from one to the other keeps it.
    const section: Section | undefined = next.view === 'title' || next.view === 'play'
      ? (now?.route && (now.route.view === 'title' || now.route.view === 'play') ? now.section : now?.route ? baseSection(now.route) : undefined)
      : undefined;
    const keep = options.replace && now && sameRoute(now.route, next);
    const entry: Entry = {lumanestWatch: 1, route: next, depth: options.replace ? depth : depth + 1, ...(section ? {section} : {}),
      ...(keep && now?.data ? {data: now.data} : {}), ...(keep && now?.focusKey ? {focusKey: now.focusKey} : {})};
    try {
      // The screen being left remembers what to focus when Back returns to it.
      if (now && options.focusKey !== undefined && !options.replace) history.replaceState({...now, focusKey: options.focusKey}, '');
      if (options.replace) history.replaceState(entry, '', routeHref(next));
      else history.pushState(entry, '', routeHref(next));
      current.current = entry;
    } catch {
      current.current = {...entry, depth};
    }
    setRoute(next);
    setFrom(entry.section || '');
    if (options.silent) return;
    setRestoreKey('');
    setChanges(value => value + 1);
  }, []);

  const back = useCallback(() => {
    const now = current.current;
    if (now && now.depth > 0) history.back();
    else if (now?.route !== null) {
      // Opened directly on this screen: Back goes to the start view rather than leaving the player.
      try {
        const entry: Entry = {lumanestWatch: 1, route: null, depth: 0};
        history.replaceState(entry, '', '/watch');
        current.current = entry;
      } catch {}
      setRoute(null);
      setFrom('');
      setRestoreKey('');
      setChanges(value => value + 1);
    }
  }, []);

  const value = useCallback((name: string) => current.current?.data?.[name], []);
  const setValue = useCallback((name: string, next: number) => {
    const now = current.current;
    if (!now || now.data?.[name] === next) return;
    const entry: Entry = {...now, data: {...now.data, [name]: next}};
    current.current = entry;
    try {history.replaceState(entry, '');} catch {}
  }, []);

  return {route, navigate, back, restoreKey, changes, from, value, setValue};
}
