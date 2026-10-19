'use client';
import {useEffect, useState, type RefObject} from 'react';
import {Pause, Play, RotateCcw, Rewind, FastForward} from 'lucide-react';
import {clockText} from '../../lib/browse';

// Buttons and a seek bar for movies and episodes, which a TV remote can reach (its arrow keys can't reach a video's own
// controls). On the seek bar, left and right seek; up and down leave it.

function seekVideo(element: HTMLVideoElement, to: number) {
  if (Number.isFinite(element.duration)) element.currentTime = Math.max(0, Math.min(element.duration - 1, to));
}

export default function VodControls({video, mediaKey}: {video: RefObject<HTMLVideoElement | null>; mediaKey: string}) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      setTime(element.currentTime || 0);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setPaused(element.paused);
    };
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'seeked', 'emptied'];
    for (const event of events) element.addEventListener(event, sync);
    const timer = setTimeout(sync, 0);
    return () => {clearTimeout(timer); for (const event of events) element.removeEventListener(event, sync);};
  }, [video, mediaKey]);

  const seek = (to: number) => {
    const element = video.current;
    if (element) seekVideo(element, to);
  };
  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  };
  return <div className="vod-controls" role="group" aria-label="Playback">
    <button type="button" className="small-button vod-play" aria-keyshortcuts="K Space" onClick={toggle}>{paused ? <><Play size={16} aria-hidden="true"/> Play</> : <><Pause size={16} aria-hidden="true"/> Pause</>}</button>
    <button type="button" className="small-button" aria-label="Back 10 seconds" aria-keyshortcuts="J" disabled={!duration} onClick={() => seek(time - 10)}><Rewind size={16} aria-hidden="true"/> 10s</button>
    <button type="button" className="small-button" aria-label="Forward 30 seconds" disabled={!duration} onClick={() => seek(time + 30)}><FastForward size={16} aria-hidden="true"/> 30s</button>
    <label className="vod-seek"><span className="sr-only">Position</span>
      <input type="range" min={0} max={Math.max(1, Math.floor(duration))} step={10} value={Math.min(Math.floor(time), Math.max(1, Math.floor(duration)))} disabled={!duration}
        aria-valuetext={clockText(time) + ' of ' + clockText(duration)} onChange={event => seek(Number(event.target.value))}/>
    </label>
    <span className="vod-time" aria-hidden="true">{clockText(time)} / {duration ? clockText(duration) : '–:––'}</span>
    <button type="button" className="small-button" disabled={!duration || time < 5} onClick={() => seek(0)}><RotateCcw size={16} aria-hidden="true"/> Start over</button>
  </div>;
}
