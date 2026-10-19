// How a movie or episode plays in this browser, from its container (the file extension the provider gives it).
// Pure: the browser's canPlayType answers come in as a function, so tests cover every combination.

export type VodMode = 'file' | 'hls' | 'mpegts' | 'maybe' | 'tuner';
export type VodPlan = {
  /**
   * file: the video element plays it; hls: hls.js (or Safari); mpegts: mpegts.js, not live; maybe: MKV, which some
   * browsers play and most don't (the viewer can try); tuner: browsers can't play it, the Tuner app can.
   */
  mode: VodMode;
  /** Google Cast, AirPlay and Remote Playback can play it from a cast link. */
  castable: boolean;
};

export function vodPlan(container: string, canPlayType: (type: string) => string): VodPlan {
  const ext = container.toLowerCase();
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') return {mode: 'file', castable: true};
  if (ext === 'm3u8') return {mode: 'hls', castable: true};
  if (ext === 'webm') return {mode: canPlayType('video/webm') ? 'file' : 'tuner', castable: false};
  if (ext === 'ts') return {mode: 'mpegts', castable: false};
  if (ext === 'mkv') return {mode: 'maybe', castable: false};
  return {mode: 'tuner', castable: false};
}

/** The stream format the player uses for a plan ('maybe' is tried as a plain file). */
export function playFormat(mode: VodMode): 'file' | 'hls' | 'mpegts' {
  return mode === 'hls' ? 'hls' : mode === 'mpegts' ? 'mpegts' : 'file';
}

export const TUNER_MESSAGE = 'This video format doesn’t play in browsers. Watch it in the Tuner app on your TV or phone.';
export const MAYBE_MESSAGE = 'This title may not play in your browser. You can try, or watch it in the Tuner app.';

/** Where a movie or episode starts again: from 15 seconds up to 95% through, as the Library keeps places (lib/browse.ts). */
export const resumable = (at: number, duration: number) => at >= 15 && Number.isFinite(duration) && duration > 0 && at < duration * 0.95;
