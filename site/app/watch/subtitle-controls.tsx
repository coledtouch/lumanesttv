'use client';
import {useEffect, useId, useRef, useState, type RefObject} from 'react';
import type Hls from 'hls.js';

// Subtitles and closed captions for the playing channel, movie or episode. hls.js turns CEA-608/708 captions and
// subtitle playlists into text tracks on the video element; Safari's native HLS and direct files expose theirs on
// video.textTracks. mpegts.js does not decode captions, so raw MPEG-TS channels never have any.

type Option = {key: string; label: string; lang: string};
type Preference = {on: boolean; lang: string};

const PREFERENCE_KEY = 'lumanest_subtitles';
const TEXT_KINDS = ['captions', 'subtitles'];

function readPreference(): Preference | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || 'null');
    if (saved && typeof saved === 'object' && typeof (saved as Preference).on === 'boolean')
      return {on: (saved as Preference).on, lang: String((saved as Preference).lang || '').slice(0, 20)};
  } catch {}
  return null;
}
function savePreference(preference: Preference) {
  try {localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));} catch {}
}

/** Text tracks that are captions or subtitles of their own, leaving out the ones hls.js manages as subtitle playlists. */
function textTracks(element: HTMLVideoElement, engine: Hls | null) {
  const managed = engine?.subtitleTracks || [];
  return Array.from(element.textTracks).map((track, index) => ({track, index})).filter(({track}) =>
    TEXT_KINDS.includes(track.kind) && !managed.some(item => item.trackNode ? item.trackNode.track === track :
      track.kind === 'subtitles' && track.label === item.name && (track.language || '') === (item.lang || '')));
}

function trackLabel(label: string, lang: string, number: number) {
  return label || (lang ? lang.toUpperCase() : 'Subtitles ' + number);
}

function listOptions(element: HTMLVideoElement, engine: Hls | null): Option[] {
  const playlists = (engine?.subtitleTracks || []).map((item, index) => ({key: 'hls:' + index, label: item.name, lang: item.lang || ''}));
  const own = textTracks(element, engine).map(({track, index}) => ({key: 'text:' + index, label: track.label, lang: track.language || ''}));
  return [...playlists, ...own].map((item, index) => ({...item, label: trackLabel(item.label, item.lang, index + 1)}));
}

function selectedKey(element: HTMLVideoElement, engine: Hls | null) {
  if (engine && engine.subtitleTrack >= 0 && engine.subtitleDisplay) return 'hls:' + engine.subtitleTrack;
  const showing = textTracks(element, engine).find(({track}) => track.mode === 'showing');
  return showing ? 'text:' + showing.index : 'off';
}

/** Shows one track (or none, for "off") and turns every other caption track off. */
function selectTrack(element: HTMLVideoElement, engine: Hls | null, key: string) {
  if (engine) {
    if (key.startsWith('hls:')) {engine.subtitleDisplay = true; engine.subtitleTrack = Number(key.slice(4));}
    else engine.subtitleTrack = -1;
  }
  for (const {track, index} of textTracks(element, engine)) {
    const mode = key === 'text:' + index ? 'showing' : 'disabled';
    if (track.mode !== mode) track.mode = mode;
  }
}

/** The viewer's last language, then English, then the first track. */
function preferredOption(options: Option[], lang: string) {
  const base = (value: string) => value.toLowerCase().split('-')[0];
  return (lang && options.find(item => base(item.lang) === base(lang))) ||
    options.find(item => base(item.lang) === 'en' || base(item.lang) === 'eng' || /english/i.test(item.label)) || options[0];
}

export default function SubtitleControls({video, engine, supported}: {video: RefObject<HTMLVideoElement | null>; engine: Hls | null; supported: boolean}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [current, setCurrent] = useState('off');
  const [open, setOpen] = useState(false);
  const chosen = useRef(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    const element = video.current;
    if (!supported || !element) return;
    let disposed = false;
    const seen = new Set<string>();
    const preference = readPreference();
    function sync() {
      if (disposed || !element) return;
      let list = listOptions(element, engine);
      // When new tracks appear, apply the saved choice unless the viewer has already picked one for this stream.
      // Without a saved choice the stream's own default stays as it is.
      if (preference && !chosen.current && list.some(item => !seen.has(item.key))) {
        if (!preference.on) selectTrack(element, engine, 'off');
        else if (selectedKey(element, engine) === 'off' && list.length) selectTrack(element, engine, preferredOption(list, preference.lang).key);
        list = listOptions(element, engine);
      }
      list.forEach(item => seen.add(item.key));
      setOptions(list); setCurrent(selectedKey(element, engine));
    }
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
      for (const type of ['addtrack', 'removetrack', 'change']) tracks.removeEventListener(type, sync);
      if (engine && Events) {
        engine.off(Events.MANIFEST_PARSED, sync);
        engine.off(Events.SUBTITLE_TRACKS_UPDATED, sync);
        engine.off(Events.SUBTITLE_TRACK_SWITCH, sync);
        engine.off(Events.NON_NATIVE_TEXT_TRACKS_FOUND, sync);
      }
    };
  }, [video, engine, supported]);

  // The menu closes on a click elsewhere or on Escape, returning focus to the CC button.
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function choose(key: string) {
    const element = video.current;
    if (!element) return;
    chosen.current = true;
    selectTrack(element, engine, key);
    const option = options.find(item => item.key === key);
    savePreference(option ? {on: true, lang: option.lang} : {on: false, lang: readPreference()?.lang || ''});
    setCurrent(selectedKey(element, engine));
  }

  const active = options.find(item => item.key === current);
  return <div className="watch-subtitles" ref={wrapper} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }}>
    <button type="button" className="small-button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}>
      <span className="watch-cc" aria-hidden="true">CC</span> Subtitles{active ? ': ' + active.label : ''}
    </button>
    {open && <div className="watch-subtitles-menu" id={menuId}>
      {options.length ? <fieldset>
        <legend>Subtitles</legend>
        {[{key: 'off', label: 'Off', lang: ''}, ...options].map(item => <label key={item.key}>
          <input type="radio" name={menuId + '-track'} value={item.key} checked={current === item.key} onChange={() => choose(item.key)}/>
          <span>{item.label}{item.lang && item.label.toUpperCase() !== item.lang.toUpperCase() ? <small lang={item.lang}> {item.lang}</small> : null}</span>
        </label>)}
      </fieldset> : <p role="status">No subtitles in this stream</p>}
    </div>}
  </div>;
}
