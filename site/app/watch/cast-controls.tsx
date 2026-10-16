'use client';
import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';

// Casting sends the current channel to a TV. Chromecast/Google Cast covers Chromecast, Google TV and TVs with Cast
// built in (Sony, TCL, Hisense, Vizio, Philips) from Chrome. AirPlay covers Apple TV and AirPlay 2 TVs (Samsung,
// LG, Vizio, Sony, Roku) from Safari. The TV plays a short-lived cast link from /api/player/cast, because it has no
// access to this browser's player session.
//
// With a Cast receiver app ID configured (CAST_RECEIVER_APP_ID), Google Cast launches LumaNest's own receiver
// (public/cast/receiver.html), which plays live channels' raw MPEG-TS. Without it, Google's Default Media Receiver
// gets the same HLS link as AirPlay and Chrome's Remote Playback, so all three are hidden for MPEG-TS channels.
// See docs/casting.md.

type CastLink = {url: string; contentType: string; live: boolean; format?: 'mpegts'; expiresAt?: number};
type ApiError = {error?: {message?: string}};
type CastSession = {
  getCastDevice(): {friendlyName?: string};
  loadMedia(request: unknown): Promise<unknown>;
  endSession(stopCasting: boolean): void;
};
type CastContext = {
  setOptions(options: Record<string, unknown>): void;
  getCastState(): string;
  getSessionState(): string;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<unknown>;
  addEventListener(type: string, listener: (event: {castState?: string; sessionState?: string}) => void): void;
  removeEventListener(type: string, listener: (event: {castState?: string; sessionState?: string}) => void): void;
};
type CastGlobals = {
  cast?: {framework?: {
    CastContext: {getInstance(): CastContext};
    CastContextEventType: {CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string};
    CastState: {NO_DEVICES_AVAILABLE: string};
    SessionState: {SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string};
  }};
  chrome?: {cast?: {
    AutoJoinPolicy: {ORIGIN_SCOPED: string};
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      StreamType: {LIVE: string; BUFFERED: string};
      MediaInfo: new (url: string, contentType: string) => Record<string, unknown>;
      GenericMediaMetadata: new () => Record<string, unknown>;
      LoadRequest: new (info: Record<string, unknown>) => Record<string, unknown>;
    };
  }};
  __onGCastApiAvailable?: (available: boolean) => void;
  WebKitPlaybackTargetAvailabilityEvent?: unknown;
};
type AirPlayVideo = HTMLVideoElement & {webkitShowPlaybackTargetPicker?: () => void};
// Remote Playback API: Chrome on Android casts a video element's own URL to a Cast device.
type RemoteVideo = HTMLVideoElement & {remote?: {prompt(): Promise<void>}};

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
// After the SDK loads, Chrome rejoins a session this site left running (auto-join). Local playback waits briefly for
// that, and never longer than the overall limit when the SDK itself is slow.
const CAST_JOIN_WAIT_MS = 1500;
const CAST_CHECK_LIMIT_MS = 3000;
// Channel changes while casting wait this long, so zapping sends the TV only the channel the viewer stops on.
const CAST_SWITCH_DELAY_MS = 300;
const NOT_CASTABLE = 'This live channel can’t be cast to a TV from the browser yet. Watch it here, or use the Tuner app on your TV.';
let castReady: Promise<boolean> | null = null;
// The Cast SDK's context once useCastSession has configured it.
let castContext: CastContext | null = null;
function loadCast(): Promise<boolean> {
  if (castReady) return castReady;
  castReady = new Promise(resolve => {
    const w = window as unknown as CastGlobals;
    // Google Cast only runs in Chrome-based browsers; elsewhere the SDK reports unavailable.
    if (!/Chrome\//.test(navigator.userAgent)) return resolve(false);
    w.__onGCastApiAvailable = available => resolve(Boolean(available && w.cast?.framework));
    const script = document.createElement('script');
    script.src = CAST_SDK; script.async = true; script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return castReady;
}

/**
 * Loads a channel on the connected Cast device: LumaNest's receiver when one is configured, otherwise the Default
 * Media Receiver. `beforeLoad` stops this browser's own stream first, because the TV opens its own connection to the
 * line and many lines allow only one or two at a time. Nothing is loaded once `isCurrent` says a newer send started.
 */
async function sendToCast(session: CastSession, channelToken: string, title: string, customReceiver: boolean, isCurrent: () => boolean, beforeLoad: () => void) {
  const w = window as unknown as CastGlobals, media = w.chrome?.cast?.media;
  if (!media) return;
  const link = await castLink(channelToken, customReceiver);
  if (!isCurrent()) return;
  const info = new media.MediaInfo(link.url, link.contentType);
  info.streamType = link.live ? media.StreamType.LIVE : media.StreamType.BUFFERED;
  // Live channels are MPEG-TS segments; without this the receiver expects fragmented MP4 and stays blank.
  if (link.contentType === 'application/x-mpegURL') {info.hlsSegmentFormat = 'ts'; info.hlsVideoSegmentFormat = 'mpeg2_ts';}
  // LumaNest's receiver plays raw MPEG-TS with mpegts.js; the expiry lets it tell an expired link from a busy line.
  if (link.format === 'mpegts') info.customData = {format: 'mpegts', expiresAt: link.expiresAt};
  const metadata = new media.GenericMediaMetadata();
  metadata.title = title; metadata.subtitle = 'LumaNest TV';
  info.metadata = metadata;
  const request = new media.LoadRequest(info);
  request.autoplay = true;
  beforeLoad();
  try {await session.loadMedia(request);}
  catch (error) {
    // The Cast SDK rejects with a chrome.cast.Error code (for example LOAD_FAILED), not an Error.
    const code = typeof error === 'string' ? error : (error as {code?: string} | null)?.code;
    throw new Error(code ? `Your TV couldn't play this channel (${code}). Try another channel, or the Tuner app on your TV.` : 'Your TV couldn\u2019t play this channel.');
  }
}

async function castLink(token: string, customReceiver = false): Promise<CastLink> {
  const response = await fetch('/api/player/cast', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(customReceiver ? {token, receiver: 'lumanest'} : {token})});
  const data = await response.json().catch(() => null) as (CastLink & ApiError) | null;
  if (!response.ok || !data?.url) throw new Error(data?.error?.message || 'This channel could not be sent to your TV.');
  return data;
}

export type CastSessionState = {
  /** Google Cast works in this browser. */
  available: boolean;
  /** The TV's name while a Cast session is live, otherwise ''. */
  device: string;
  /** False until a freshly loaded page has given Chrome its chance to rejoin a running session. */
  checked: boolean;
  /** Ends the Cast session, which stops the TV. */
  stop: () => void;
};

/**
 * Follows the Google Cast session for the whole signed-in page, not only while a channel is selected, so the player
 * never starts its own stream while a TV is streaming the line. After a reload Chrome rejoins a session that is
 * still running, which `checked` waits for.
 */
export function useCastSession(enabled: boolean, castAppId: string, onEnd: () => void): CastSessionState {
  const [available, setAvailable] = useState(false);
  const [device, setDevice] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let detach = () => {};
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {if (!cancelled) setChecked(true);};
    const limitTimer = setTimeout(check, CAST_CHECK_LIMIT_MS);
    void loadCast().then(ready => {
      const w = window as unknown as CastGlobals, framework = w.cast?.framework, chromeCast = w.chrome?.cast;
      if (cancelled) return;
      if (!ready || !framework || !chromeCast) {check(); return;}
      const instance = framework.CastContext.getInstance();
      instance.setOptions({receiverApplicationId: castAppId || chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED});
      castContext = instance;
      // The button shows as soon as Cast works in this browser. Android finds TVs slowly and may still report
      // "no devices" here; tapping the button opens Chrome's picker, which keeps looking.
      setAvailable(true);
      const update = () => {
        // While SESSION_ENDED is announced the SDK still returns the old session, so the session state decides.
        const session = instance.getSessionState() === framework.SessionState.SESSION_ENDED ? null : instance.getCurrentSession();
        setDevice(session ? session.getCastDevice().friendlyName || 'your TV' : '');
      };
      const onSession = (event: {sessionState?: string}) => {
        if (event.sessionState === framework.SessionState.SESSION_ENDED) onEnd();
        update();
      };
      instance.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, update);
      instance.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, onSession);
      detach = () => {
        instance.removeEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, update);
        instance.removeEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, onSession);
      };
      update();
      joinTimer = setTimeout(check, CAST_JOIN_WAIT_MS);
    });
    return () => {cancelled = true; clearTimeout(limitTimer); clearTimeout(joinTimer); detach();};
  }, [enabled, castAppId, onEnd]);

  const stop = useCallback(() => {
    castContext?.getCurrentSession()?.endSession(true);
    setDevice(''); onEnd();
  }, [onEnd]);
  return {available, device: enabled ? device : '', checked, stop};
}

