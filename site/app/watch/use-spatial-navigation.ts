'use client';
import {useEffect, useRef} from 'react';
import {gridWindow, keepsKey, navigate, type Direction, type FieldKind, type NavGroup, type NavItem} from './spatial';

// Arrow keys move focus to the nearest focusable thing in that direction, as on a TV, and Back keys step back. Mouse
// and touch are untouched: everything is an ordinary button or link. Rows ([data-nav-group]) keep left and right to
// themselves and remember the poster that was focused last, so moving down into a row returns to it (as Stremio and
// other TV apps do). Focus stays inside [data-nav-root] (the player, an open menu) and never wanders into the site's
// header or footer. In a long poster grid ([data-nav-grid]) only the posters near the focused one are measured.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
const DIRECTIONS: Record<string, Direction> = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right'};
/** webOS (461) and Tizen (10009) remote Back keys, when a TV browser passes them to the page. */
const REMOTE_BACK = new Set([461, 10009]);
/** Grid items measured on each side of the focused one (more than a grid row ever holds). */
const GRID_WINDOW = 48;

export type SpatialOptions = {
  /** Runs first for every key; returns true when it handled the key (player shortcuts). */
  onKey?: (event: KeyboardEvent) => boolean;
  /** Back with nothing to close: go to the previous screen. */
  onBack: () => void;
  /** Closes an open menu; true when one was open. */
  closeOverlay?: () => boolean;
  enabled: boolean;
};

