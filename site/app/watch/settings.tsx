'use client';
import {useEffect, useState, type ReactNode} from 'react';
import {TMDB_NOTICE} from './browse-cards';

// The player's Settings: the line, Movies & Series (USA only / All, refresh), where the player starts, the adult
// lock, the keyboard and remote keys, and About (with TMDB's notice whenever TMDB lists are in use).

function Segmented<T extends string>({label, value, options, onChange, name, start}: {label: string; value: T; options: {value: T; label: string}[]; onChange: (value: T) => void; name: string; start?: boolean}) {
  return <fieldset className="settings-segmented">
    <legend>{label}</legend>
    <div>{options.map(option => <label key={option.value} className={option.value === value ? 'checked' : ''}>
      <input type="radio" name={name} value={option.value} checked={option.value === value} data-nav-start={start && option.value === value ? '' : undefined} onChange={() => onChange(option.value)}/>
      <span>{option.label}</span>
    </label>)}</div>
  </fieldset>;
}

export default function Settings({username, expiresAt, region, onRegion, start, onStart, titles, source, withTmdb, onRefresh, adultLock, onShortcuts, onSignOut, signingOut, saveError}: {
  username: string; expiresAt: number | null; region: 'us' | 'all'; onRegion: (value: 'us' | 'all') => void; start: 'home' | 'live'; onStart: (value: 'home' | 'live') => void;
  titles: boolean; source: 'xtream' | 'm3u' | 'none'; withTmdb: boolean; onRefresh: () => Promise<string>; adultLock: ReactNode; onShortcuts: () => void; onSignOut: () => void; signingOut: boolean; saveError: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [until, setUntil] = useState('');
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => setUntil(new Date(expiresAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})), 0);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(0), cooldown);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function refresh() {
    setRefreshing(true); setRefreshNote('');
    const note = await onRefresh();
    setRefreshNote(note); setRefreshing(false); setCooldown(5 * 60 * 1000);
  }
  return <div className="watch-browse watch-settings">
    <h1 className="browse-title">Settings</h1>
    {titles && <section className="settings-card" aria-labelledby="settings-vod">
      <h2 id="settings-vod">Movies &amp; Series</h2>
      <Segmented name="vod-region" start label="Show movies and series" value={region} onChange={onRegion} options={[{value: 'us', label: 'USA only'}, {value: 'all', label: 'All'}]}/>
      <p className="settings-muted">USA only shows titles from the USA: a title matched to TMDB must list the US among its countries, and its category must not be a foreign-language one (those are usually dubbed copies). Titles with no country, or not matched, are judged by their category alone.</p>
      {source === 'xtream' && <div className="settings-actions">
        <button type="button" className="small-button" onClick={() => void refresh()} disabled={refreshing || cooldown > 0}>{refreshing ? 'Refreshing…' : 'Refresh movies & series'}</button>
        {refreshNote && <span className="settings-muted" role="status">{refreshNote}</span>}
      </div>}
      {saveError && <p className="watch-error" role="alert">{saveError}</p>}
    </section>}
    {titles && <section className="settings-card" aria-labelledby="settings-start">
      <h2 id="settings-start">Start on</h2>
      <Segmented name="watch-start" label="When the player opens" value={start} onChange={onStart} options={[{value: 'home', label: 'Home'}, {value: 'live', label: 'Live TV'}]}/>
    </section>}
    <section className="settings-card" aria-labelledby="settings-adult">
      <h2 id="settings-adult">Adult content</h2>
      <p className="settings-muted">Adult categories are hidden in Live TV and Movies &amp; Series until you unlock them with this browser’s passcode. Unlocking lasts until the page reloads.</p>
      <div className="settings-actions">{adultLock}</div>
    </section>
    <section className="settings-card" aria-labelledby="settings-keys">
      <h2 id="settings-keys">Keyboard &amp; remote</h2>
      <p className="settings-muted">Arrow keys move, Enter opens or plays, Esc or Back goes back.</p>
      <div className="settings-actions"><button type="button" className="small-button" onClick={onShortcuts}>Show all shortcuts</button></div>
    </section>
    <section className="settings-card" aria-labelledby="settings-account">
      <h2 id="settings-account">Your line</h2>
      <p><span className="watch-user" title={username}>{username}</span>{until && <span className="settings-muted"> Signed in until {until}</span>}</p>
      <div className="settings-actions">
        <button type="button" className="small-button" onClick={onSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
        <a className="small-button" href="/renew">Renew an expired line ↗</a>
      </div>
    </section>
    <section className="settings-card" aria-labelledby="settings-about">
      <h2 id="settings-about">About</h2>
      <p className="settings-muted">LumaNest TV web player. Your Library and these settings are kept in this browser.</p>
      {withTmdb && <><p className="settings-muted">Movie and series lists: TMDB.</p><p className="tmdb-notice">{TMDB_NOTICE}</p></>}
    </section>
  </div>;
}
