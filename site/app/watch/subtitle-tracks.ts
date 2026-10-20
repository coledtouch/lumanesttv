// The subtitle menu's rules, apart from React and the DOM so tests can run them with stand-ins (subtitle-controls.tsx
// uses them on the real video): what the menu lists, which track is showing, showing one track and no other, the
// automatic choice of Settings > Subtitles On (docs/extras.md, "Subtitles in the player") and the saved preference.
//
// A video has three kinds of tracks: subtitle playlists hls.js manages (keys "hls:<index>"), the stream's own text
// tracks (CEA-608/708 captions that hls.js found, or the tracks Safari and direct files expose; "text:<n>") and the
// OpenSubtitles tracks of the lookup ("os:<file token>"). An OpenSubtitles track becomes a <track> element of the video
// only when it is first shown, and is shown in the same step: a browser downloads a track's file once its track
// leaves "disabled", and Chrome turns on any subtitle track that script has not set yet whenever another one shows, so
// a <track> added before it is chosen could be downloaded and shown without being chosen.

export type TrackMode = 'disabled' | 'hidden' | 'showing';
export type TextTrackLike = {kind: string; label: string; language: string; mode: TrackMode};
export type EngineLike = {subtitleTracks?: {name: string; lang?: string; trackNode?: {track: unknown}}[]; subtitleTrack: number; subtitleDisplay: boolean};
/** The lookup's OpenSubtitles tracks, in its order: `track` once its <track> element exists, `attach` adds it. */
export type ExtraNode = {id: string; label: string; track: TextTrackLike | null; attach?: () => TextTrackLike | null};
export type TrackSet = {textTracks: ArrayLike<TextTrackLike>; extras: ExtraNode[]};
export type Source = 'stream' | 'opensubtitles';
export type SubtitleOption = {key: string; label: string; lang: string; source: Source};
export type Preference = {on: boolean; lang: string};

const TEXT_KINDS = ['captions', 'subtitles'];
export const PREFERENCE_KEY = 'lumanest_subtitles';

/** A stable number for each text track of one video, so a key keeps naming the same track as tracks come and go. */
export function trackNumbers() {
  const numbers = new WeakMap<object, number>();
  let next = 0;
  return (track: object) => {
    let number = numbers.get(track);
    if (number === undefined) numbers.set(track, number = next++);
    return number;
  };
}
export type TrackNumbers = ReturnType<typeof trackNumbers>;

/** The stream's own caption and subtitle tracks: not the subtitle playlists hls.js manages, not our <track> elements. */
function streamTracks(set: TrackSet, engine: EngineLike | null) {
  const managed = engine?.subtitleTracks || [];
  const ours = new Set<unknown>(set.extras.map(node => node.track).filter(Boolean));
  return Array.from(set.textTracks).filter(track => TEXT_KINDS.includes(track.kind) && !ours.has(track) &&
    !managed.some(item => item.trackNode ? item.trackNode.track === track :
      track.kind === 'subtitles' && track.label === item.name && (track.language || '') === (item.lang || '')));
}

function streamLabel(label: string, lang: string, number: number) {
  return label || (lang ? lang.toUpperCase() : 'Subtitles ' + number);
}

/** The menu's tracks: the stream's (its subtitle playlists, then its own text tracks), then the OpenSubtitles ones. */
export function listOptions(set: TrackSet, engine: EngineLike | null, numberOf: TrackNumbers): SubtitleOption[] {
  const playlists = (engine?.subtitleTracks || []).map((item, index) => ({key: 'hls:' + index, label: item.name, lang: item.lang || ''}));
  const own = streamTracks(set, engine).map(track => ({key: 'text:' + numberOf(track), label: track.label, lang: track.language || ''}));
  const stream = [...playlists, ...own].map((item, index): SubtitleOption => ({...item, label: streamLabel(item.label, item.lang, index + 1), source: 'stream'}));
  return [...stream, ...set.extras.map((node): SubtitleOption => ({key: 'os:' + node.id, label: node.label, lang: 'en', source: 'opensubtitles'}))];
}

/** The key of the track showing, or "off". */
export function selectedKey(set: TrackSet, engine: EngineLike | null, numberOf: TrackNumbers) {
  if (engine && engine.subtitleTrack >= 0 && engine.subtitleDisplay) return 'hls:' + engine.subtitleTrack;
  const showing = streamTracks(set, engine).find(track => track.mode === 'showing');
  if (showing) return 'text:' + numberOf(showing);
  const extra = set.extras.find(node => node.track?.mode === 'showing');
  return extra ? 'os:' + extra.id : 'off';
}

