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
  getSessionId(): string;
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
// Channel changes while casting wait this long, so zapping sends the TV only the channel the viewer stops on. The new
// channel's cast link is requested at once, during the wait.
const CAST_SWITCH_DELAY_MS = 150;
// 'Cast to TV' requests the cast link while the viewer picks a TV and the receiver app launches. A link requested
// before a longer stay in the picker is requested again.
const CAST_LINK_REUSE_MS = 3 * 60 * 1000;
// A phone just back from sleep may not have its network yet, so a cast-link request that can't connect is retried once.
const CAST_LINK_RETRY_MS = 1000;
const NOT_CASTABLE = 'This live channel can’t be cast to a TV from the browser yet. Watch it here, or use the Tuner app on your TV.';
const NOT_CASTABLE_TITLE = 'This title can’t be cast from the browser. Watch it here, or use the Tuner app on your TV.';
const UNREACHABLE = 'LumaNest couldn’t be reached to send this channel. Check your connection and try again.';
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
 * Media Receiver. `pending` is the channel's cast link, requested while the viewer picked the TV or zapped. `beforeLoad`
 * stops this browser's own stream first, because the TV opens its own connection to the line and many lines allow only
 * one or two at a time. Nothing is loaded once `isCurrent` says a newer send started.
 *
 * Resolves once the LOAD has gone out, not when the TV answers it: LumaNest's receiver answers only once the channel
 * plays, which takes seconds (longer while it waits for a busy line), and the Cast SDK waits up to 10 minutes for that.
 * A LOAD the TV rejects later goes to `failed`, unless a newer send started or the session ended meanwhile.
 */
async function sendToCast(session: CastSession, pending: Promise<CastLink>, title: string, isCurrent: () => boolean, beforeLoad: () => void, failed: (error: Error) => void, startAt = 0) {
  const w = window as unknown as CastGlobals, media = w.chrome?.cast?.media;
  if (!media) return;
  const link = await pending;
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
  // A movie or episode carries on on the TV from where it was here.
  if (!link.live && startAt > 0) request.currentTime = Math.floor(startAt);
  beforeLoad();
  void new Promise(resolve => resolve(session.loadMedia(request))).catch((error: unknown) => {
    if (!isCurrent()) return;
    // The Cast SDK rejects with a chrome.cast.Error code (for example LOAD_FAILED), not an Error.
    const code = typeof error === 'string' ? error : (error as {code?: string} | null)?.code;
    failed(new Error(code ? `Your TV couldn't play this channel (${code}). Try another channel, or the Tuner app on your TV.` : 'Your TV couldn\u2019t play this channel.'));
  });
}

/** A cast link that wasn't handed out. `status` is the HTTP status, or 0 when the request never reached LumaNest. */
class CastLinkError extends Error {
  status: number;
  constructor(message: string, status: number) {super(message); this.status = status;}
}

async function castLink(token: string, customReceiver = false, signal?: AbortSignal): Promise<CastLink> {
  const request = () => fetch('/api/player/cast', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(customReceiver ? {token, receiver: 'lumanest'} : {token}), signal});
  let response: Response;
  try {response = await request();}
  catch (error) {
    // fetch rejects with a TypeError when it can't connect, and with an AbortError when it was cancelled.
    if (!(error instanceof TypeError)) throw error;
    await new Promise(resolve => setTimeout(resolve, CAST_LINK_RETRY_MS));
    try {response = await request();}
    catch (retryError) {throw retryError instanceof TypeError ? new CastLinkError(UNREACHABLE, 0) : retryError;}
  }
  const data = await response.json().catch(() => null) as (CastLink & ApiError) | null;
  if (!response.ok || !data?.url) throw new CastLinkError(data?.error?.message || 'This channel could not be sent to your TV.', response.status);
  return data;
}

