'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type Hls from 'hls.js';
import type mpegts from 'mpegts.js';
import CastControls, {useCastSession} from './cast-controls';
import SubtitleControls from './subtitle-controls';
import AdultLock from './adult-lock';
import {isAdultGroup} from '../../lib/player-data';
import {createPlayerStreamLoader} from '../../lib/player-stream-loader';
import {createPlaybackSession} from '../../lib/player-playback-session';
import {playerStreamError} from '../../lib/player-error';
import {SiteFooter, SiteHeader} from '../site-chrome';

type Channel = {id: string; name: string; group: string; format: 'hls' | 'mpegts' | 'file'; token: string | null; reason: string};
type ChannelResponse = {channels?: Channel[]; username?: string; expiresAt?: number; error?: {code?: string; message: string}};

const LAST_CHANNEL_KEY = 'lumanest_last_channel';
const CHANNEL_ID = /^[A-Za-z0-9_-]{30,50}$/;
const SESSION_EXPIRED = 'Your player session expired. Please sign in again.';
const SHORTCUTS: [string, string][] = [['↑ / ↓', 'Previous or next channel in this lineup'], ['F', 'Toggle fullscreen'], ['M', 'Mute or unmute'], ['/', 'Search channels'], ['?', 'Show these shortcuts']];

/** True when a key press belongs to a text field or picker rather than to the player shortcuts. */
function typingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

