// What a key does on the player's video area (player.tsx shortcut). Pure apart from keyTargetOf, so tests run it.

/** Where a key was pressed: nothing focused, the video box itself, the <video> (its own controls), or anything else. */
export type KeyTarget = 'none' | 'stage' | 'media' | 'other';

export function keyTargetOf(target: EventTarget | null): KeyTarget {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement) || target === document.body) return 'none';
  if (target.matches('[data-stage]')) return 'stage';
  if (target instanceof HTMLMediaElement) return 'media';
  return 'other';
}

/**
 * The video box's own keys. On Live TV, ↑/↓ change channel only while the video box itself is focused (anywhere
 * else, and with nothing focused, they move focus). While a movie or episode plays, Enter and Space play or pause
 * when the video box or nothing is focused, never when a button is (Next episode, Send to your TV, Play here).
 */
export function stageKey(key: string, target: KeyTarget, view: string, vodPlaying: boolean): 'next' | 'previous' | 'toggle' | null {
  if (view === 'live' && target === 'stage' && (key === 'ArrowDown' || key === 'ArrowUp')) return key === 'ArrowDown' ? 'next' : 'previous';
  if (vodPlaying && (key === ' ' || key === 'Enter') && (target === 'stage' || target === 'none')) return 'toggle';
  return null;
}
