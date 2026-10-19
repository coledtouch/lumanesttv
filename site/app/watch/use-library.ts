'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  libraryFor, libraryNew, libraryRecordProgress, libraryRecordWatched, libraryRemoveProgress, libraryToggleFavorite, type Library, type ProgressEntry,
} from '../../lib/browse';

// The Library (favorites, Continue watching, Recently watched) is kept in this browser, separately for each line,
// under a hash of the line's username, in the same shape as the Roku app's. Other tabs follow changes.
const PREFIX = 'lumanest_library_v1:';

async function storageKey(username: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lumanest-line:' + username)));
  return PREFIX + btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

export type LibraryState = {
  library: Library;
  ready: boolean;
  /** Set when this browser couldn't save the Library (private mode, storage full or blocked). */
  error: string;
  toggleFavorite: (key: string) => boolean;
  recordProgress: (entry: ProgressEntry) => void;
  recordWatched: (key: string) => void;
  removeProgress: (key: string) => void;
};

export function useLibrary(username: string): LibraryState {
  const [library, setLibrary] = useState<Library>(() => libraryNew(''));
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const latest = useRef(library);
  const keyRef = useRef('');

  useEffect(() => {
    let disposed = false;
    keyRef.current = '';
    void (async () => {
      if (!username) {
        if (!disposed) {setKey(''); latest.current = libraryNew(''); setLibrary(latest.current);}
        return;
      }
      let next = '';
      try {next = await storageKey(username);} catch {next = '';}
      if (disposed) return;
      let stored: unknown = null;
      try {stored = next ? JSON.parse(localStorage.getItem(next) || 'null') : null;} catch {stored = null;}
      keyRef.current = next;
      latest.current = libraryFor(stored, username);
      setKey(next); setLibrary(latest.current); setError('');
    })();
    return () => {disposed = true;};
  }, [username]);

  useEffect(() => {
    if (!key) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      let stored: unknown = null;
      try {stored = JSON.parse(event.newValue || 'null');} catch {}
      latest.current = libraryFor(stored, latest.current.line);
      setLibrary(latest.current);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const update = useCallback((change: (current: Library) => Library) => {
    if (!keyRef.current) return;
    const next = change(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setLibrary(next);
    try {localStorage.setItem(keyRef.current, JSON.stringify(next)); setError('');}
    catch {setError('This browser couldn’t save your Library. Check that this site may store data.');}
  }, []);

  const toggleFavorite = useCallback((titleKey: string) => {
    let favorite = false;
    update(current => {const result = libraryToggleFavorite(current, titleKey); favorite = result.favorite; return result.library;});
    return favorite;
  }, [update]);
  const recordProgress = useCallback((entry: ProgressEntry) => update(current => libraryRecordProgress(current, entry, Math.floor(Date.now() / 1000))), [update]);
  const recordWatched = useCallback((titleKey: string) => update(current => libraryRecordWatched(current, titleKey, Math.floor(Date.now() / 1000))), [update]);
  const removeProgress = useCallback((titleKey: string) => update(current => libraryRemoveProgress(current, titleKey)), [update]);

  return {library, ready: Boolean(key) && library.line === username, error, toggleFavorite, recordProgress, recordWatched, removeProgress};
}