function visible(element: Element) {
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** True while the player is being used with keys or a remote (the shell's data-input), not a mouse or a finger. */
export function keysMode() {
  return (document.querySelector('.watch-shell') as HTMLElement | null)?.dataset.input === 'keys';
}

/** What a focused element is, for deciding which keys it keeps (spatial.ts keepsKey). */
export function fieldKind(target: Element): FieldKind {
  if (target instanceof HTMLTextAreaElement || (target as HTMLElement).isContentEditable) return 'text';
  if (target instanceof HTMLSelectElement) return 'select';
  if (target instanceof HTMLInputElement) {
    if (target.type === 'range') return 'range';
    if (target.type === 'radio') return 'radio';
    if (['checkbox', 'button', 'submit'].includes(target.type)) return 'toggle';
    return 'text';
  }
  return target instanceof HTMLMediaElement ? 'media' : 'other';
}


export function typingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type);
  return target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Moves focus to an element without the browser's own jump, then scrolls just enough to show it. */
export function focusElement(element: HTMLElement) {
  element.focus({preventScroll: true});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {element.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth'});}
  catch {element.scrollIntoView(false);}
}

/** The focusable elements worth measuring: all of them, except the far parts of long grids. */
function candidatesIn(root: HTMLElement | Document, from: Element) {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const grids = new Map<Element, HTMLElement[]>();
  const inGrid = new Set<Element>();
  for (const element of all) {
    const grid = element.closest('[data-nav-grid]');
    if (!grid) continue;
    inGrid.add(element);
    let list = grids.get(grid);
    if (!list) grids.set(grid, list = []);
    list.push(element);
  }
  if (!grids.size) return all;
  const keep = new Set<Element>();
  for (const list of grids.values()) {
    if (list.length <= GRID_WINDOW * 2) {for (const element of list) keep.add(element); continue;}
    for (const [start, end] of gridWindow(list.indexOf(from as HTMLElement), list.length, GRID_WINDOW)) for (let i = start; i < end; i++) keep.add(list[i]);
  }
  return all.filter(element => !inGrid.has(element) || keep.has(element));
}

export function useSpatialNavigation(options: SpatialOptions) {
  const latest = useRef(options);
  useEffect(() => {latest.current = options;});

  useEffect(() => {
    if (!options.enabled) return;
    const memory = new WeakMap<Element, Element>();
    function onFocus(event: FocusEvent) {
      const target = event.target as Element | null;
      const group = target?.closest?.('[data-nav-group]');
      if (group && target) memory.set(group, target);
    }
    function move(from: HTMLElement, direction: Direction): HTMLElement | null {
      const root: HTMLElement | Document = from.closest<HTMLElement>('dialog[open], [data-nav-root]') || document;
      const elements = candidatesIn(root, from).filter(element => element !== from && !element.closest('[tabindex="-1"]') && visible(element));
      const groupElements: Element[] = [];
      const groupOf = (element: Element) => {
        const group = element.closest('[data-nav-group]');
        if (!group) return -1;
        let index = groupElements.indexOf(group);
        if (index < 0) {index = groupElements.length; groupElements.push(group);}
        return index;
      };
      const items: NavItem[] = elements.map(element => ({box: element.getBoundingClientRect(), group: groupOf(element), rail: Boolean(element.closest('[data-nav-rail]')), inside: from.contains(element)}));
      const self: NavItem = {box: from.getBoundingClientRect(), group: groupOf(from), rail: Boolean(from.closest('[data-nav-rail]'))};
      const groups: NavGroup[] = groupElements.map(group => {
        const remembered = memory.get(group);
        return {box: group.getBoundingClientRect(), remembered: remembered ? elements.indexOf(remembered as HTMLElement) : -1};
      });
      const index = navigate(self, items, groups, direction);
      if (index < 0) return null;
      let target = elements[index];
      // Entering the navigation focuses the current section.
      const rail = target.closest('[data-nav-rail]');
      if (rail && !self.rail) target = rail.querySelector<HTMLElement>('[aria-current="page"]') || target;
      return target;
    }
    function onKey(event: KeyboardEvent) {
      const state = latest.current;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (state.onKey?.(event)) {event.preventDefault(); return;}
      const target = (event.target instanceof Element ? event.target : document.activeElement) as HTMLElement | null;
      const isBack = event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack' || REMOTE_BACK.has(event.keyCode) || (event.key === 'Backspace' && !typingTarget(target));
      if (isBack) {
        // Open dialogs close themselves on Escape.
        if (document.querySelector('.watch-shell dialog[open]')) return;
        if (state.closeOverlay?.()) {event.preventDefault(); return;}
        if (document.fullscreenElement) {void document.exitFullscreen().catch(() => {}); event.preventDefault(); return;}
        // A TV browser's own Back key already goes back in the history; only keys browsers ignore are handled here.
        if (event.key === 'BrowserBack' || REMOTE_BACK.has(event.keyCode)) return;
        if (event.key === 'Escape' && target && typingTarget(target) && (target as HTMLInputElement).value) return;
        event.preventDefault();
        state.onBack();
        return;
      }
      // Enter opens a drop-down's list (a TV browser does this itself; desktop Chrome needs showPicker).
      if (event.key === 'Enter' && target instanceof HTMLSelectElement) {
        const picker = (target as HTMLSelectElement & {showPicker?: () => void}).showPicker;
        if (typeof picker === 'function') {try {picker.call(target); event.preventDefault();} catch {}}
        return;
      }
      const direction = DIRECTIONS[event.key];
      if (!direction) return;
      const from = target && target !== document.body && target.matches?.(FOCUSABLE + ', [tabindex]') ? target : null;
      const kind = from ? fieldKind(from) : 'other';
      if (from && keepsKey(kind, event.key)) return;
      let next: HTMLElement | null;
      if (from) next = move(from, direction);
      else {
        // Nothing focused yet: start in the content.
        const start = Array.from(document.querySelectorAll<HTMLElement>('#main-content [data-nav-start]:not([disabled])')).find(visible);
        next = start || Array.from(document.querySelectorAll<HTMLElement>('#main-content ' + FOCUSABLE.split(', ').join(', #main-content '))).find(element => !element.closest('[tabindex="-1"]') && visible(element)) || null;
      }
      // A drop-down never sees an arrow key, even with nowhere to go: the browser would change its value.
      if (!next) {if (kind === 'select') event.preventDefault(); return;}
      event.preventDefault();
      focusElement(next);
    }
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {document.removeEventListener('focusin', onFocus); document.removeEventListener('keydown', onKey);};
  }, [options.enabled]);
}