export type CastSessionState = {
  /** Google Cast works in this browser. */
  available: boolean;
  /** The TV's name while a Cast session is live, otherwise ''. */
  device: string;
  /** False until a freshly loaded page has given Chrome its chance to rejoin a running session. */
  checked: boolean;
  /**
   * Ends the Cast session, which stops the TV. Only the viewer's Stop casting or Stop playback calls it, or Play here for a
   * channel the TV can't play.
   */
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
  /** The channel's id. What is on the TV is tracked by id, because the channel's token is re-sealed on every list load. */
  channel: string;
  token: string;
  name: string;
  /** The channel's stream format; raw MPEG-TS ('mpegts') can only be cast through LumaNest's own receiver. */
  format?: 'hls' | 'mpegts' | 'file';
  /** Changes when the viewer taps the selected channel again, which sends it to the TV again. */
  attempt: number;
  video: RefObject<HTMLVideoElement | null>;
  /** LumaNest's Google Cast receiver app ID, or '' for Google's Default Media Receiver. */
  castAppId: string;
  /** From useCastSession: Google Cast works in this browser. */
  castAvailable: boolean;
  /** From useCastSession: the TV's name while a Cast session is live, otherwise ''. */
  castDevice: string;
  /**
   * True from the 'Cast to TV' tap until the channel's LOAD has gone out to the TV (onCastStart runs just before), no
   * session came of it, or the viewer stopped casting. The page stops its own stream meanwhile, so the line is free by
   * the time the TV connects, and plays it again if the viewer closed the picker. It doesn't wait for the TV to answer
   * the LOAD, which can take minutes.
   */
  onCastPending: (pending: boolean) => void;
  /**
   * Runs just before a channel is sent to the TV; the page stops its own playback (and download) here. Also runs when
   * Chrome rejoins the session the channel was sent to.
   */
  onCastStart: () => void;
  /**
   * The selected channel didn't reach the TV, or the TV rejected it. The Cast session stays; the TV keeps its channel or
   * shows its own message. `retryable` is false when sending it again can't help, because the TV can't play this channel.
   */
  onCastFailed: (retryable: boolean) => void;
  /** The player session expired while sending a channel. The page asks for the line login again and leaves the TV alone. */
  onSessionExpired: () => void;
  /** Ends the Cast session (useCastSession's stop). Only the Stop casting button calls it. */
  onCastStop: () => void;
  /** False for a movie or episode a TV can't play from a cast link (MKV, AVI, raw MPEG-TS files). */
  castable?: boolean;
  /** A movie or episode rather than a live channel: its wording, and where it should start on the TV. */
  vod?: boolean;
  /** For a movie or episode: the position (seconds) the TV should start from. */
  position?: () => number;
};

/**
 * The channel last sent to the TV: its id, the viewer's attempt, the Cast session it went to (null while 'Cast to TV'
 * still waits for its session), and how far it got. A failed send is kept, so only the viewer sends it again.
 */
type Sent = {channel: string; attempt: number; session: string | null; state: 'sending' | 'loaded' | 'failed'};
const NOTHING_SENT: Sent = {channel: '', attempt: -1, session: '', state: 'failed'};