export default function Player({portal, support, castAppId}: {portal: string; support: string; castAppId: string}) {
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
  const [lastChannel, setLastChannel] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [engine, setEngine] = useState<Hls | null>(null);
  // Adult categories are hidden until unlocked with this browser's passcode; unlocking lasts until the page reloads.
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  // While a channel plays on a TV, this page's own stream stays stopped (castHold) so the line serves only the TV.
  // It stays stopped after casting ends until the viewer presses play.
  const [castHold, setCastHold] = useState(false);
  const [casting, setCasting] = useState(false);
  const castEnded = useCallback(() => setCasting(false), []);
  // The Cast session is followed for the whole signed-in page: while one is live, nothing plays here.
  const {available: castAvailable, device: castDevice, checked: castChecked, stop: stopCast} = useCastSession(Boolean(username), castAppId, castEnded);
  const castLive = Boolean(castDevice);
  const video = useRef<HTMLVideoElement>(null);
  const viewingArea = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutsDialog = useRef<HTMLDialogElement>(null);
  const channelList = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const startPlayback = useRef<(() => void) | null>(null);
  const stopLocal = useRef<(() => void) | null>(null);
  const channelRequest = useRef<AbortController | null>(null);

  const clearSession = useCallback((message = '') => {
    setUsername(''); setChannels([]); setSelected(null); setDetectedStream(null); setExpiresAt(null); setCastHold(false);
    setQuery(''); setGroup('All channels'); setFavoriteOnly(false); setAdultUnlocked(false);
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
        if (response.status === 401) clearSession(data.error?.code === 'player_login_required' ? '' : data.error?.message || SESSION_EXPIRED);
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
        if (Array.isArray(saved)) setFavorites(saved.filter((item): item is string => typeof item === 'string' && CHANNEL_ID.test(item)).slice(0, 500));
      } catch {}
      try {
        const last = localStorage.getItem(LAST_CHANNEL_KEY);
        if (last && CHANNEL_ID.test(last)) setLastChannel(last);
      } catch {}
    });
    return () => {disposed = true; channelRequest.current?.abort();};
  }, [loadChannels]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => clearSession(SESSION_EXPIRED), Math.max(0, expiresAt - Date.now()));
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

  const hasAdult = useMemo(() => channels.some(channel => isAdultGroup(channel.group)), [channels]);
  // Everything below (categories, search, favorites, resume) only ever sees the channels the lock allows.
  const visible = useMemo(() => adultUnlocked || !hasAdult ? channels : channels.filter(channel => !isAdultGroup(channel.group)), [channels, adultUnlocked, hasAdult]);
  const groups = useMemo(() => Array.from(new Set(visible.map(channel => channel.group))).sort((a, b) => a.localeCompare(b)), [visible]);
  const search = query.trim().toLowerCase();
  const filtered = useMemo(() => visible.filter(channel =>
    (group === 'All channels' || channel.group === group) && (!favoriteOnly || favorites.includes(channel.id)) &&
    (!search || (channel.name + ' ' + channel.group).toLowerCase().includes(search))), [visible, group, search, favoriteOnly, favorites]);
  const playable = useMemo(() => filtered.filter(channel => channel.token), [filtered]);
  const selectedIndex = playable.findIndex(channel => channel.id === selected?.id);
  const streamFormat = selected?.token === detectedStream?.token ? detectedStream?.format : selected?.format;

  // The last channel is offered as a one-tap resume rather than started on load,
  // so opening the page never starts a stream (or uses a screen) without a gesture.
  const resume = useMemo(() => !selected && lastChannel ? visible.find(channel => channel.id === lastChannel && channel.token) || null : null, [visible, lastChannel, selected]);

  function choose(channel: Channel) {
    // While a Cast session is live, the cast controls send the new channel to the TV; otherwise it plays here again.
    setCastHold(castLive);
    if (castLive) setCasting(true);
    if (channel.id === selected?.id) setRetry(current => current + 1);
    else {setDetectedStream(null); setSelected(channel);}
    setLastChannel(channel.id);
    try {localStorage.setItem(LAST_CHANNEL_KEY, channel.id);} catch {}
    if (window.matchMedia('(max-width: 760px)').matches) viewingArea.current?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }
  function resetFilters() {setQuery(''); setGroup('All channels'); setFavoriteOnly(false); setLimit(60);}
  function stopPlayback() {
    // Stopping stops the TV too: without a selected channel the page has no cast controls left to stop it with.
    if (castLive) stopCast();
    setSelected(null); setDetectedStream(null); setPlayError(''); setCastHold(false);
    setStatus('Choose a channel'); setQualities([]); setQuality(-1);
  }
  /** Before a channel goes to a TV: tear down this page's stream now, so mpegts.js/hls.js stop downloading at once. */
  const castStarted = useCallback(() => {
    stopLocal.current?.();
    setCastHold(true); setCasting(true);
    setPlayError(''); setQualities([]); setQuality(-1);
  }, []);
  /** Locking hides adult categories at once, stopping an adult channel that is playing. */
  function lockAdult() {
    setAdultUnlocked(false);
    if (selected && isAdultGroup(selected.group)) stopPlayback();
    if (isAdultGroup(group)) setGroup('All channels');
    setAnnouncement('Adult content locked');
  }

  useEffect(() => {
    let transport: ReturnType<typeof mpegts.createPlayer> | null = null;
    let engine: Hls | null = null;
    let recoveredMedia = false;
    const element = video.current;
    if (!element || !selected?.token || castHold || castLive || !castChecked) return;
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
    const probe = new AbortController();
    // Native playback (Safari HLS, direct files) reports failures without an HTTP status. On error, ask the
    // stream endpoint whether the session itself was rejected and, if so, sign in again as the hls.js path does.
    function playNatively() {
      element!.addEventListener('error', () => {
        void fetch(source, {cache: 'no-store', headers: {Range: 'bytes=0-0'}, signal: probe.signal}).then(response => {
          void response.body?.cancel().catch(() => {});
          if (response.status === 401 && !probe.signal.aborted && video.current === element) clearSession(SESSION_EXPIRED);
        }, () => {});
      }, {once: true, signal: probe.signal});
      element!.src = source; play();
    }
    async function start() {
      try {
        if (streamFormat === 'hls') {
          // Safari plays HLS natively and picks the quality itself, so no quality selector is offered there.
          if (element!.canPlayType('application/vnd.apple.mpegurl')) playNatively();
          else {
            const {default: Hls} = await import('hls.js');
            if (!playback.isCurrent()) return;
            if (!Hls.isSupported()) throw new Error('HLS playback is not supported in this browser. Try another browser or the Tuner app.');
            // Captions (CEA-608/708) and subtitle playlists become text tracks on the video element, so the
            // browser draws them and the subtitle menu can switch them.
            engine = new Hls({enableWorker: false, maxBufferLength: 20, enableCEA708Captions: true, renderTextTracksNatively: true});
            hls.current = engine; setEngine(engine);
            engine.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!playback.isCurrent() || !engine) return;
              setQualities(engine.levels.map((level, index) => ({height: level.height, index}))); play();
            });
            engine.on(Hls.Events.ERROR, (_, data) => {
              if (!data.fatal || !playback.isCurrent() || !engine) return;
              if (data.response?.code === 401) {clearSession(SESSION_EXPIRED); return;}
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
            if (info?.code === 401) {clearSession(SESSION_EXPIRED); return;}
            fail(playerStreamError(_detail, info?.code));
          });
          transport.load(); play();
        } else playNatively();
      } catch (cause) {fail(cause instanceof Error ? cause.message : 'Playback is unavailable. Please try again.');}
    }
    void start();
    const teardown = () => playback.dispose([
      () => playbackController.abort(),
      () => probe.abort(),
      () => {if (startPlayback.current === play) startPlayback.current = null;},
      () => {if (hls.current === engine) hls.current = null;},
      () => setEngine(current => current === engine ? null : current),
      () => engine?.destroy(),
      () => transport?.unload(),
      () => transport?.detachMediaElement(),
      () => transport?.destroy(),
      () => element.pause(),
      () => {element.srcObject = null;},
      () => element.removeAttribute('src'),
      () => element.load(),
    ]);
    stopLocal.current = teardown;
    return () => {
      if (stopLocal.current === teardown) stopLocal.current = null;
      teardown();
    };
  }, [selected, retry, clearSession, streamFormat, castHold, castLive, castChecked]);

  async function fullscreen() {
    const element = video.current as (HTMLVideoElement & {webkitEnterFullscreen?: () => void}) | null;
    if (!element) return;
    try {
      if (typeof element.requestFullscreen === 'function') await element.requestFullscreen();
      else if (typeof element.webkitEnterFullscreen === 'function') element.webkitEnterFullscreen();
      else setStatus('Use your video controls for fullscreen');
    } catch {setStatus('Use your video controls for fullscreen');}
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (selected) void fullscreen();
  }
  function toggleMute() {
    const element = video.current;
    if (!element || !selected) return;
    element.muted = !element.muted;
    setAnnouncement(element.muted ? 'Sound muted' : 'Sound on');
  }
  /** Moves through the filtered lineup like the Previous/Next buttons; returns false when there is nowhere to go. */
  function step(offset: 1 | -1) {
    const target = selectedIndex >= 0 ? playable[selectedIndex + offset]
      : resume && playable.includes(resume) ? resume : playable[offset > 0 ? 0 : playable.length - 1];
    if (!target) return false;
    choose(target);
    setLimit(current => Math.max(current, filtered.indexOf(target) + 1));
    requestAnimationFrame(() => {
      const list = channelList.current;
      const row = list?.querySelector<HTMLElement>('[data-channel="' + CSS.escape(target.id) + '"]');
      if (!list || !row) return;
      const bounds = list.getBoundingClientRect(), item = row.getBoundingClientRect();
      if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
      else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
    });
    return true;
  }

  // Player shortcuts. Re-subscribed each render so the handler always sees the current lineup.
  useEffect(() => {
    if (!username) return;
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typingTarget(event.target) || document.querySelector('.watch-shell dialog[open]')) return;
      const key = event.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        // A focused video keeps its own arrow-key behaviour (seeking and volume in some browsers).
        if (event.target instanceof HTMLMediaElement || !step(key === 'ArrowDown' ? 1 : -1)) return;
      } else if (key === 'f' || key === 'F') {if (!event.repeat) toggleFullscreen();}
      else if (key === 'm' || key === 'M') {if (!event.repeat) toggleMute();}
      else if (key === '/') searchInput.current?.focus();
      else if (key === '?') shortcutsDialog.current?.showModal();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  // Local playback also waits while a Cast session is live (the channel is on its way to the TV) and, right after
  // the page loads, until Chrome has had its chance to rejoin a session that is still running.
  const castWaiting = !castHold && (castLive || !castChecked);
  const connecting = selected && !castHold && !playError && (castWaiting || ['Connecting…', 'Reconnecting…', 'Buffering…'].includes(status));
  const shownStatus = castHold ? (casting ? 'Playing on your TV' : 'Casting ended') : castWaiting ? 'Connecting…' : status;

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
            <video key={(selected?.token || 'empty') + ':' + streamFormat + ':' + retry} ref={video} aria-label={selected ? 'Watching ' + selected.name : 'LumaNest TV video player'} controls={!connecting} playsInline x-webkit-airplay="allow" preload="none"/>
            {!selected && <div className="video-empty"><span aria-hidden="true">▶</span><h2>The night is yours.</h2>{resume ? <button type="button" className="button primary watch-resume" onClick={() => choose(resume)}>Continue with {resume.name} ▶</button> : <p>Choose a channel from your lineup to start watching.</p>}</div>}
            {selected && castHold && <div className="video-empty watch-cast-hold"><span aria-hidden="true">📺</span><h2>{casting ? 'Playing on your TV' : 'Casting ended'}</h2>{casting ? <p>{selected.name} is on your TV. This screen stays off so your line streams only once.</p> : <button type="button" className="button primary watch-resume" onClick={() => setCastHold(false)}>Play {selected.name} here ▶</button>}</div>}
            {connecting && <div className="watch-loading"><span className="watch-spinner" aria-hidden="true"/><span>{shownStatus}</span></div>}
            {selected && !castHold && !castWaiting && !playError && status === 'Press play to start' && <div className="watch-start"><button className="button primary" onClick={() => startPlayback.current?.()}>Play {selected.name} ▶</button></div>}
          </div>
          <div className="now-playing"><div><small>NOW PLAYING</small><h2>{selected?.name || 'Make yourself at home.'}</h2><p>{selected?.group || 'Your channels are waiting.'}</p></div><div><span className="playback-status" role="status" aria-live="polite">{selected ? shownStatus : 'Choose a channel'}</span>{selected && <><button className="small-button" onClick={stopPlayback}>Stop playback ■</button><button className="small-button" aria-keyshortcuts="F" onClick={fullscreen}>Fullscreen ⛶</button></>}</div></div>
          {selected && <div className="watch-player-tools"><div className="watch-channel-navigation"><button className="small-button" aria-label="Previous channel in this lineup" disabled={selectedIndex <= 0} onClick={() => choose(playable[selectedIndex - 1])}>← Previous</button><button className="small-button" aria-label="Next channel in this lineup" disabled={selectedIndex < 0 || selectedIndex >= playable.length - 1} onClick={() => choose(playable[selectedIndex + 1])}>Next →</button></div>{qualities.length > 1 && <label className="quality-select">Picture quality<select value={quality} onChange={event => {const next = Number(event.target.value); setQuality(next); if (hls.current) hls.current.currentLevel = next;}}><option value={-1}>Automatic</option>{qualities.map(item => <option key={item.index} value={item.index}>{item.height ? item.height + 'p' : 'Quality ' + (item.index + 1)}</option>)}</select></label>}<SubtitleControls key={(selected.token || '') + ':' + streamFormat + ':' + retry} video={video} engine={engine} supported={streamFormat !== 'mpegts'}/>{selected.token && <CastControls token={selected.token} name={selected.name} format={streamFormat} video={video} castAppId={castAppId} castAvailable={castAvailable} castDevice={castDevice} onCastStart={castStarted} onCastStop={stopCast}/>}</div>}
          {playError && <div className="watch-error" role="alert"><p>{playError}</p><button className="small-button" onClick={() => setRetry(current => current + 1)}>Try this channel again</button></div>}
          <div className="watch-bottom"><p>Playback uses one of your plan’s simultaneous screens. Available channels and formats depend on your line.</p><div className="watch-bottom-links"><button type="button" className="watch-shortcuts-open" aria-keyshortcuts="Shift+?" onClick={() => shortcutsDialog.current?.showModal()}>Keyboard shortcuts</button>{(hasAdult || adultUnlocked) && <AdultLock unlocked={adultUnlocked} onUnlock={() => {setAdultUnlocked(true); setAnnouncement('Adult content unlocked');}} onLock={lockAdult}/>}<a href={'mailto:' + support}>Need a hand? Contact support ↗</a></div></div>
          <span className="sr-only" role="status">{announcement}</span>
          <dialog ref={shortcutsDialog} className="watch-shortcuts" aria-labelledby="watch-shortcuts-title">
            <h2 id="watch-shortcuts-title">Keyboard shortcuts</h2>
            <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
            <p>Shortcuts work while you are not typing in a field.</p>
            <form method="dialog"><button className="small-button">Close</button></form>
          </dialog>
        </section>
        <aside className="channel-panel" aria-label="Channel lineup" aria-busy={checking}>
          <div className="channel-panel-title"><h2>Your lineup</h2><button aria-label="Refresh channel list" disabled={checking || signingOut} onClick={() => {void loadChannels();}}>↻</button></div>
          <label className="search-label">Search channels<input ref={searchInput} aria-keyshortcuts="/" value={query} onChange={event => {setQuery(event.target.value); setLimit(60);}} placeholder="A channel, a category…" type="search"/></label>
          <div className="channel-filters"><button aria-pressed={!favoriteOnly} onClick={() => {setFavoriteOnly(false); setLimit(60);}}>All channels</button><button aria-pressed={favoriteOnly} onClick={() => {setFavoriteOnly(true); setLimit(60);}}>★ Favorites</button></div>
          <label className="search-label">Category<select value={group} onChange={event => {setGroup(event.target.value); setLimit(60);}}><option>All channels</option>{groups.map(item => <option key={item}>{item}</option>)}</select></label>
          <p className="channel-count">{filtered.length.toLocaleString()} {filtered.length === 1 ? 'channel' : 'channels'} {checking && '· refreshing…'}</p>
          {error && <p className="watch-error" role="alert">{error}</p>}
          <div className="channel-list" ref={channelList}>
            {filtered.slice(0, limit).map(channel => <div key={channel.id} data-channel={channel.id} className={'channel-row ' + (selected?.id === channel.id ? 'selected' : '')}>
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
