'use client';
import {useEffect, useId, useRef, useState, type RefObject} from 'react';
import type Hls from 'hls.js';
import {FILE_TIMEOUT_MS, SUBTITLE_CREDIT, extrasClient, type ExtraTrack} from './extras';
import {automaticStep, listOptions, othersShowing, readPreference, savePreference, selectTrack, selectedKey, trackNumbers, type SubtitleOption, type TrackSet} from './subtitle-tracks';

// Subtitles and closed captions for the playing channel, movie or episode. hls.js turns CEA-608/708 captions and
// subtitle playlists into text tracks on the video element; Safari's native HLS and direct files expose theirs on
// video.textTracks. mpegts.js does not decode captions, so raw MPEG-TS channels never have any.
//
// Movies and episodes also get English subtitles from OpenSubtitles.com through lumanest.tv (docs/extras.md), listed
// from the lookup. A track becomes a <track> element of the video (on this site's own origin) when it is first shown,
// so its file is downloaded only then (see subtitle-tracks.ts); the browser draws its cues itself, as text and in step
// with the video.

const LOAD_FAILED = 'These subtitles couldn\'t be loaded.';
const NOTICE_MS = 6000;
const NO_TRACKS: ExtraTrack[] = [];
/** HTMLTrackElement.readyState: LOADED and ERROR. */
const LOADED = 2, ERROR = 3;

/** The OpenSubtitles tracks of the movie or episode a lookup query names ("" for none): asked once it starts. */
export function useExtraSubtitles(query: string): ExtraTrack[] {
  const [found, setFound] = useState<{query: string; tracks: ExtraTrack[]}>({query: '', tracks: NO_TRACKS});
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    void extrasClient().subtitles(query).then(tracks => {if (!cancelled) setFound({query, tracks});});
    return () => {cancelled = true;};
  }, [query]);
  return query && found.query === query ? found.tracks : NO_TRACKS;
}

const extraNodes = (element: HTMLVideoElement) => Array.from(element.querySelectorAll<HTMLTrackElement>('track[data-extras]'));
const keyOf = (node: HTMLTrackElement) => 'os:' + (node.dataset.extras || '');

/** The video's tracks: its text tracks, and the lookup's tracks with their <track> element once one was added. */
function trackSet(element: HTMLVideoElement, extras: ExtraTrack[]): TrackSet {
  const nodes = extraNodes(element);
  return {textTracks: element.textTracks, extras: extras.map(item => {
    const node = nodes.find(candidate => candidate.dataset.extras === item.id);
    return {id: item.id, label: item.label, track: node ? node.track : null, attach: () => {
      const added = document.createElement('track');
      added.kind = 'subtitles'; added.srclang = 'en'; added.label = item.label; added.dataset.extras = item.id;
      added.src = item.src;
      element.appendChild(added);
      return added.track;
    }};
  })};
}

