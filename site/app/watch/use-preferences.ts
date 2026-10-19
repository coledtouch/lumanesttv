'use client';
import {useCallback, useSyncExternalStore} from 'react';

// Small settings kept in this browser: the "Movies & Series: USA only / All" switch and the screen the player starts
// on. Read through useSyncExternalStore, so the server render (which has no localStorage) shows the defaults and the
// page updates once it is in the browser, and other tabs follow changes.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {listeners.delete(listener); window.removeEventListener('storage', listener);};
}

export function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value !== null && (allowed as readonly string[]).includes(value) ? value as T : fallback;
  } catch {return fallback;}
}

export function usePreference<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (value: T) => boolean] {
  const value = useSyncExternalStore(subscribe, () => readStored(key, allowed, fallback), () => fallback);
  const set = useCallback((next: T) => {
    let saved = true;
    try {localStorage.setItem(key, next);} catch {saved = false;}
    for (const listener of listeners) listener();
    return saved;
  }, [key]);
  return [value, set];
}

export const REGIONS = ['us', 'all'] as const;
export const START_VIEWS = ['home', 'live'] as const;
export const REGION_KEY = 'lumanest_vod_region';
export const START_KEY = 'lumanest_watch_start';
