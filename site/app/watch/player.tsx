'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type Hls from 'hls.js';
import type mpegts from 'mpegts.js';
import CastControls, {useCastSession} from './cast-controls';
import SubtitleControls from './subtitle-controls';
import AdultLock from './adult-lock';
import NavRail from './nav-rail';
import LiveLineup from './live-tv';
import Home, {BrowseLoading} from './home';
import Discover from './discover';
import LibraryView from './library';
import Search from './search';
import SettingsView from './settings';
import VodControls from './vod-controls';
import {TitleDetails, PlayAside, clearDetails, seriesEpisodes, yearShown, type Episode, type PlayRequest} from './title-details';
import {closeOpenMenu} from './filter-menu';
import {findTitle} from './browse-cards';
import {useCatalogue, type Channel} from './use-catalogue';
import {useLibrary} from './use-library';
import {usePreference, REGIONS, REGION_KEY, START_VIEWS, START_KEY} from './use-preferences';
import {useWatchRoute} from './use-watch-route';
import {focusElement, keysMode, typingTarget, useSpatialNavigation} from './use-spatial-navigation';
import {normalizeRoute, routeHref, routeLabel, sameRoute, sectionOf, type Route} from './watch-route';
import {keyTargetOf, stageKey} from './player-keys';
import {MAYBE_MESSAGE, TUNER_MESSAGE, playFormat, resumable, vodPlan} from './vod-format';
import {isAdultGroup} from '../../lib/player-data';
import {foldText, libraryKeys, libraryProgress, libraryRefs, type IndexedTitle, type PickOptions} from '../../lib/browse';
import {createPlayerStreamLoader} from '../../lib/player-stream-loader';
import {createPlaybackSession} from '../../lib/player-playback-session';
import {playerStreamError} from '../../lib/player-error';
import {SiteFooter, SiteHeader} from '../site-chrome';

type ChannelResponse = {channels?: Channel[]; username?: string; expiresAt?: number; posterBases?: string[]; error?: {code?: string; message: string}};
/** What is playing: a live channel, or a movie or episode (with its Library key, episode and where to resume). */
type Playable = {
  id: string; name: string; group: string; format: 'hls' | 'mpegts' | 'file'; token: string | null; reason: string;
  kind: 'live' | 'movie' | 'episode';
  libraryKey?: string;
  episode?: {id: string; label: string; index: number};
  resumeAt?: number;
  castable?: boolean;
  ext?: string;
};

const LAST_CHANNEL_KEY = 'lumanest_last_channel';
const CHANNEL_ID = /^[A-Za-z0-9_-]{30,50}$/;
const SESSION_EXPIRED = 'Your player session expired. Please sign in again.';
const SHORTCUTS: [string, string][] = [
  ['← ↑ → ↓', 'Move between items'], ['Enter', 'Open or play'], ['Esc / Backspace', 'Go back'],
  ['PageUp / PageDown', 'Previous or next channel (also ↑ / ↓ on the video)'], ['Space / K', 'Play or pause a movie'], ['J / L', 'Back or forward 10 seconds'],
  ['F', 'Toggle fullscreen'], ['M', 'Mute or unmute'], ['/', 'Search'], ['?', 'Show these shortcuts'],
];

const live = (channel: Channel): Playable => ({id: channel.id, name: channel.name, group: channel.group, format: channel.format, token: channel.token, reason: channel.reason, kind: 'live'});
const isLiveChannel = (channel: Channel) => !channel.kind || channel.kind === 'live';
const canPlay = (type: string) => {
  try {return document.createElement('video').canPlayType(type);} catch {return '';}
};