type CastControlsProps = {
  token: string;
  name: string;
  /** The channel's stream format; raw MPEG-TS ('mpegts') can only be cast through LumaNest's own receiver. */
  format?: 'hls' | 'mpegts' | 'file';
  video: RefObject<HTMLVideoElement | null>;
  /** LumaNest's Google Cast receiver app ID, or '' for Google's Default Media Receiver. */
  castAppId: string;
  /** From useCastSession: Google Cast works in this browser. */
  castAvailable: boolean;
  /** From useCastSession: the TV's name while a Cast session is live, otherwise ''. */
  castDevice: string;
  /** Runs just before a channel is sent to the TV; the page stops its own playback (and download) here. */
  onCastStart: () => void;
  /** Ends the Cast session (useCastSession's stop). Also used when the TV can't take a channel. */
  onCastStop: () => void;
};

export default function CastControls({token, name, format, video, castAppId, castAvailable, castDevice, onCastStart, onCastStop}: CastControlsProps) {
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const [remoteSupported, setRemoteSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sentToken = useRef('');
  // Every send to the TV takes the next number. One that is no longer the latest loads nothing and reports nothing,
  // so a slow older send can't leave the TV on an older channel, and a LOAD_CANCELLED from a channel the viewer
  // zapped past doesn't show as an error.
  const sendGeneration = useRef(0);

  // AirPlay needs an HLS address, and Chrome's Remote Playback always uses Google's Default Media Receiver with the
  // video element's own source, so neither can play a raw MPEG-TS channel. Nor can Google Cast without LumaNest's
  // receiver: the Default Media Receiver gets the same HLS link as AirPlay.
  const rawTransportStream = format === 'mpegts';
  const castable = !rawTransportStream || Boolean(castAppId);
  const castAllowed = castAvailable && castable;
  const remoteAllowed = remoteSupported && !rawTransportStream;
  const airPlayAllowed = airPlayAvailable && !rawTransportStream;

  // Sends still in flight when the controls go away (Stop playback) must not stop this page's stream any more.
  useEffect(() => () => {sendGeneration.current++;}, []);

  // Changing channel while casting sends the new channel to the TV. If the TV can't take it, casting stops, so the
  // TV, this page and the player agree, and the page offers to play the channel here.
  useEffect(() => {
    if (!castDevice) {sentToken.current = ''; sendGeneration.current++; return;}
    if (sentToken.current === token) return;
    const timer = setTimeout(() => {
      const session = castContext?.getCurrentSession();
      if (!session) return;
      const generation = ++sendGeneration.current;
      const current = () => generation === sendGeneration.current;
      sentToken.current = token;
      if (!castable) {sentToken.current = ''; setMessage(NOT_CASTABLE); onCastStop(); return;}
      void sendToCast(session, token, name, Boolean(castAppId), current, onCastStart).then(() => {
        if (current()) setMessage('');
      }, error => {
        if (!current()) return;
        sentToken.current = '';
        setMessage(error instanceof Error ? error.message : 'Casting failed.');
        onCastStop();
      });
    }, CAST_SWITCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [castDevice, token, name, castAppId, castable, onCastStart, onCastStop]);

  // Without the Cast SDK (for example some Chrome builds on Android), the browser's own Remote Playback can cast.
  useEffect(() => {
    const element = video.current as RemoteVideo | null;
    const w = window as unknown as CastGlobals;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser support is only known after the video element mounts
    setRemoteSupported(Boolean(element?.remote && !w.WebKitPlaybackTargetAvailabilityEvent));
  }, [video, token]);

  // Safari announces AirPlay receivers on the video element.
  useEffect(() => {
    const element = video.current;
    const w = window as unknown as CastGlobals;
    if (!element || !w.WebKitPlaybackTargetAvailabilityEvent) return;
    const onAvailability = (event: Event) => setAirPlayAvailable((event as Event & {availability?: string}).availability === 'available');
    element.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
    return () => element.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
  }, [video, token]);

  async function startRemote() {
    const element = video.current as RemoteVideo | null;
    if (!element?.remote) return;
    setBusy(true); setMessage('');
    try {
      // The TV fetches the stream itself, so the element switches to the cookie-free cast link first.
      const link = await castLink(token);
      element.setAttribute('src', link.url);
      await element.remote.prompt();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotFoundError') setMessage('No TV found. Make sure your TV has Chromecast built in and is on the same Wi-Fi as this phone.');
      else if (name === 'NotSupportedError') setMessage('This browser can’t cast this channel. Try Chrome on a computer, or the Tuner app on your TV.');
      else if (name !== 'AbortError') setMessage(error instanceof Error ? error.message : 'Casting failed.');
    } finally {setBusy(false);}
  }

  async function startCast() {
    const instance = castContext;
    if (!instance || !castAllowed) {
      if (remoteAllowed) void startRemote();
      return;
    }
    setBusy(true); setMessage('');
    // Claimed before the picker opens, so the session-started update doesn't send the same channel a second time.
    // A channel change meanwhile is a newer send and wins.
    const generation = ++sendGeneration.current;
    const current = () => generation === sendGeneration.current;
    sentToken.current = token;
    try {
      if (!instance.getCurrentSession()) await instance.requestSession();
      const session = instance.getCurrentSession();
      if (!current()) return;
      if (!session) {sentToken.current = ''; return;}
      await sendToCast(session, token, name, Boolean(castAppId), current, onCastStart);
    } catch (error) {
      if (!current()) return;
      sentToken.current = '';
      // Closing the device picker rejects with "cancel"; that is not an error worth showing.
      if (typeof error === 'string' && error === 'cancel') return;
      setMessage(error instanceof Error ? error.message : 'Casting failed. Make sure your TV is on the same Wi-Fi.');
      // The TV may already be connected; end that session so it doesn't read as "Playing on" a TV that plays nothing.
      onCastStop();
    } finally {setBusy(false);}
  }

  function stopCast() {
    sendGeneration.current++; sentToken.current = '';
    onCastStop();
  }

  async function startAirPlay() {
    const element = video.current as AirPlayVideo | null;
    if (!element?.webkitShowPlaybackTargetPicker) return;
    setBusy(true); setMessage('');
    try {
      // The Apple TV fetches the stream itself, so Safari switches to the cookie-free cast link first.
      const link = await castLink(token);
      element.setAttribute('src', link.url);
      void element.play().catch(() => {});
      element.webkitShowPlaybackTargetPicker();
    } catch (error) {setMessage(error instanceof Error ? error.message : 'AirPlay failed.');}
    finally {setBusy(false);}
  }

  const canCast = castAllowed || remoteAllowed;
  if (!canCast && !airPlayAllowed && !castDevice && !message) return null;
  return <div className="watch-cast" aria-live="polite">
    {castDevice ? <>
      <span className="watch-cast-status"><span aria-hidden="true">📺</span> Playing on {castDevice}</span>
      <button type="button" className="small-button" onClick={stopCast}>Stop casting</button>
    </> : <>
      {canCast && <button type="button" className="small-button" disabled={busy} onClick={() => void startCast()}>Cast to TV</button>}
      {airPlayAllowed && <button type="button" className="small-button" disabled={busy} onClick={() => void startAirPlay()}>AirPlay</button>}
    </>}
    {message && <span className="watch-cast-error" role="alert">{message}</span>}
  </div>;
}
