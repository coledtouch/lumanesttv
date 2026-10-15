'use client';
import {useEffect, useRef, useState, type RefObject} from 'react';

// Casting sends the current channel to a TV. Chromecast/Google Cast covers Chromecast, Google TV and TVs with Cast
// built in (Sony, TCL, Hisense, Vizio, Philips) from Chrome. AirPlay covers Apple TV and AirPlay 2 TVs (Samsung,
// LG, Vizio, Sony, Roku) from Safari. The TV plays a short-lived cast link from /api/player/cast, because it has no
// access to this browser's player session.

type CastLink = {url: string; contentType: string; live: boolean};
type ApiError = {error?: {message?: string}};
type CastSession = {
  getCastDevice(): {friendlyName?: string};
  loadMedia(request: unknown): Promise<unknown>;
  endSession(stopCasting: boolean): void;
};
type CastContext = {
  setOptions(options: Record<string, unknown>): void;
  getCastState(): string;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<unknown>;
  addEventListener(type: string, listener: (event: {castState?: string; sessionState?: string}) => void): void;
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

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
let castReady: Promise<boolean> | null = null;
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

/** Loads a channel on the connected Cast device with the Default Media Receiver. */
async function sendToCast(session: CastSession, channelToken: string, title: string) {
  const w = window as unknown as CastGlobals, media = w.chrome?.cast?.media;
  if (!media) return;
  const link = await castLink(channelToken);
  const info = new media.MediaInfo(link.url, link.contentType);
  info.streamType = link.live ? media.StreamType.LIVE : media.StreamType.BUFFERED;
  const metadata = new media.GenericMediaMetadata();
  metadata.title = title; metadata.subtitle = 'LumaNest TV';
  info.metadata = metadata;
  await session.loadMedia(new media.LoadRequest(info));
}

async function castLink(token: string): Promise<CastLink> {
  const response = await fetch('/api/player/cast', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token})});
  const data = await response.json().catch(() => null) as (CastLink & ApiError) | null;
  if (!response.ok || !data?.url) throw new Error(data?.error?.message || 'This channel could not be sent to your TV.');
  return data;
}

export default function CastControls({token, name, video}: {token: string; name: string; video: RefObject<HTMLVideoElement | null>}) {
  const [castAvailable, setCastAvailable] = useState(false);
  const [castDevice, setCastDevice] = useState('');
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const context = useRef<CastContext | null>(null);
  const sentToken = useRef('');

  useEffect(() => {
    let cancelled = false;
    void loadCast().then(ready => {
      const w = window as unknown as CastGlobals, framework = w.cast?.framework, chromeCast = w.chrome?.cast;
      if (cancelled || !ready || !framework || !chromeCast) return;
      const instance = framework.CastContext.getInstance();
      instance.setOptions({receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED});
      context.current = instance;
      const update = () => {
        setCastAvailable(instance.getCastState() !== framework.CastState.NO_DEVICES_AVAILABLE);
        setCastDevice(instance.getCurrentSession()?.getCastDevice().friendlyName || '');
      };
      instance.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, update);
      instance.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, event => {
        if (event.sessionState === framework.SessionState.SESSION_ENDED) sentToken.current = '';
        update();
      });
      update();
    });
    return () => {cancelled = true;};
  }, []);

  // Changing channel while casting sends the new channel to the TV.
  useEffect(() => {
    const session = context.current?.getCurrentSession();
    if (!castDevice || !session || sentToken.current === token) return;
    sentToken.current = token;
    void sendToCast(session, token, name).then(() => video.current?.pause())
      .catch(error => {sentToken.current = ''; setMessage(error instanceof Error ? error.message : 'Casting failed.');});
  }, [castDevice, token, name, video]);

  // Safari announces AirPlay receivers on the video element.
  useEffect(() => {
    const element = video.current;
    const w = window as unknown as CastGlobals;
    if (!element || !w.WebKitPlaybackTargetAvailabilityEvent) return;
    const onAvailability = (event: Event) => setAirPlayAvailable((event as Event & {availability?: string}).availability === 'available');
    element.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
    return () => element.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
  }, [video, token]);

  async function startCast() {
    const instance = context.current;
    if (!instance) return;
    setBusy(true); setMessage('');
    try {
      if (!instance.getCurrentSession()) await instance.requestSession();
      const session = instance.getCurrentSession();
      if (!session) return;
      await sendToCast(session, token, name);
      sentToken.current = token;
      video.current?.pause();
      setCastDevice(session.getCastDevice().friendlyName || 'your TV');
    } catch (error) {
      // Closing the device picker rejects with "cancel"; that is not an error worth showing.
      if (!(typeof error === 'string' && error === 'cancel')) setMessage(error instanceof Error ? error.message : 'Casting failed. Make sure your TV is on the same Wi-Fi.');
    } finally {setBusy(false);}
  }

  function stopCast() {
    context.current?.getCurrentSession()?.endSession(true);
    sentToken.current = ''; setCastDevice('');
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

  if (!castAvailable && !airPlayAvailable && !castDevice) return null;
  return <div className="watch-cast" aria-live="polite">
    {castDevice ? <>
      <span className="watch-cast-status"><span aria-hidden="true">📺</span> Playing on {castDevice}</span>
      <button type="button" className="small-button" onClick={stopCast}>Stop casting</button>
    </> : <>
      {castAvailable && <button type="button" className="small-button" disabled={busy} onClick={() => void startCast()}>Cast to TV</button>}
      {airPlayAvailable && <button type="button" className="small-button" disabled={busy} onClick={() => void startAirPlay()}>AirPlay</button>}
    </>}
    {message && <span className="watch-cast-error" role="alert">{message}</span>}
  </div>;
}