/** The stream's text tracks and the OpenSubtitles tracks that exist, with their keys. */
function keyedTracks(set: TrackSet, engine: EngineLike | null, numberOf: TrackNumbers): [TextTrackLike, string][] {
  const tracks = streamTracks(set, engine).map((track): [TextTrackLike, string] => [track, 'text:' + numberOf(track)]);
  for (const node of set.extras) if (node.track) tracks.push([node.track, 'os:' + node.id]);
  return tracks;
}

/**
 * Shows one track ("off": none) and turns every other one off, so an OpenSubtitles track and the stream's subtitles
 * never show together. A track that isn't shown is "disabled", never "hidden", and an OpenSubtitles track is attached
 * only to be shown: its file is downloaded only then.
 */
export function selectTrack(set: TrackSet, engine: EngineLike | null, key: string, numberOf: TrackNumbers) {
  if (engine) {
    if (key.startsWith('hls:')) {engine.subtitleDisplay = true; engine.subtitleTrack = Number(key.slice(4));}
    else engine.subtitleTrack = -1;
  }
  // Off first, then on, so two tracks never show at once, even for a moment.
  const tracks = keyedTracks(set, engine, numberOf);
  for (const [track, own] of tracks) if (own !== key && track.mode !== 'disabled') track.mode = 'disabled';
  let shown = tracks.find(([, own]) => own === key)?.[0];
  if (!shown && key.startsWith('os:')) {
    const node = set.extras.find(item => 'os:' + item.id === key);
    shown = (node?.attach?.()) || undefined;
  }
  if (shown && shown.mode !== 'showing') shown.mode = 'showing';
}

/**
 * True when `key` shows and another track shows beside it. A browser may turn a track on by itself (Chrome does, for a
 * subtitle track no script has set yet, once another one shows); the player then shows `key` alone again.
 */
export function othersShowing(set: TrackSet, engine: EngineLike | null, key: string, numberOf: TrackNumbers) {
  const showing = keyedTracks(set, engine, numberOf).filter(([track]) => track.mode === 'showing').map(([, own]) => own);
  if (engine && engine.subtitleTrack >= 0 && engine.subtitleDisplay) showing.push('hls:' + engine.subtitleTrack);
  return showing.length > 1 && showing.includes(key);
}

const base = (value: string) => value.toLowerCase().split('-')[0];
const isEnglish = (option: SubtitleOption) => base(option.lang) === 'en' || base(option.lang) === 'eng' || /english/i.test(option.label);

/**
 * The automatic choice: the stream's track in the viewer's last language, else the stream's English track, else the
 * first OpenSubtitles track, else the stream's first track (the player's fallback before OpenSubtitles existed).
 */
export function automaticOption(options: SubtitleOption[], lang: string): SubtitleOption | undefined {
  const stream = options.filter(option => option.source === 'stream');
  return (lang ? stream.find(option => base(option.lang) === base(lang)) : undefined) || stream.find(isEnglish) ||
    options.find(option => option.source === 'opensubtitles') || stream[0];
}

/**
 * What the saved preference does when new tracks appear, until the viewer picks a track for this title: a key to
 * show ("off" for none), or null to leave things as they are.
 * - No saved preference: the stream's own default stays as it is.
 * - Off: nothing shows.
 * - On: when nothing shows, or what shows was chosen automatically, the automatic choice among the tracks that have
 *   not failed to load (OpenSubtitles tracks arrive after the stream's, and may be a better choice than its fallback).
 */
export function automaticStep(options: SubtitleOption[], current: string, preference: Preference | null, automatic: string, failed: ReadonlySet<string>) {
  if (!preference) return null;
  if (!preference.on) return 'off';
  if (current !== 'off' && current !== automatic) return null;
  const best = automaticOption(options.filter(option => !failed.has(option.key)), preference.lang);
  return best && best.key !== current ? best.key : null;
}

// ------------------------------------------------------------------ the saved preference (this browser)

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function store(): Store | null {
  try {return typeof localStorage === 'undefined' ? null : localStorage;} catch {return null;}
}

/** The viewer's subtitle preference: on or off and the last language picked, or null when never chosen. */
export function readPreference(storage: Store | null = store()): Preference | null {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(PREFERENCE_KEY) || 'null');
    if (saved && typeof saved === 'object' && typeof (saved as Preference).on === 'boolean')
      return {on: (saved as Preference).on, lang: String((saved as Preference).lang || '').slice(0, 20)};
  } catch {}
  return null;
}

/** Saves the preference; false when this browser can't keep it. */
export function savePreference(preference: Preference, storage: Store | null = store()) {
  try {
    if (!storage) return false;
    storage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
    return true;
  } catch {return false;}
}
