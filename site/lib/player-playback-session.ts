type PlaybackCallbacks = {
  status(message: string): void;
  error(message: string): void;
  current(): boolean;
  stop?(): void;
  finished: string;
};

export function createPlaybackSession(element: HTMLVideoElement, callbacks: PlaybackCallbacks) {
  let disposed = false;
  let failed = false;
  const isCurrent = () => !disposed && callbacks.current();
  const active = () => isCurrent() && !failed;
  const fail = (message: string) => {
    if (!active()) return;
    failed = true;
    callbacks.error(message);
    callbacks.status('Playback unavailable');
    try {callbacks.stop?.();} catch {}
  };
  const handlers: [string, EventListener][] = [
    ['playing', () => {if (active()) {callbacks.error(''); callbacks.status('Playing');}}],
    ['waiting', () => {if (active()) callbacks.status('Buffering…');}],
    ['pause', () => {if (active()) callbacks.status('Paused');}],
    ['ended', () => {if (active()) callbacks.status(callbacks.finished);}],
    ['error', () => fail('This stream is unavailable or uses a format your browser cannot play. Choose another channel or try again.')]
  ];
  for (const [event, handler] of handlers) element.addEventListener(event, handler);

  function playFailed(cause: unknown) {
    if (!active()) return;
    const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : '';
    if (name === 'AbortError') return;
    if (name === 'NotAllowedError') callbacks.status('Press play to start');
    else fail('Playback could not start. Try this channel again.');
  }

  return {
    isCurrent,
    fail,
    play() {
      if (!active()) return;
      try {void element.play().catch(playFailed);} catch (cause) {playFailed(cause);}
    },
    dispose(cleanup: Array<() => void>) {
      if (disposed) return;
      disposed = true;
      for (const [event, handler] of handlers) {
        try {element.removeEventListener(event, handler);} catch {}
      }
      for (const clean of cleanup) {try {clean();} catch {}}
    }
  };
}