export default function SubtitleControls({video, engine, supported, extras = NO_TRACKS}: {
  video: RefObject<HTMLVideoElement | null>; engine: Hls | null; supported: boolean; extras?: ExtraTrack[];
}) {
  const [options, setOptions] = useState<SubtitleOption[]>([]);
  const [current, setCurrent] = useState('off');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [numberOf] = useState(trackNumbers);
  // For this title's playback: whether the viewer picked a track (and which), the track the automatic choice showed,
  // the track the player last showed, the OpenSubtitles tracks whose file failed, and the running effect's watch.
  const memory = useRef({chosen: false, picked: '', automatic: '', intended: '', failed: new Set<string>(), watch: () => {}});
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // The OpenSubtitles <track> elements go with their lookup (hls.js adds its own <track> elements to the video too, so
  // these are added and removed directly rather than rendered by React).
  useEffect(() => {
    const element = video.current;
    if (!element || !extras.length) return;
    const ids = new Set(extras.map(item => item.id));
    return () => {for (const node of extraNodes(element)) if (ids.has(node.dataset.extras || '')) node.remove();};
  }, [video, extras]);

  useEffect(() => {
    const element = video.current;
    if (!supported || !element) return;
    let disposed = false;
    const seen = new Set<string>();
    const preference = readPreference();
    const memo = memory.current;
    const listening = new WeakSet<HTMLTrackElement>();
    const timers = new Map<HTMLTrackElement, ReturnType<typeof setTimeout>>();
    const events = new AbortController();
    const stopTimer = (node: HTMLTrackElement) => {clearTimeout(timers.get(node)); timers.delete(node);};

    /** An OpenSubtitles file that failed (an error answer, no cues, or 20 seconds): Off, with a note if it was picked. */
    function failed(node: HTMLTrackElement) {
      if (disposed) return;
      stopTimer(node);
      const key = keyOf(node);
      memo.failed.add(key);
      const set = trackSet(element!, extras);
      if (selectedKey(set, engine, numberOf) === key) {
        selectTrack(set, engine, 'off', numberOf);
        memo.intended = 'off';
        if (memo.picked === key) setNotice(LOAD_FAILED);
      }
      sync();
    }
    /** Follows each OpenSubtitles track's file while the track is shown. */
    function watch() {
      for (const node of extraNodes(element!)) {
        if (!listening.has(node)) {
          listening.add(node);
          node.addEventListener('error', () => failed(node), {signal: events.signal});
          node.addEventListener('load', () => stopTimer(node), {signal: events.signal});
        }
        if (node.track.mode === 'showing' && node.readyState !== LOADED && !timers.has(node))
          timers.set(node, setTimeout(() => {timers.delete(node); if (node.readyState !== LOADED) failed(node);}, node.readyState === ERROR ? 0 : FILE_TIMEOUT_MS));
      }
    }
    function sync() {
      if (disposed || !element) return;
      watch();
      let set = trackSet(element, extras);
      let list = listOptions(set, engine, numberOf);
      // When new tracks appear, the saved choice applies until the viewer picks a track for this title.
      if (!memo.chosen && list.some(item => !seen.has(item.key))) {
        const step = automaticStep(list, selectedKey(set, engine, numberOf), preference, memo.automatic, memo.failed);
        if (step !== null) {
          selectTrack(set, engine, step, numberOf);
          memo.automatic = memo.intended = step === 'off' ? '' : step;
          watch();
          set = trackSet(element, extras); list = listOptions(set, engine, numberOf);
        }
      }
      // A track the browser turned on beside the one the player shows is turned off again.
      if (memo.intended && othersShowing(set, engine, memo.intended, numberOf)) {
        selectTrack(set, engine, memo.intended, numberOf);
        set = trackSet(element, extras);
      }
      list.forEach(item => seen.add(item.key));
      setOptions(list); setCurrent(selectedKey(set, engine, numberOf));
    }
    memo.watch = watch;
    const tracks = element.textTracks;
    for (const type of ['addtrack', 'removetrack', 'change']) tracks.addEventListener(type, sync);
    const Events = engine ? (engine.constructor as typeof Hls).Events : null;
    if (engine && Events) {
      engine.on(Events.MANIFEST_PARSED, sync);
      engine.on(Events.SUBTITLE_TRACKS_UPDATED, sync);
      engine.on(Events.SUBTITLE_TRACK_SWITCH, sync);
      engine.on(Events.NON_NATIVE_TEXT_TRACKS_FOUND, sync);
    }
    void Promise.resolve().then(sync);
    return () => {
      disposed = true;
      events.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      if (memo.watch === watch) memo.watch = () => {};
      for (const type of ['addtrack', 'removetrack', 'change']) tracks.removeEventListener(type, sync);
      if (engine && Events) {
        engine.off(Events.MANIFEST_PARSED, sync);
        engine.off(Events.SUBTITLE_TRACKS_UPDATED, sync);
        engine.off(Events.SUBTITLE_TRACK_SWITCH, sync);
        engine.off(Events.NON_NATIVE_TEXT_TRACKS_FOUND, sync);
      }
    };
  }, [video, engine, supported, numberOf, extras]);

  // The menu closes on a click elsewhere or on Escape, returning focus to the CC button.
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function choose(key: string) {
    const element = video.current;
    if (!element) return;
    const memo = memory.current;
    memo.chosen = true; memo.picked = memo.intended = key;
    setNotice('');
    // An OpenSubtitles file that failed before is asked for again: a new <track> element loads it afresh.
    const node = key.startsWith('os:') ? extraNodes(element).find(item => keyOf(item) === key) : undefined;
    if (node && (node.readyState === ERROR || memo.failed.has(key))) node.remove();
    memo.failed.delete(key);
    selectTrack(trackSet(element, extras), engine, key, numberOf);
    memo.watch();
    const option = options.find(item => item.key === key);
    savePreference(option ? {on: true, lang: option.lang} : {on: false, lang: readPreference()?.lang || ''});
    setCurrent(selectedKey(trackSet(element, extras), engine, numberOf));
  }

  const active = options.find(item => item.key === current);
  const credit = options.some(item => item.source === 'opensubtitles');
  return <div className="watch-subtitles" ref={wrapper} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }}>
    <button type="button" className="small-button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}>
      <span className="watch-cc" aria-hidden="true">CC</span> Subtitles{active ? ': ' + active.label : ''}
    </button>
    {notice && <p className="watch-subtitles-notice" role="status">{notice}</p>}
    {open && <div className="watch-subtitles-menu" id={menuId}>
      {options.length ? <fieldset>
        <legend>Subtitles</legend>
        {[{key: 'off', label: 'Off', lang: '', source: 'stream'} as SubtitleOption, ...options].map(item => <label key={item.key}>
          <input type="radio" name={menuId + '-track'} value={item.key} checked={current === item.key} onChange={() => choose(item.key)}/>
          <span>{item.label}{item.source === 'stream' && item.lang && item.label.toUpperCase() !== item.lang.toUpperCase() ? <small lang={item.lang}> {item.lang}</small> : null}</span>
        </label>)}
      </fieldset> : <p role="status">No subtitles in this stream</p>}
      {credit && <p className="watch-subtitles-credit">{SUBTITLE_CREDIT}</p>}
    </div>}
  </div>;
}
