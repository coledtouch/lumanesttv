'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type Hls from 'hls.js';
import type mpegts from 'mpegts.js';
import {createPlayerStreamLoader} from '../../lib/player-stream-loader';
import {createPlaybackSession} from '../../lib/player-playback-session';
import {playerStreamError} from '../../lib/player-error';
import {SiteFooter, SiteHeader} from '../site-chrome';

type Channel = {id: string; name: string; group: string; format: 'hls' | 'mpegts' | 'file'; token: string | null; reason: string};
type ChannelResponse = {channels?: Channel[]; username?: string; expiresAt?: number; error?: {code?: string; message: string}};

export default function Player({portal, support}: {portal: string; support: string}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All channels');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [detectedStream, setDetectedStream] = useState<{token: string; format: 'hls' | 'file'} | null>(null);
  const [limit, setLimit] = useState(60);
  const [playError, setPlayError] = useState('');
  const [status, setStatus] = useState('Choose a channel');
  const [qualities, setQualities] = useState<{height: number; index: number}[]>([]);
  const [quality, setQuality] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const viewingArea = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const startPlayback = useRef<(() => void) | null>(null);
  const channelRequest = useRef<AbortController | null>(null);

  const clearSession = useCallback((message = '') => {
    setUsername(''); setChannels([]); setSelected(null); setDetectedStream(null); setExpiresAt(null);
    setQuery(''); setGroup('All channels'); setFavoriteOnly(false);
    setPlayError(''); setStatus('Choose a channel'); setError(message);
  }, []);

  const loadChannels = useCallback(async () => {
    channelRequest.current?.abort();
    const controller = new AbortController();
    channelRequest.current = controller;
    setChecking(true); setError('');
    try {
      const response = await fetch('/api/player/channels', {cache: 'no-store', signal: controller.signal});
      const data = await response.json() as ChannelResponse;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) clearSession(data.error?.code === 'player_login_required' ? '' : data.error?.message || 'Your player session expired. Please sign in again.');
        else setError(data.error?.message || 'Unable to load your channels. Please try again.');
        return;
      }
      const next = data.channels || [];
      setChannels(next); setUsername(data.username || ''); setExpiresAt(data.expiresAt || null);
      setSelected(current => current ? next.find(channel => channel.id === current.id && channel.token) || null : null);
      setGroup(current => current === 'All channels' || next.some(channel => channel.group === current) ? current : 'All channels');
    } catch {
      if (!controller.signal.aborted) setError('Could not reach the player. Please try again.');
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [clearSession]);

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (disposed) return;
      void loadChannels();
      try {
        const saved: unknown = JSON.parse(localStorage.getItem('lumanest_favorites') || '[]');
        if (Array.isArray(saved)) setFavorites(saved.filter((item): item is string => typeof item === 'string' && /^[A-Za-z0-9_-]{30,50}$/.test(item)).slice(0, 500));
      } catch {}
    });
    return () => {disposed = true; channelRequest.current?.abort();};
  }, [loadChannels]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => clearSession('Your player session expired. Please sign in again.'), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, clearSession]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const response = await fetch('/api/player/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: fields.get('username'), password: fields.get('password')})});
      const data = await response.json().catch(() => null) as ChannelResponse | null;
      if (!response.ok) throw new Error(data?.error?.message || 'Your line login could not be verified.');
      form.reset(); setShowPassword(false); await loadChannels();
    } catch (cause) {setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Sign-in failed. Please check your connection and try again.');}
    finally {setBusy(false);}
  }

  async function logout() {
    setSigningOut(true); setError('');
    channelRequest.current?.abort(); setChecking(false);
    setSelected(null);
    try {
      const response = await fetch('/api/player/logout', {method: 'POST'});
      if (!response.ok) throw new Error('Sign-out failed.');
      clearSession();
    } catch {setError('Unable to sign out. Please try again.');}
    finally {setSigningOut(false);}
  }

  function favorite(id: string) {
    setFavorites(current => {
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id].slice(-500);
      try {localStorage.setItem('lumanest_favorites', JSON.stringify(next));} catch {}
      return next;
    });
  }

  const groups = useMemo(() => Array.from(new Set(channels.map(channel => channel.group))).sort((a, b) => a.localeCompare(b)), [channels]);
  const search = query.trim().toLowerCase();
  const filtered = useMemo(() => channels.filter(channel =>
    (group === 'All channels' || channel.group === group) && (!favoriteOnly || favorites.includes(channel.id)) &&
    (!search || (channel.name + ' ' + channel.group).toLowerCase().includes(search))), [channels, group, search, favoriteOnly, favorites]);
  const playable = useMemo(() => filtered.filter(channel => channel.token), [filtered]);
  const selectedIndex = playable.findIndex(channel => channel.id === selected?.id);
  const streamFormat = selected?.token === detectedStream?.token ? detectedStream?.format : selected?.format;

  function choose(channel: Channel) {
    if (channel.id === selected?.id) setRetry(current => current + 1);
    else {setDetectedStream(null); setSelected(channel);}
    if (window.matchMedia('(max-width: 760px)').matches) viewingArea.current?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }
  function resetFilters() {setQuery(''); setGroup('All channels'); setFavoriteOnly(false); setLimit(60);}
  function stopPlayback() {
    setSelected(null); setDetectedStream(null); setPlayError('');
    setStatus('Choose a channel'); setQualities([]); setQuality(-1);
  }

  useEffect(() => {
    let transport: ReturnType<typeof mpegts.createPlayer> | null = null;
    let engine: Hls | null = null;
    let recoveredMedia = false;
    const element = video.current;
    if (!element || !selected?.token) return;
    const playbackController = new AbortController();
    const playback = createPlaybackSession(element, {
      status: setStatus, error: setPlayError,
      current: () => video.current === element && !playbackController.signal.aborted,
      finished: selected.format === 'file' ? 'Finished' : 'Stream ended',
      stop: () => {
        playbackController.abort();
        try {engine?.stopLoad();} catch {}
        try {transport?.unload();} catch {}
      },
    });
    const fail = playback.fail;
    const play = playback.play;
    startPlayback.current = play;
    setPlayError(''); setStatus('Connecting…'); setQualities([]); setQuality(-1);
    const source = '/api/player/stream?token=' + encodeURIComponent(selected.token);
    async function start() {
      try {
        if (streamFormat === 'hls') {
          if (element!.canPlayType('application/vnd.apple.mpegurl')) {element!.src = source; play();}
          else {
            const {default: Hls} = await import('hls.js');
            if (!playback.isCurrent()) return;
            if (!Hls.isSupported()) throw new Error('HLS playback is not supported in this browser. Try another browser or the Tuner app.');
            engine = new Hls({enableWorker: false, maxBufferLength: 20}); hls.current = engine;
            engine.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!playback.isCurrent() || !engine) return;
              setQualities(engine.levels.map((level, index) => ({height: level.height, index}))); play();
            });
            engine.on(Hls.Events.ERROR, (_, data) => {
              if (!data.fatal || !playback.isCurrent() || !engine) return;
              if (data.response?.code === 401) {clearSession('Your player session expired. Please sign in again.'); return;}
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
                recoveredMedia = true; setStatus('Reconnecting…'); engine.recoverMediaError(); return;
              }
              fail('This stream could not be played. Choose another channel or try again.');
            });
            engine.loadSource(source); engine.attachMedia(element!);
          }
        } else if (streamFormat === 'mpegts') {
          const {default: mpegts} = await import('mpegts.js');
          if (!playback.isCurrent()) return;
          if (!mpegts.isSupported()) throw new Error('This browser cannot play this live stream format. Try another browser or the Tuner app.');
          transport = mpegts.createPlayer({type: 'mpegts', isLive: true, url: source, withCredentials: true}, {
            enableWorker: false, enableStashBuffer: false,
            customLoader: createPlayerStreamLoader(window.location.origin, playbackController.signal, undefined, format => {
              if (playback.isCurrent()) setDetectedStream({token: selected!.token!, format});
            }),
          });
          transport.attachMediaElement(element!);
          transport.on(mpegts.Events.ERROR, (_type, _detail, info: {code?: number}) => {
            if (!playback.isCurrent()) return;
            if (info?.code === 401) {clearSession('Your player session expired. Please sign in again.'); return;}
            fail(playerStreamError(_detail, info?.code));
          });
          transport.load(); play();
        } else {element!.src = source; play();}
      } catch (cause) {fail(cause instanceof Error ? cause.message : 'Playback is unavailable. Please try again.');}
    }
    void start();
    return () => {
      playback.dispose([
        () => playbackController.abort(),
        () => {if (startPlayback.current === play) startPlayback.current = null;},
        () => {if (hls.current === engine) hls.current = null;},
        () => engine?.destroy(),
        () => transport?.unload(),
        () => transport?.detachMediaElement(),
        () => transport?.destroy(),
        () => element.pause(),
        () => {element.srcObject = null;},
        () => element.removeAttribute('src'),
        () => element.load(),
      ]);
    };
  }, [selected, retry, clearSession, streamFormat]);

  async function fullscreen() {
    const element = video.current as (HTMLVideoElement & {webkitEnterFullscreen?: () => void}) | null;
    if (!element) return;
    try {
      if (typeof element.requestFullscreen === 'function') await element.requestFullscreen();
      else if (typeof element.webkitEnterFullscreen === 'function') element.webkitEnterFullscreen();
      else setStatus('Use your video controls for fullscreen');
    } catch {setStatus('Use your video controls for fullscreen');}
  }
  const connecting = selected && !playError && ['Connecting…', 'Reconnecting…', 'Buffering…'].includes(status);

  return <div className="watch-shell">
    <SiteHeader portal={portal} current="/watch" actions={username ? <button type="button" onClick={logout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button> : undefined}/>
    {checking && !username ? <main id="main-content" className="watch-login watch-opening"><span className="watch-spinner" aria-hidden="true"/><p role="status">Opening your nest…</p></main> : !username ?
      <main id="main-content" className="watch-login">
        <section className="watch-intro"><p className="eyebrow"><i className="status-dot"/> LUMANEST WEB PLAYER</p><h1><span className="watch-headline">Your front row.</span><br/><em>Anywhere.</em></h1><p>Pick a channel. Settle in. Watch in your browser.</p><div className="watch-orbit" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 4.5a8 8 0 1 0 4 12.2 6.5 6.5 0 0 1-4-12.2Z"/><path d="M19 3v3M17.5 4.5h3"/></svg></div><div className="watch-format"><span>Live channels</span><span>Search & favorites</span><span>Fullscreen playback</span></div></section>
        <section className="watch-login-card"><p className="eyebrow">WELCOME TO YOUR NEST</p><h2>Let’s get you<br/>watching.</h2><p>Use the line username and password shown in your customer hub’s app setup details. <a className="watch-which-login" href="/#logins">Which login is this?</a></p>
          <form onSubmit={signIn} aria-busy={busy}>
            <label>Line username<input name="username" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>
            <div className="watch-password-field"><label htmlFor="line-password">Line password</label><div className="watch-password"><input id="line-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={150} autoComplete="current-password"/><button type="button" aria-controls="line-password" aria-pressed={showPassword} aria-label={showPassword ? 'Hide line password' : 'Show line password'} onClick={() => setShowPassword(current => !current)}>{showPassword ? 'Hide' : 'Show'}</button></div></div>
            <button className="button primary" disabled={busy}>{busy ? 'Checking your line…' : 'Open my channels ↗'}</button>
          </form>
          {error && <p className="watch-error" role="alert">{error}</p>}
          <a href={portal} className="watch-help">Find your line login in the customer hub ↗</a><p className="watch-privacy">An active subscription is required. <a href="/renew">Renew an expired line online ↗</a> Keep your line login private.</p>
        </section>
      </main> :
      <main id="main-content" className="watch-dashboard">
        <section className="watch-main">
          <div className="watch-title"><div><p className="eyebrow">YOUR CHANNEL. YOUR EVENING.</p><h1>Welcome home.</h1></div><span className="watch-user" title={username}>{username}</span></div>
          <div className="video-wrap" ref={viewingArea}>
            <video key={(selected?.token || 'empty') + ':' + streamFormat + ':' + retry} ref={video} aria-label={selected ? 'Watching ' + selected.name : 'LumaNest TV video player'} controls playsInline preload="none"/>
            {!selected && <div className="video-empty"><span aria-hidden="true">▶</span><h2>The night is yours.</h2><p>Choose a channel from your lineup to start watching.</p></div>}
            {connecting && <div className="watch-loading"><span className="watch-spinner" aria-hidden="true"/><span>{status}</span></div>}
            {selected && !playError && status === 'Press play to start' && <div className="watch-start"><button className="button primary" onClick={() => startPlayback.current?.()}>Play {selected.name} ▶</button></div>}
          </div>
          <div className="now-playing"><div><small>NOW PLAYING</small><h2>{selected?.name || 'Make yourself at home.'}</h2><p>{selected?.group || 'Your channels are waiting.'}</p></div><div><span className="playback-status" role="status" aria-live="polite">{selected ? status : 'Choose a channel'}</span>{selected && <><button className="small-button" onClick={stopPlayback}>Stop playback ■</button><button className="small-button" onClick={fullscreen}>Fullscreen ⛶</button></>}</div></div>
          {selected && <div className="watch-player-tools"><div className="watch-channel-navigation"><button className="small-button" aria-label="Previous channel in this lineup" disabled={selectedIndex <= 0} onClick={() => choose(playable[selectedIndex - 1])}>← Previous</button><button className="small-button" aria-label="Next channel in this lineup" disabled={selectedIndex < 0 || selectedIndex >= playable.length - 1} onClick={() => choose(playable[selectedIndex + 1])}>Next →</button></div>{qualities.length > 1 && <label className="quality-select">Picture quality<select value={quality} onChange={event => {const next = Number(event.target.value); setQuality(next); if (hls.current) hls.current.currentLevel = next;}}><option value={-1}>Automatic</option>{qualities.map(item => <option key={item.index} value={item.index}>{item.height ? item.height + 'p' : 'Quality ' + (item.index + 1)}</option>)}</select></label>}</div>}
          {playError && <div className="watch-error" role="alert"><p>{playError}</p><button className="small-button" onClick={() => setRetry(current => current + 1)}>Try this channel again</button></div>}
          <div className="watch-bottom"><p>Playback uses one of your plan’s simultaneous screens. Available channels and formats depend on your line.</p><a href={'mailto:' + support}>Need a hand? Contact support ↗</a></div>
        </section>
        <aside className="channel-panel" aria-label="Channel lineup" aria-busy={checking}>
          <div className="channel-panel-title"><h2>Your lineup</h2><button aria-label="Refresh channel list" disabled={checking || signingOut} onClick={() => {void loadChannels();}}>↻</button></div>
          <label className="search-label">Search channels<input value={query} onChange={event => {setQuery(event.target.value); setLimit(60);}} placeholder="A channel, a category…" type="search"/></label>
          <div className="channel-filters"><button aria-pressed={!favoriteOnly} onClick={() => {setFavoriteOnly(false); setLimit(60);}}>All channels</button><button aria-pressed={favoriteOnly} onClick={() => {setFavoriteOnly(true); setLimit(60);}}>★ Favorites</button></div>
          <label className="search-label">Category<select value={group} onChange={event => {setGroup(event.target.value); setLimit(60);}}><option>All channels</option>{groups.map(item => <option key={item}>{item}</option>)}</select></label>
          <p className="channel-count">{filtered.length.toLocaleString()} {filtered.length === 1 ? 'channel' : 'channels'} {checking && '· refreshing…'}</p>
          {error && <p className="watch-error" role="alert">{error}</p>}
          <div className="channel-list">
            {filtered.slice(0, limit).map(channel => <div key={channel.id} className={'channel-row ' + (selected?.id === channel.id ? 'selected' : '')}>
              <button className="channel-choice" disabled={!channel.token} aria-pressed={selected?.id === channel.id} title={channel.reason || channel.name} onClick={() => choose(channel)}><span className="channel-icon" aria-hidden="true">{channel.name.slice(0, 2).toUpperCase()}</span><span><strong>{channel.name}</strong><small>{channel.token ? channel.group : 'Stream unavailable'}</small></span>{selected?.id === channel.id && <i className="status-dot" aria-hidden="true"/>}</button>
              <button className="favorite-button" aria-label={(favorites.includes(channel.id) ? 'Remove ' : 'Add ') + channel.name + (favorites.includes(channel.id) ? ' from favorites' : ' to favorites')} aria-pressed={favorites.includes(channel.id)} onClick={() => favorite(channel.id)}>{favorites.includes(channel.id) ? '★' : '☆'}</button>
            </div>)}
            {filtered.length === 0 && <div className="no-channels"><p>{channels.length === 0 ? 'Your channel list could not be loaded.' : favoriteOnly && !query && group === 'All channels' ? 'Star a channel to add it here.' : 'No channels match these filters.'}</p>{channels.length ? <button className="small-button" onClick={resetFilters}>Show all channels</button> : <button className="small-button" disabled={checking} onClick={() => {void loadChannels();}}>Try again</button>}</div>}
            {filtered.length > limit && <button className="load-more" onClick={() => setLimit(current => current + 60)}>Show more channels ({Math.min(60, filtered.length - limit)})</button>}
          </div>
        </aside>
      </main>}
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
