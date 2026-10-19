'use client';
import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {ChevronDown, Check} from 'lucide-react';

// A labelled button that opens a short list of choices (Discover's Type, List and Genre; a series' seasons). Arrow
// keys stay inside the open list ([data-nav-root]); Enter chooses; Escape, Back or a click elsewhere closes it and
// focus returns to the button.

const openMenus: (() => void)[] = [];
/** Closes the most recently opened menu; true when there was one (the player's Back key). */
export function closeOpenMenu() {
  const close = openMenus[openMenus.length - 1];
  if (!close) return false;
  close();
  return true;
}

export type MenuOption = {value: string; label: string};

export default function FilterMenu({label, value, options, onChange, className}: {label: string; value: string; options: MenuOption[]; onChange: (value: string) => void; className?: string}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find(option => option.value === value) || options[0];

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus({preventScroll: true});
  }, []);

  useEffect(() => {
    if (!open) return;
    const entry = () => close();
    openMenus.push(entry);
    // The chosen option gets focus, so arrows start from it.
    const list = wrapper.current?.querySelector<HTMLElement>('[aria-checked="true"]') || wrapper.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    list?.focus({preventScroll: true});
    list?.scrollIntoView({block: 'nearest'});
    const outside = (event: PointerEvent) => {if (!wrapper.current?.contains(event.target as Node)) close(false);};
    document.addEventListener('pointerdown', outside);
    return () => {
      const index = openMenus.indexOf(entry);
      if (index >= 0) openMenus.splice(index, 1);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close]);

  return <div className={'filter-menu ' + (className || '')} ref={wrapper} onKeyDown={event => {
    if (open && (event.key === 'Escape' || (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement)))) {event.preventDefault(); event.stopPropagation(); close();}
    if (open && event.key === 'Tab') close(false);
  }}>
    <button ref={button} type="button" className="filter-menu-button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(value => !value)}>
      <small>{label}</small><span>{current?.label}</span><ChevronDown size={16} aria-hidden="true"/>
    </button>
    {open && <div className="filter-menu-list" id={listId} role="menu" aria-label={label} data-nav-root="">
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === current?.value} onClick={() => {onChange(option.value); close();}}>
        <span>{option.label}</span>{option.value === current?.value && <Check size={16} aria-hidden="true"/>}
      </button>)}
    </div>}
  </div>;
}
