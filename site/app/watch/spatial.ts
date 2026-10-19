// Moving focus with a TV remote's or keyboard's arrow keys: which focusable box comes next in a direction. Pure
// geometry over boxes measured by use-spatial-navigation.ts.

export type Box = {left: number; top: number; right: number; bottom: number};
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Gap between two ranges on one axis; 0 when they overlap or touch. */
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

/**
 * The index of the box to move to from `from`, or -1. A candidate must lie beyond the edge of `from` in the
 * direction (1 px tolerance). Candidates that overlap `from` on the other axis (the same row for left/right, the same
 * column for up/down) win over the rest; then the smallest distance (the gap in the direction plus twice the gap
 * across it); then the box whose centre is nearest across the direction; then the earlier box (DOM order).
 */
export function nextInDirection(from: Box, boxes: Box[], direction: Direction): number {
  let best = -1, bestAligned = false, bestScore = Infinity, bestCentre = Infinity;
  const horizontal = direction === 'left' || direction === 'right';
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue;
    let primary: number;
    if (direction === 'right') {if (box.left < from.right - 1) continue; primary = box.left - from.right;}
    else if (direction === 'left') {if (box.right > from.left + 1) continue; primary = from.left - box.right;}
    else if (direction === 'down') {if (box.top < from.bottom - 1) continue; primary = box.top - from.bottom;}
    else {if (box.bottom > from.top + 1) continue; primary = from.top - box.bottom;}
    const across = horizontal ? gap(from.top, from.bottom, box.top, box.bottom) : gap(from.left, from.right, box.left, box.right);
    const aligned = (horizontal ? overlap(from.top, from.bottom, box.top, box.bottom) : overlap(from.left, from.right, box.left, box.right)) > 0;
    const score = Math.max(0, primary) + 2 * across;
    // Between equally near boxes, the one whose centre is closest across the direction.
    const centre = horizontal ? Math.abs((box.top + box.bottom) - (from.top + from.bottom)) / 2 : Math.abs((box.left + box.right) - (from.left + from.right)) / 2;
    if ((aligned && !bestAligned) || (aligned === bestAligned && (score < bestScore || (score === bestScore && centre < bestCentre)))) {
      best = i; bestAligned = aligned; bestScore = score; bestCentre = centre;
    }
  }
  return best;
}

/** True when a box is at least partly inside another (a poster inside its row's visible area). */
export function intersects(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** A focusable item as arrow keys see it: its box, the row ([data-nav-group]) it is in (-1: none), whether it is in
 * the navigation rail, and whether it is inside the focused element (a button over the focused video). */
export type NavItem = {box: Box; group: number; rail: boolean; inside?: boolean};
/** A row: its visible area, and the item focused there last (-1: none, or no longer there). */
export type NavGroup = {box: Box; remembered: number};

/**
 * Where an arrow key moves focus from `from` among `items` (an index, or -1 to stay):
 * - A button inside the focused element (Next episode over the focused video) comes first, whatever the arrow.
 * - Left and right inside a row stay in that row. At its start, left may enter the navigation rail; at its end,
 *   nothing: a remote never jumps into the row below.
 * - Up and down stay out of the rail unless nothing else is there (it is at the bottom on phones).
 * - Entering a row up or down returns to the item last focused there while it is in view, as TV apps do; coming from
 *   outside any row (a search field, a button), to the row's first item in view rather than whichever is nearest.
 */
export function navigate(from: NavItem, items: NavItem[], groups: NavGroup[], direction: Direction): number {
  const inner = items.findIndex(item => item.inside);
  if (inner >= 0) return inner;
  const vertical = direction === 'up' || direction === 'down';
  const pick = (keep: (item: NavItem) => boolean) => {
    const indices: number[] = [];
    for (let i = 0; i < items.length; i++) if (keep(items[i])) indices.push(i);
    const found = nextInDirection(from.box, indices.map(i => items[i].box), direction);
    return found < 0 ? -1 : indices[found];
  };
  if (!vertical && from.group >= 0) {
    const inRow = pick(item => item.group === from.group);
    if (inRow >= 0 || direction === 'right') return inRow;
    return pick(item => item.rail);
  }
  let target = vertical && !from.rail ? pick(item => !item.rail) : -1;
  if (target < 0) target = pick(() => true);
  if (target < 0) return -1;
  const group = items[target].group;
  if (vertical && group >= 0 && group !== from.group && groups[group]) {
    const row = groups[group];
    if (row.remembered >= 0 && items[row.remembered] && intersects(items[row.remembered].box, row.box)) return row.remembered;
    if (from.group < 0) {
      const first = items.findIndex(item => item.group === group && intersects(item.box, row.box));
      if (first >= 0) return first;
    }
  }
  return target;
}

/**
 * The part of a long grid worth measuring for an arrow key: the items within `size` places of the focused one
 * (`at`), or, from outside the grid, its first and last `size` items. The next item in any direction is always
 * among them, as long as a grid row has fewer than `size` items.
 */
export function gridWindow(at: number, length: number, size: number): [number, number][] {
  if (at >= 0) return [[Math.max(0, at - size), Math.min(length, at + size + 1)]];
  if (length <= size * 2) return [[0, length]];
  return [[0, size], [length - size, length]];
}

/** What a focused element is, for deciding which arrow keys it keeps. */
export type FieldKind = 'text' | 'range' | 'radio' | 'toggle' | 'select' | 'media' | 'other';

/**
 * Arrow keys a focused field keeps for itself. A text field keeps left and right (the caret) and a slider or radio
 * group left and right (its value); up and down leave them. A drop-down keeps none: its value would change as a remote
 * moves past it, so arrows move on and Enter opens it. A focused video keeps its own arrows (seeking and volume).
 */
export function keepsKey(kind: FieldKind, key: string) {
  if (kind === 'text' || kind === 'range' || kind === 'radio') return key === 'ArrowLeft' || key === 'ArrowRight';
  return kind === 'media';
}