export default function Player({portal, support, castAppId}: {portal: string; support: string; castAppId: string}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelBases, setChannelBases] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All channels');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selected, setSelected] = useState<Playable | null>(null);
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
  // From the 'Cast to TV' tap until the channel's LOAD goes out to the TV (castHold takes over then) or no session came
  // of it, this page's stream is stopped too, so the line is free when the TV connects. It plays again if the viewer
  // closed the TV picker.
  const [castPending, setCastPending] = useState(false);
  // After a channel didn't reach the TV: false when sending it again can't help (the TV can't play this channel).
  const [castRetryable, setCastRetryable] = useState(true);
  // Movies and series: starting a title, its error, and the episode that comes next once one finishes.
  const [titleBusy, setTitleBusy] = useState(false);
  // A title's failure to start, shown with that title only (its details or its player screen) until the screen changes.
  const [titleError, setTitleError] = useState<{key: string; message: string; change: number} | null>(null);
  const [nextEpisode, setNextEpisode] = useState<Episode | null>(null);
  const castEnded = useCallback(() => setCasting(false), []);
  // The Cast session is followed for the whole signed-in page: while one is live, nothing plays here.
  const {available: castAvailable, device: castDevice, checked: castChecked, stop: stopCast} = useCastSession(Boolean(username), castAppId, castEnded);
  const castLive = Boolean(castDevice);
  const video = useRef<HTMLVideoElement>(null);
  const viewingArea = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutsDialog = useRef<HTMLDialogElement>(null);
  const channelList = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const startPlayback = useRef<(() => void) | null>(null);
  const stopLocal = useRef<(() => void) | null>(null);
  const channelRequest = useRef<AbortController | null>(null);
  // Where the playing movie or episode is (seconds), kept after its stream stops, so a TV can carry on from there.
  const vodPosition = useRef(0);
  const saveProgress = useRef<(() => void) | null>(null);

  const router = useWatchRoute();
  const [region, setRegion] = usePreference(REGION_KEY, REGIONS, 'us');
  const [startView, setStartView] = usePreference(START_KEY, START_VIEWS, 'home');
  const library = useLibrary(username);

  const clearSession = useCallback((message = '') => {
    setUsername(''); setChannels([]); setChannelBases([]); setSelected(null); setDetectedStream(null); setExpiresAt(null); setCastHold(false);
    setQuery(''); setGroup('All channels'); setFavoriteOnly(false); setAdultUnlocked(false);
    setPlayError(''); setStatus('Choose a channel'); setError(message); setTitleError(null); setNextEpisode(null);
    clearDetails();
  }, []);
  const catalogue = useCatalogue({username, channels, channelBases, onSignedOut: message => clearSession(message || SESSION_EXPIRED)});
  const catalog = catalogue.state.catalog;

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
      setChannels(next); setChannelBases(data.posterBases || []); setUsername(data.username || ''); setExpiresAt(data.expiresAt || null);
      setSelected(current => {
        if (!current) return null;
        if (current.kind !== 'live') return current;
        const found = next.find(channel => channel.id === current.id && channel.token);
        return found ? live(found) : null;
      });
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
      window.scrollTo(0, 0);
    } catch (cause) {setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Sign-in failed. Please check your connection and try again.');}
    finally {setBusy(false);}
  }

  async function logout() {
    setSigningOut(true); setError('');
    channelRequest.current?.abort(); setChecking(false);
    saveProgress.current?.();
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

  // ---------------------------------------------------------------- the lineup (Live TV)
  // Movie and series entries of the playlist are titles (Home, Discover…), not channels.
  const liveChannels = useMemo(() => channels.filter(isLiveChannel), [channels]);
  const catalogueAdult = useMemo(() => Boolean(catalog && (catalog.movies.items.some(item => item.adult) || catalog.series.items.some(item => item.adult))), [catalog]);
  const hasAdult = useMemo(() => catalogueAdult || liveChannels.some(channel => isAdultGroup(channel.group)), [liveChannels, catalogueAdult]);
  // Everything below (categories, search, favorites, resume) only ever sees the channels the lock allows.
  const visible = useMemo(() => adultUnlocked || !hasAdult ? liveChannels : liveChannels.filter(channel => !isAdultGroup(channel.group)), [liveChannels, adultUnlocked, hasAdult]);
  const groups = useMemo(() => Array.from(new Set(visible.map(channel => channel.group))).sort((a, b) => a.localeCompare(b)), [visible]);
  // Ignoring case and accents, as Search does.
  const search = foldText(query.trim());
  const filtered = useMemo(() => visible.filter(channel =>
    (group === 'All channels' || channel.group === group) && (!favoriteOnly || favorites.includes(channel.id)) &&
    (!search || foldText(channel.name + ' ' + channel.group).includes(search))), [visible, group, search, favoriteOnly, favorites]);
  const playable = useMemo(() => filtered.filter(channel => channel.token), [filtered]);
  const selectedIndex = selected?.kind === 'live' ? playable.findIndex(channel => channel.id === selected.id) : -1;
  const streamFormat = selected?.token === detectedStream?.token ? detectedStream?.format : selected?.format;

  // The last channel is offered as a one-tap resume rather than started on load,
  // so opening the page never starts a stream (or uses a screen) without a gesture.
  const resume = useMemo(() => !selected && lastChannel ? visible.find(channel => channel.id === lastChannel && channel.token) || null : null, [visible, lastChannel, selected]);

  // ---------------------------------------------------------------- screens
  // A catalogue that failed to load keeps the browse screens, so Home can say so and offer Try again.
  const caps = useMemo(() => ({titles: catalogue.state.status !== 'ready' || catalogue.state.count > 0 || Boolean(catalogue.state.error), tmdb: catalogue.state.withTmdb}), [catalogue.state.status, catalogue.state.count, catalogue.state.error, catalogue.state.withTmdb]);
  const route: Route | null = router.route === undefined ? null : normalizeRoute(router.route, caps, startView);
  const view = route?.view || 'live';
  const stageView = view === 'live' || view === 'play';
  const opts = useMemo<PickOptions>(() => ({usOnly: region === 'us', adultOk: adultUnlocked}), [region, adultUnlocked]);
  const continueRefs = useMemo(() => catalog ? libraryRefs(libraryKeys(library.library.prog), catalog, opts) : [], [catalog, library.library.prog, opts]);
  const playingTitle = selected?.libraryKey ? findTitle(catalog, selected.libraryKey) : null;

  const go = useCallback((next: Route, focusKey?: string, replace?: boolean) => {
    router.navigate(next, {replace, focusKey: focusKey ?? (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? ''});
  }, [router]);
  // The poster's own focus key (row and title), so Back focuses the poster that was chosen, in the row it was in.
  const openTitle = useCallback((key: string, focusKey?: string) => go({view: 'title', key}, focusKey), [go]);

  function choose(item: Playable) {
    // While a Cast session is live, the cast controls send the new channel to the TV; otherwise it plays here again.
    setCastHold(castLive);
    if (castLive) setCasting(true);
    if (item.id === selected?.id && item.token === selected.token) setRetry(current => current + 1);
    else {setDetectedStream(null); setSelected(item);}
    if (item.kind === 'live') {
      setLastChannel(item.id);
      try {localStorage.setItem(LAST_CHANNEL_KEY, item.id);} catch {}
    }
    if (item.kind === 'live' && window.matchMedia('(max-width: 760px)').matches) viewingArea.current?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }
  function chooseChannel(channel: Channel) {choose(live(channel));}
  function resetFilters() {setQuery(''); setGroup('All channels'); setFavoriteOnly(false); setLimit(60);}
  function stopPlayback() {
    // Stopping stops the TV too: without a selected channel the page has no cast controls left to stop it with.
    if (castLive) stopCast();
    setSelected(null); setDetectedStream(null); setPlayError(''); setCastHold(false); setNextEpisode(null);
    setStatus('Choose a channel'); setQualities([]); setQuality(-1);
  }
  /** Before a channel goes to a TV: tear down this page's stream now, so mpegts.js/hls.js stop downloading at once. */
  const castStarted = useCallback(() => {
    stopLocal.current?.();
    setCastHold(true); setCasting(true); setCastRetryable(true);
    setPlayError(''); setQualities([]); setQuality(-1);
  }, []);
  /**
   * The channel didn't reach the TV, but the Cast session goes on; nothing plays here. The page offers to send it again
   * or, when the TV can't play it, to play it here instead.
   */
  const castFailed = useCallback((retryable: boolean) => {setCastHold(true); setCasting(false); setCastRetryable(retryable);}, []);
  /**
   * Plays the selected channel here after casting ended, or instead of on the TV when the TV can't play it. That ends
   * the Cast session first, so the line streams only once.
   */
  function playHere() {
    if (castLive) stopCast();
    if (selected && selected.kind !== 'live') setSelected({...selected, resumeAt: vodPosition.current});
    setCastHold(false);
  }
  /** Sending a channel found the player session expired: sign in again. The TV keeps playing what it has. */
  const castSignedOut = useCallback(() => clearSession(SESSION_EXPIRED), [clearSession]);
  /** Locking hides adult categories at once, stopping an adult channel or title that is playing. */
  function lockAdult() {
    setAdultUnlocked(false);
    if (selected && (selected.kind === 'live' ? isAdultGroup(selected.group) : playingTitle?.adult)) stopPlayback();
    if (isAdultGroup(group)) setGroup('All channels');
    setAnnouncement('Adult content locked');
  }

  // Leaving the player for another screen stops what plays here (a movie's place is saved first); casting goes on.
  useEffect(() => {
    if (!selected || castHold || castLive || castPending || router.route === undefined) return;
    const keep = selected.kind === 'live' ? view === 'live' : view === 'play';
    if (keep) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      saveProgress.current?.();
      setSelected(null); setDetectedStream(null); setPlayError(''); setNextEpisode(null);
      setStatus('Choose a channel'); setQualities([]); setQuality(-1);
    });
    return () => {cancelled = true;};
  }, [view, selected, castHold, castLive, castPending, router.route]);

  // The player screen with nothing to play (a reload, Forward, or playback stopped) shows the title's details instead.
  const playRouteKey = route?.view === 'play' ? route.key : '';
  useEffect(() => {
    if (!playRouteKey || (selected && selected.libraryKey === playRouteKey)) return;
    let cancelled = false;
    void Promise.resolve().then(() => {if (!cancelled) router.navigate({view: 'title', key: playRouteKey}, {replace: true});});
    return () => {cancelled = true;};
  }, [playRouteKey, selected, router]);

  // After a screen change: Back puts focus back where it was; a change made with keys focuses the new screen's first
  // item; a change made with a pointer is announced and focus stays put.
  const routeRef = useRef(route);
  useEffect(() => {routeRef.current = route;});

  // An address the line can't show as it is (Popular without TMDB, say) is corrected in place once the catalogue is
  // known, so a reload or a shared link shows what the screen shows.
  const correctedHref = route && router.route && catalogue.state.status === 'ready' && !sameRoute(router.route, route) ? routeHref(route) : '';
  useEffect(() => {
    if (!correctedHref) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      const next = routeRef.current;
      if (!cancelled && next && routeHref(next) === correctedHref) router.navigate(next, {replace: true, silent: true});
    });
    return () => {cancelled = true;};
  }, [correctedHref, router]);
  useEffect(() => {
    if (!router.changes) return;
    const keys = shell.current?.dataset.input === 'keys';
    const frame = requestAnimationFrame(() => {
      const route = routeRef.current;
      if (!route) return;
      const restore = router.restoreKey ? document.querySelector<HTMLElement>('[data-focus-key="' + CSS.escape(router.restoreKey) + '"]') : null;
      if (restore) {focusElement(restore); return;}
      // A new screen starts at the top (Back instead brings the poster or button it left from into view).
      window.scrollTo(0, 0);
      // Focus that is still on something in the new screen (a filter just used, say) stays there.
      const active = document.activeElement as HTMLElement | null;
      const kept = active && active !== document.body && active.isConnected && !active.closest('[data-nav-rail]') && active.getBoundingClientRect().height > 0;
      if (keys && !kept) {
        const shown = (element: HTMLElement) => element.getBoundingClientRect().height > 0 && !element.closest('[hidden], [tabindex="-1"], [aria-hidden="true"]');
        const start = Array.from(document.querySelectorAll<HTMLElement>('#main-content [data-nav-start]:not([disabled])')).find(shown) ||
          Array.from(document.querySelectorAll<HTMLElement>('#main-content button:not([disabled]), #main-content a[href], #main-content input, #main-content [tabindex="0"]')).find(shown);
        if (start) focusElement(start);
      }
      setAnnouncement(routeLabel(route));
    });
    return () => cancelAnimationFrame(frame);
  }, [router.changes, router.restoreKey]);

  // ---------------------------------------------------------------- movies and episodes
  type ProgressActions = {save: (item: Playable, time: number, duration: number) => void; watched: (item: Playable) => void; finished: (item: Playable, duration: number) => void};
  const progressActions = useRef<ProgressActions>({save: () => {}, watched: () => {}, finished: () => {}});
  useEffect(() => {
    progressActions.current = {
      save(item, time, duration) {
        if (!item.libraryKey) return;
        library.recordProgress({k: item.libraryKey, p: time, d: duration, ...(item.episode ? {e: item.episode.id, l: item.episode.label, n: item.episode.index} : {})});
      },
      watched(item) {if (item.libraryKey) library.recordWatched(item.libraryKey);},
      finished(item, duration) {
        if (!item.libraryKey) return;
        const episodes = item.episode ? seriesEpisodes(item.libraryKey) : null;
        const next = item.episode && episodes ? episodes.find(episode => episode.index === item.episode!.index + 1) : undefined;
        if (next) {
          library.recordProgress({k: item.libraryKey, e: next.id, l: next.label, n: next.index, p: 0, d: 0, nx: true});
          setNextEpisode(next);
        } else library.recordProgress({k: item.libraryKey, p: duration, d: duration});
      },
    };
  });

  async function playTitle(title: IndexedTitle, request: PlayRequest) {
    const failed = (message: string) => setTitleError({key: title.key, message, change: router.changes});
    setTitleError(null);
    const episode = request.episode;
    const ext = episode ? episode.ext : title.ext;
    const plan = vodPlan(ext, canPlay);
    if (plan.mode === 'tuner') {failed(TUNER_MESSAGE); return;}
    let token: string | null = null;
    // A playlist title (or a playlist episode of a series made from the playlist) plays its channel's token.
    const channelId = episode?.channel || title.channel;
    if (channelId) token = channels.find(channel => channel.id === channelId)?.token || null;
    else {
      setTitleBusy(true);
      try {
        const response = await fetch('/api/player/vod/play', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: episode ? 'episode' : 'movie', id: episode ? episode.id : title.id, ext})});
        const data = await response.json().catch(() => null) as {token?: string; error?: {code?: string; message?: string}} | null;
        if (!response.ok || !data?.token) {
          if (response.status === 401 && data?.error?.code?.startsWith('player_')) {clearSession(SESSION_EXPIRED); return;}
          failed(data?.error?.message || 'This title could not be started. Please try again.');
          return;
        }
        token = data.token;
      } catch {failed('Could not reach the player. Check your connection and try again.'); return;}
      finally {setTitleBusy(false);}
    }
    if (!token) {failed('This title is unavailable in the web player. Try the Tuner app.'); return;}
    const progress = libraryProgress(library.library, title.key);
    const resumeAt = request.startOver || !progress || progress.nx || (episode && progress.e !== episode.id) ? 0 : progress.p;
    vodPosition.current = resumeAt;
    setNextEpisode(null);
    choose({
      id: 'vod:' + title.key + (episode ? ':' + episode.id : ''), name: title.name,
      group: episode ? episode.label + (episode.title ? ' · ' + episode.title : '') : yearShown(title.name, title.year) || (title.kind === 'episode' ? 'Episode' : 'Movie'),
      format: playFormat(plan.mode), token, reason: '', kind: title.kind === 'movie' ? 'movie' : 'episode', libraryKey: title.key,
      episode: episode ? {id: episode.id, label: episode.label, index: episode.index} : undefined, resumeAt, castable: plan.castable, ext,
    });
    go({view: 'play', key: title.key, ...(episode ? {ep: episode.id} : {})}, request.episode ? 'episode:' + request.episode.id : 'action:play');
  }

  // A tab put away or closed keeps the movie's place.
  useEffect(() => {
    const save = () => saveProgress.current?.();
    const hidden = () => {if (document.visibilityState === 'hidden') save();};
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', hidden);
    return () => {window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', hidden);};
  }, []);

  // ---------------------------------------------------------------- playback
  useEffect(() => {
    let transport: ReturnType<typeof mpegts.createPlayer> | null = null;
    let engine: Hls | null = null;
    let recoveredMedia = false;
    const element = video.current;
    if (!element || !selected?.token || castHold || castLive || castPending || !castChecked) return;
    const item = selected;
    const vod = item.kind !== 'live';
    const playbackController = new AbortController();
    const playback = createPlaybackSession(element, {
      status: setStatus, error: setPlayError,
      current: () => video.current === element && !playbackController.signal.aborted,
      finished: vod || item.format === 'file' ? 'Finished' : 'Stream ended',
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
    const source = '/api/player/stream?token=' + encodeURIComponent(item.token!);
    const probe = new AbortController();
    // Movies and episodes: resume where they were, and keep the place in the Library while they play.
    let finished = false, watched = false, lastSaved = 0;
    const save = () => {
      if (!vod || finished) return;
      const time = element.currentTime, duration = element.duration;
      if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 || time <= 0) return;
      vodPosition.current = time;
      progressActions.current.save(item, time, duration);
    };
    // The same rule as the Library's (libraryRecordProgress): a place from 15 seconds up to 95% through is resumed.
    const onMetadata = () => {
      const at = item.resumeAt || 0;
      if (resumable(at, element.duration)) element.currentTime = at;
    };
    const onTime = () => {
      if (element.currentTime > 0) vodPosition.current = element.currentTime;
      if (!watched && element.currentTime >= 15) {watched = true; progressActions.current.watched(item);}
      if (Date.now() - lastSaved >= 10000) {lastSaved = Date.now(); save();}
    };
    const onPause = () => {if (!element.ended) save();};
    const onEnded = () => {
      if (finished) return;
      finished = true;
      progressActions.current.finished(item, Number.isFinite(element.duration) ? element.duration : 0);
    };
    if (vod) {
      element.addEventListener('loadedmetadata', onMetadata, {once: true, signal: probe.signal});
      element.addEventListener('timeupdate', onTime, {signal: probe.signal});
      element.addEventListener('pause', onPause, {signal: probe.signal});
      element.addEventListener('ended', onEnded, {signal: probe.signal});
      saveProgress.current = save;
    }
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
              fail(vod ? 'This title could not be played. Try again, or use the Tuner app.' : 'This stream could not be played. Choose another channel or try again.');
            });
            engine.loadSource(source); engine.attachMedia(element!);
          }
        } else if (streamFormat === 'mpegts') {
          const {default: mpegts} = await import('mpegts.js');
          if (!playback.isCurrent()) return;
          if (!mpegts.isSupported()) throw new Error('This browser cannot play this live stream format. Try another browser or the Tuner app.');
          // A movie or episode in MPEG-TS is a file: not live, so it can be paused and (as far as the file allows) sought.
          transport = mpegts.createPlayer({type: 'mpegts', isLive: !vod, url: source, withCredentials: true}, {
            enableWorker: false, enableStashBuffer: vod,
            customLoader: createPlayerStreamLoader(window.location.origin, playbackController.signal, undefined, format => {
              if (playback.isCurrent()) setDetectedStream({token: item.token!, format});
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
      () => save(),
      () => {if (saveProgress.current === save) saveProgress.current = null;},
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
  }, [selected, retry, clearSession, streamFormat, castHold, castLive, castPending, castChecked]);

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
    else if (selected && stageView) void fullscreen();
  }
  function toggleMute() {
    const element = video.current;
    if (!element || !selected) return;
    element.muted = !element.muted;
    setAnnouncement(element.muted ? 'Sound muted' : 'Sound on');
  }
  function togglePlay() {
    const element = video.current;
    if (!element || !selected) return;
    if (!element.paused) element.pause();
    else if (startPlayback.current) startPlayback.current();
    else void element.play().catch(() => {});
  }
  function seekBy(seconds: number) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.max(0, Math.min(element.duration - 1, element.currentTime + seconds));
  }
  /** Moves through the filtered lineup like the Previous/Next buttons; returns false when there is nowhere to go. */
  function step(offset: 1 | -1) {
    const target = selectedIndex >= 0 ? playable[selectedIndex + offset]
      : resume && playable.includes(resume) ? resume : playable[offset > 0 ? 0 : playable.length - 1];
    if (!target) return false;
    chooseChannel(target);
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

  // Player shortcuts; arrow keys otherwise move focus (use-spatial-navigation). Back keys go back a screen.
  function shortcut(event: KeyboardEvent) {
    if (!username || typingTarget(event.target) || document.querySelector('.watch-shell dialog[open]')) return false;
    const key = event.key;
    const vodPlaying = Boolean(selected && selected.kind !== 'live' && view === 'play');
    if (document.fullscreenElement && selected) {
      if (vodPlaying && (key === 'ArrowLeft' || key === 'ArrowRight')) {seekBy(key === 'ArrowLeft' ? -10 : 10); return true;}
      if (!vodPlaying && view === 'live' && (key === 'ArrowUp' || key === 'ArrowDown')) {step(key === 'ArrowDown' ? 1 : -1); return true;}
    }
    // Only the video box itself (focused) changes channel with ↑/↓ or plays and pauses with Enter/Space; a button over
    // the video (Next episode, Send to your TV) does what it says, and with nothing focused, arrows move focus.
    const action = stageKey(key, keyTargetOf(event.target), view, vodPlaying);
    if (action === 'next' || action === 'previous') return step(action === 'next' ? 1 : -1);
    if (action === 'toggle') {togglePlay(); return true;}
    if (view === 'live') {
      if (key === 'PageDown' || key === 'ChannelDown') {step(1); return true;}
      if (key === 'PageUp' || key === 'ChannelUp') {step(-1); return true;}
    }
    if (vodPlaying) {
      if (key === 'k' || key === 'K' || key === 'MediaPlayPause') {togglePlay(); return true;}
      if (key === 'j' || key === 'J' || key === 'MediaRewind') {seekBy(-10); return true;}
      if (key === 'l' || key === 'L' || key === 'MediaFastForward') {seekBy(10); return true;}
    }
    if (key === 'f' || key === 'F') {if (!event.repeat) toggleFullscreen(); return true;}
    if (key === 'm' || key === 'M') {if (!event.repeat) toggleMute(); return true;}
    if (key === '/') {
      if (view === 'live') searchInput.current?.focus();
      else if (view !== 'search') go({view: 'search', q: ''});
      return true;
    }
    if (key === '?') {shortcutsDialog.current?.showModal(); return true;}
    return false;
  }
  // Signed out too, so the sign-in form can be filled in with a remote.
  useSpatialNavigation({enabled: true, onKey: shortcut, onBack: () => {if (username) router.back();}, closeOverlay: closeOpenMenu});

  // When a movie or episode ends and Next episode appears, a remote's focus (on the video, or nowhere) moves to it.
  const nextButton = useRef<HTMLButtonElement>(null);
  const nextShown = Boolean(selected && selected.kind !== 'live' && !castHold && status === 'Finished' && nextEpisode && playingTitle);
  useEffect(() => {
    if (!nextShown || !keysMode()) return;
    const active = document.activeElement;
    if (nextButton.current && (!active || active === document.body || active.closest('[data-stage]'))) focusElement(nextButton.current);
  }, [nextShown]);

  // ---------------------------------------------------------------- rendering
  // Local playback also waits while a Cast session is live or starting (the channel is on its way to the TV) and,
  // right after the page loads, until Chrome has had its chance to rejoin a session that is still running.
  const castWaiting = !castHold && (castLive || castPending || !castChecked);
  const connecting = selected && !castHold && !playError && (castWaiting || ['Connecting…', 'Reconnecting…', 'Buffering…'].includes(status));
  const shownStatus = castHold ? (casting ? 'Playing on your TV' : castLive ? 'Not on your TV' : 'Casting ended') : castPending ? 'Connecting to your TV…' : castWaiting ? 'Connecting…' : status;
  const vodSelected = Boolean(selected && selected.kind !== 'live');
  // The player stays mounted (hidden) while a channel or title plays on a TV and the viewer browses, so the cast
  // controls keep track of what is on the TV.
  const stageMounted = stageView || Boolean(selected && (castHold || castLive));
  const section = route ? sectionOf(route, router.from) : 'live';
  const adultLock = (hasAdult || adultUnlocked) ? <AdultLock unlocked={adultUnlocked} onUnlock={() => {setAdultUnlocked(true); setAnnouncement('Adult content unlocked');}} onLock={lockAdult}/> : null;
  const posters = catalogue.state.posters;
  const browseBase = catalog ? {catalog, library: library.library, posters, opts, withTmdb: catalogue.state.withTmdb, onOpen: openTitle, onNavigate: go, error: catalogue.state.error, onRetry: catalogue.retry} : null;

  const shownError = (key: string) => titleError && titleError.key === key && titleError.change === router.changes ? titleError.message : '';
  const browseView = route && !stageView ? route : null;
  const browseTitle = browseView?.view === 'title' ? findTitle(catalog, browseView.key) : null;
  const catalogueReady = Boolean(browseBase) && catalogue.state.status === 'ready';
  const onSearchChannel = (channel: Channel) => {chooseChannel(channel); go({view: 'live'}, 'channel:' + channel.id);};
  const onTitlePlay = (request: PlayRequest) => {if (browseTitle) void playTitle(browseTitle, request);};
  const onTitleFavorite = () => {
    if (!browseTitle) return;
    const added = library.toggleFavorite(browseTitle.key);
    setAnnouncement(added ? 'Added to your Library' : 'Removed from your Library');
  };

  const castBar = !stageView && selected && (castHold || castLive) ? <div className="watch-cast-bar" role="status">
    <span>📺 {casting && castDevice ? 'Playing on ' + castDevice : 'Cast'}: {selected.name}</span>
    <button type="button" className="small-button" onClick={() => go(selected.kind === 'live' ? {view: 'live'} : {view: 'play', key: selected.libraryKey || '', ...(selected.episode ? {ep: selected.episode.id} : {})})}>Open</button>
    {castLive && <button type="button" className="small-button" onClick={stopCast}>Stop casting</button>}
  </div> : null;

  // The header's "Skip to content" link focuses the content's first item without a #fragment history entry (which
  // Back would otherwise step through as a screen).
  const skipToContent = (event: React.MouseEvent) => {
    const link = (event.target as Element).closest?.('a[href="#main-content"]');
    const main = document.getElementById('main-content');
    if (!link || !main) return;
    event.preventDefault();
    const shown = (element: HTMLElement) => element.getBoundingClientRect().height > 0 && !element.closest('[hidden], [tabindex="-1"], [aria-hidden="true"]');
    const first = Array.from(main.querySelectorAll<HTMLElement>('[data-nav-start]:not([disabled])')).find(shown) ||
      Array.from(main.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]')).find(shown);
    if (first) focusElement(first);
    else main.scrollIntoView({block: 'start'});
  };

  return <div className="watch-shell" ref={shell} data-input="pointer" onClickCapture={skipToContent} onPointerDown={() => {if (shell.current) shell.current.dataset.input = 'pointer';}} onKeyDown={() => {if (shell.current) shell.current.dataset.input = 'keys';}}>
    <SiteHeader portal={portal} current="/watch" actions={username ? <button type="button" onClick={logout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button> : undefined}/>
    {checking && !username ? <main id="main-content" className="watch-login watch-opening"><span className="watch-spinner" aria-hidden="true"/><p role="status">Opening your nest…</p></main> : !username ?
      <main id="main-content" className="watch-login" data-nav-root="">
        <section className="watch-intro"><p className="eyebrow"><i className="status-dot"/> LUMANEST WEB PLAYER</p><h1><span className="watch-headline">Your front row.</span><br/><em>Anywhere.</em></h1><p>Live channels, movies and series. Settle in. Watch in your browser.</p><div className="watch-orbit" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 4.5a8 8 0 1 0 4 12.2 6.5 6.5 0 0 1-4-12.2Z"/><path d="M19 3v3M17.5 4.5h3"/></svg></div><div className="watch-format"><span>Live channels</span><span>Movies & series</span><span>Search & favorites</span></div></section>
        <section className="watch-login-card"><p className="eyebrow">WELCOME TO YOUR NEST</p><h2>Let’s get you<br/>watching.</h2><p>Use the line username and password shown in your customer hub’s app setup details. <a className="watch-which-login" href="/#logins">Which login is this?</a></p>
          <form onSubmit={signIn} aria-busy={busy}>
            <label>Line username<input name="username" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false} data-nav-start=""/></label>
            <div className="watch-password-field"><label htmlFor="line-password">Line password</label><div className="watch-password"><input id="line-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={150} autoComplete="current-password"/><button type="button" aria-controls="line-password" aria-pressed={showPassword} aria-label={showPassword ? 'Hide line password' : 'Show line password'} onClick={() => setShowPassword(current => !current)}>{showPassword ? 'Hide' : 'Show'}</button></div></div>
            <button className="button primary" disabled={busy}>{busy ? 'Checking your line…' : 'Open my channels ↗'}</button>
          </form>
          {error && <p className="watch-error" role="alert">{error}</p>}
          <a href={portal} className="watch-help">Find your line login in the customer hub ↗</a><p className="watch-privacy">An active subscription is required. <a href="/renew">Renew an expired line online ↗</a> Keep your line login private.</p>
        </section>
      </main> :
      <div className="watch-app" data-nav-root="">
        <NavRail current={section} titles={caps.titles} onNavigate={(next, focusKey) => go(next, focusKey)}/>
        <main id="main-content" className="watch-view">
          {castBar}
          {stageMounted && <div className="watch-dashboard" hidden={!stageView}>
            <section className="watch-main">
              {view === 'play' && selected && vodSelected ? <div className="watch-title watch-title-play">
                <button type="button" className="small-button watch-back" onClick={router.back}>← Back</button>
                <div><p className="eyebrow">NOW PLAYING</p><h1>{selected.name}</h1>{selected.group && selected.group !== selected.name && <p className="watch-title-sub">{selected.group}</p>}</div>
              </div> : <div className="watch-title"><div><p className="eyebrow">YOUR CHANNEL. YOUR EVENING.</p><h1>Welcome home.</h1></div><span className="watch-user" title={username}>{username}</span></div>}
              <div className="video-wrap" ref={viewingArea} data-stage="" tabIndex={0} role="group" aria-label={selected ? (vodSelected ? 'Video: ' : 'Live TV: ') + selected.name : 'Video player'} data-nav-start={selected && !castHold ? '' : undefined}>
                <video key={(selected?.token || 'empty') + ':' + streamFormat + ':' + retry} ref={video} aria-label={selected ? 'Watching ' + selected.name : 'LumaNest TV video player'} controls={!connecting} playsInline x-webkit-airplay="allow" preload="none"/>
                {!selected && <div className="video-empty"><span aria-hidden="true">▶</span><h2>The night is yours.</h2>{resume ? <button type="button" className="button primary watch-resume" data-nav-start="" onClick={() => chooseChannel(resume)}>Continue with {resume.name} ▶</button> : <p>Choose a channel from your lineup to start watching.</p>}</div>}
                {selected && castHold && <div className="video-empty watch-cast-hold"><span aria-hidden="true">📺</span><h2>{shownStatus}</h2>{casting ? <p>{selected.name} is on your TV. This screen stays off so your line streams only once.</p> : castLive && castRetryable ? <button type="button" className="button primary watch-resume" onClick={() => choose(selected)}>Send {selected.name} to your TV ▶</button> : <button type="button" className="button primary watch-resume" onClick={playHere}>Play {selected.name} here ▶</button>}</div>}
                {connecting && <div className="watch-loading"><span className="watch-spinner" aria-hidden="true"/><span>{shownStatus}</span></div>}
                {selected && !castHold && !castWaiting && !playError && status === 'Press play to start' && <div className="watch-start"><button className="button primary" onClick={() => startPlayback.current?.()}>Play {selected.name} ▶</button></div>}
                {nextShown && nextEpisode && playingTitle && <div className="watch-start"><button ref={nextButton} type="button" className="button primary" data-nav-start="" aria-disabled={titleBusy || undefined} onClick={() => {if (!titleBusy) void playTitle(playingTitle, {episode: nextEpisode, tryAnyway: vodPlan(nextEpisode.ext, canPlay).mode === 'maybe'});}}>Next episode: {nextEpisode.label} ▶</button></div>}
              </div>
              <div className="now-playing">{vodSelected ? <div/> : <div><small>NOW PLAYING</small><h2>{selected?.name || 'Make yourself at home.'}</h2><p>{selected?.group || 'Your channels are waiting.'}</p></div>}<div><span className="playback-status" role="status" aria-live="polite">{selected ? shownStatus : 'Choose a channel'}</span>{selected && <><button className="small-button" onClick={stopPlayback}>Stop playback ■</button><button className="small-button" aria-keyshortcuts="F" onClick={fullscreen}>Fullscreen ⛶</button></>}</div></div>
              {selected && vodSelected && !castHold && <VodControls video={video} mediaKey={(selected.token || '') + ':' + retry}/>}
              {selected && <div className="watch-player-tools">
                {!vodSelected && <div className="watch-channel-navigation"><button className="small-button" aria-label="Previous channel in this lineup" aria-keyshortcuts="PageUp" disabled={selectedIndex <= 0} onClick={() => chooseChannel(playable[selectedIndex - 1])}>← Previous</button><button className="small-button" aria-label="Next channel in this lineup" aria-keyshortcuts="PageDown" disabled={selectedIndex < 0 || selectedIndex >= playable.length - 1} onClick={() => chooseChannel(playable[selectedIndex + 1])}>Next →</button></div>}
                {qualities.length > 1 && <label className="quality-select">Picture quality<select value={quality} onChange={event => {const next = Number(event.target.value); setQuality(next); if (hls.current) hls.current.currentLevel = next;}}><option value={-1}>Automatic</option>{qualities.map(item => <option key={item.index} value={item.index}>{item.height ? item.height + 'p' : 'Quality ' + (item.index + 1)}</option>)}</select></label>}
                <SubtitleControls key={(selected.token || '') + ':' + streamFormat + ':' + retry} video={video} engine={engine} supported={streamFormat !== 'mpegts'}/>
                {selected.token && <CastControls channel={selected.id} token={selected.token} name={selected.name} format={streamFormat} attempt={retry} video={video} castAppId={castAppId} castAvailable={castAvailable} castDevice={castDevice} onCastPending={setCastPending} onCastStart={castStarted} onCastFailed={castFailed} onSessionExpired={castSignedOut} onCastStop={stopCast}
                  castable={selected.kind === 'live' || selected.castable !== false} vod={vodSelected} position={() => vodPosition.current}/>}
              </div>}
              {view === 'play' && playingTitle && shownError(playingTitle.key) && <p className="watch-error" role="alert">{shownError(playingTitle.key)}</p>}
              {playError && <div className="watch-error" role="alert"><p>{playError}</p>{vodSelected && selected?.ext === 'mkv' && <p>{MAYBE_MESSAGE} <a href="/apps">Get the Tuner app ↗</a></p>}<button className="small-button" onClick={() => setRetry(current => current + 1)}>{vodSelected ? 'Try again' : 'Try this channel again'}</button></div>}
              <div className="watch-bottom"><p>Playback uses one of your plan’s simultaneous screens. Available channels and formats depend on your line.</p><div className="watch-bottom-links"><button type="button" className="watch-shortcuts-open" aria-keyshortcuts="Shift+?" onClick={() => shortcutsDialog.current?.showModal()}>Keyboard shortcuts</button>{adultLock}<a href={'mailto:' + support}>Need a hand? Contact support ↗</a></div></div>
            </section>
            {view === 'play' && playingTitle ? <PlayAside title={playingTitle} episodeId={selected?.episode?.id} library={library.library} posters={posters}
              onPlay={request => void playTitle(playingTitle, request)} onToggleFavorite={() => library.toggleFavorite(playingTitle.key)} onDetails={() => go({view: 'title', key: playingTitle.key})}/> :
              <LiveLineup channels={liveChannels} filtered={filtered} groups={groups} checking={checking} signingOut={signingOut} error={error} query={query} group={group} favoriteOnly={favoriteOnly} favorites={favorites} limit={limit}
                selectedId={selected?.kind === 'live' ? selected.id : undefined} searchInput={searchInput} channelList={channelList} onRefresh={() => {void loadChannels();}}
                onQuery={value => {setQuery(value); setLimit(60);}} onGroup={value => {setGroup(value); setLimit(60);}} onFavoriteOnly={value => {setFavoriteOnly(value); setLimit(60);}}
                onMore={() => setLimit(current => current + 60)} onReset={resetFilters} onChoose={chooseChannel} onFavorite={favorite}/>}
          </div>}
          {browseView?.view === 'settings' && <SettingsView username={username} expiresAt={expiresAt} region={region} onRegion={value => {setRegion(value); setAnnouncement(value === 'us' ? 'Movies and series: USA only' : 'Movies and series: all');}}
            start={startView} onStart={value => setStartView(value)} titles={caps.titles && catalogue.state.status === 'ready'} source={catalogue.state.source} withTmdb={catalogue.state.withTmdb}
            onRefresh={catalogue.refresh} adultLock={adultLock || <p className="settings-muted">Your line has no adult categories.</p>} onShortcuts={() => shortcutsDialog.current?.showModal()}
            onSignOut={() => void logout()} signingOut={signingOut} saveError={library.error}/>}
          {browseView?.view === 'search' && <Search key="search" query={browseView.q} catalog={catalog} library={library.library} posters={posters} opts={opts} channels={visible}
            error={catalogue.state.error} onRetry={catalogue.retry} onQuery={q => router.navigate({view: 'search', q}, {replace: true, silent: true})} onOpen={openTitle} onChannel={onSearchChannel}/>}
          {browseView && browseView.view !== 'settings' && browseView.view !== 'search' && !catalogueReady && <BrowseLoading label="Loading movies and series…"/>}
          {catalogueReady && browseBase && browseView?.view === 'home' && <Home {...browseBase} continueRefs={continueRefs}/>}
          {catalogueReady && browseBase && browseView?.view === 'discover' && <Discover {...browseBase} type={browseView.type} list={browseView.list} genre={browseView.genre}
            initialLimit={router.value('discover-limit')} onLimit={limit => router.setValue('discover-limit', limit)}/>}
          {catalogueReady && browseBase && browseView?.view === 'library' && <LibraryView {...browseBase} saveError={library.error}/>}
          {catalogueReady && browseView?.view === 'title' && !browseTitle && <div className="watch-browse browse-empty"><h1 className="browse-title">Not available</h1><p>This title is no longer on your line.</p><button type="button" className="small-button" data-nav-start="" onClick={() => go({view: 'home'})}>Back to Home</button></div>}
          {catalogueReady && browseTitle && browseTitle.adult && !adultUnlocked && <div className="watch-browse browse-empty"><h1 className="browse-title">Locked</h1><p>This title is in an adult category. Unlock adult content in Settings to see it.</p><button type="button" className="small-button" data-nav-start="" onClick={() => go({view: 'settings'})}>Open Settings</button></div>}
          {catalogueReady && browseTitle && (!browseTitle.adult || adultUnlocked) && <TitleDetails key={browseTitle.key} title={browseTitle} library={library.library} posters={posters} busy={titleBusy} error={shownError(browseTitle.key)} onPlay={onTitlePlay} onToggleFavorite={onTitleFavorite}/>}
        </main>
      </div>}
    {username && <dialog ref={shortcutsDialog} className="watch-shortcuts" aria-labelledby="watch-shortcuts-title">
      <h2 id="watch-shortcuts-title">Keyboard &amp; remote</h2>
      <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
      <p>Shortcuts work while you are not typing in a field. On a TV, the remote’s Back button goes back.</p>
      <form method="dialog"><button className="small-button">Close</button></form>
    </dialog>}
    <span className="sr-only" role="status">{announcement}</span>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