export default function CastControls({channel, token, name, format, attempt, video, castAppId, castAvailable, castDevice, onCastPending, onCastStart, onCastFailed, onSessionExpired, onCastStop, castable: titleCastable = true, vod = false, position}: CastControlsProps) {
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const [remoteSupported, setRemoteSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sent = useRef(NOTHING_SENT);
  // Every send to the TV takes the next number. One that is no longer the latest loads nothing and reports nothing,
  // so a slow older send can't leave the TV on an older channel, and a LOAD_CANCELLED from a channel the viewer
  // zapped past doesn't show as an error.
  const sendGeneration = useRef(0);
  // The 'Cast to TV' tap (its send generation) that turned the page's castPending on, or 0. Only that tap turns it off
  // again, or Stop casting, or these controls going away, so a tap that finishes late can't clear a newer tap's.
  const pendingTap = useRef(0);

  // AirPlay needs an HLS address, and Chrome's Remote Playback always uses Google's Default Media Receiver with the
  // video element's own source, so neither can play a raw MPEG-TS channel. Nor can Google Cast without LumaNest's
  // receiver: the Default Media Receiver gets the same HLS link as AirPlay.
  const rawTransportStream = format === 'mpegts';
  const castable = titleCastable && (!rawTransportStream || (Boolean(castAppId) && !vod));
  const castAllowed = castAvailable && castable;
  const remoteAllowed = remoteSupported && !rawTransportStream && titleCastable;
  const airPlayAllowed = airPlayAvailable && !rawTransportStream && titleCastable;
  const positionRef = useRef(position);
  useEffect(() => {positionRef.current = position;});
  const startAt = useCallback(() => vod ? positionRef.current?.() || 0 : 0, [vod]);

  // Sends still in flight when the controls go away (Stop playback) must not stop this page's stream any more.
  useEffect(() => () => {sendGeneration.current++;}, []);
  // Nor does a 'Cast to TV' still connecting keep holding the page's own playback.
  useEffect(() => () => {
    if (pendingTap.current) {pendingTap.current = 0; onCastPending(false);}
  }, [onCastPending]);

  /** Ends the page's castPending, if the 'Cast to TV' tap numbered `generation` still holds it. */
  function releasePending(generation: number) {
    if (!generation || pendingTap.current !== generation) return;
    pendingTap.current = 0;
    setBusy(false); onCastPending(false);
  }

  // A failed send never ends the Cast session, because ending it closes the TV app: the TV keeps its channel or shows
  // its own message, this page says what went wrong, and tapping the channel again sends it again. Only the viewer ends
  // the session. A channel the TV can't play isn't retryable: the page offers to play it here, which ends the session.
  const sendFailed = useCallback((error: unknown, retryable = true) => {
    sent.current = {...sent.current, state: 'failed'};
    if (error instanceof CastLinkError && error.status === 401) {onSessionExpired(); return;}
    setMessage(error instanceof Error ? error.message : 'Casting failed.');
    onCastFailed(retryable);
  }, [onCastFailed, onSessionExpired]);

  // Changing channel while casting sends the new channel to the TV.
  useEffect(() => {
    if (!castDevice) {
      // 'Cast to TV' is still waiting for its session and sends the channel itself. Otherwise a LOAD that hadn't gone
      // out yet is sent again if Chrome rejoins the session.
      if (sent.current.session === null) return;
      sendGeneration.current++;
      if (sent.current.state === 'sending') sent.current = NOTHING_SENT;
      return;
    }
    const last = sent.current;
    const session = castContext?.getCurrentSession();
    if (last.channel === channel && last.attempt === attempt && (last.session === null || last.session === session?.getSessionId())) {
      // Already on the TV, on its way there, or failed until the viewer tries again. A token re-sealed by a list
      // refresh sends nothing, nor does Chrome rejoining the same session after the phone slept; that only tells the
      // page the TV is playing again.
      if (last.state === 'loaded') onCastStart();
      return;
    }
    const request = new AbortController();
    const link = castable ? castLink(token, Boolean(castAppId), request.signal) : null;
    void link?.catch(() => {});
    let started = false;
    const timer = setTimeout(() => {
      started = true;
      const session = castContext?.getCurrentSession();
      if (!session) return;
      const generation = ++sendGeneration.current;
      const current = () => generation === sendGeneration.current;
      const record: Sent = {channel, attempt, session: session.getSessionId(), state: 'sending'};
      sent.current = record;
      if (!link) {sendFailed(new Error(vod ? NOT_CASTABLE_TITLE : NOT_CASTABLE), false); return;}
      void sendToCast(session, link, name, current, () => {sent.current = {...record, state: 'loaded'}; setMessage(''); onCastStart();}, sendFailed, startAt())
        .catch(error => {if (current()) sendFailed(error);});
    }, CAST_SWITCH_DELAY_MS);
    // A channel zapped past during the wait never reaches the TV, and its link request is dropped.
    return () => {clearTimeout(timer); if (!started) request.abort();};
  }, [castDevice, channel, token, name, attempt, castAppId, castable, onCastStart, sendFailed, vod, startAt]);

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
    sent.current = {channel, attempt, session: null, state: 'sending'};
    pendingTap.current = generation;
    onCastPending(true);
    // The link is requested now, while the viewer picks the TV and the receiver app launches.
    const customReceiver = Boolean(castAppId);
    const request = new AbortController();
    const requested = Date.now();
    let link = castLink(token, customReceiver, request.signal);
    void link.catch(() => {});
    let session: CastSession | null = null;
    try {
      session = instance.getCurrentSession();
      if (!session) {await instance.requestSession(); session = instance.getCurrentSession();}
      if (!current()) return;
      if (!session) {sent.current = NOTHING_SENT; return;}
      const record: Sent = {channel, attempt, session: session.getSessionId(), state: 'sending'};
      sent.current = record;
      if (Date.now() - requested > CAST_LINK_REUSE_MS) link = castLink(token, customReceiver, request.signal);
      // The page shows the channel as on the TV once the LOAD goes out; onCastStart stops this page's stream in the same
      // update that ends castPending, so the phone never streams meanwhile. A LOAD the TV rejects later is reported then.
      await sendToCast(session, link, name, current, () => {sent.current = {...record, state: 'loaded'}; onCastStart(); releasePending(generation);}, sendFailed, startAt());
    } catch (error) {
      if (!current()) return;
      // Once the TV is connected, its session stays whatever failed.
      if (session) {sendFailed(error); return;}
      sent.current = NOTHING_SENT;
      // Closing the device picker rejects with "cancel"; that is not an error worth showing.
      if (error !== 'cancel') setMessage(error instanceof Error ? error.message : 'Casting failed. Make sure your TV is on the same Wi-Fi.');
    } finally {
      request.abort();
      releasePending(generation);
    }
  }

  function stopCast() {
    sendGeneration.current++; sent.current = NOTHING_SENT;
    releasePending(pendingTap.current);
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
