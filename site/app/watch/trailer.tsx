'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {Clapperboard} from 'lucide-react';
import {extrasClient, tmdbId, trailerFrame, trailerQuery, trailerWatchURL, type ExtrasTitle, type TrailerInfo} from './extras';
import {focusElement} from './use-spatial-navigation';

// A movie's or series' Trailer (docs/extras.md, "The Trailer button"): lumanest.tv finds the title's YouTube trailer
// with TMDB, and the button appears only when it found one, after Add to Library, without taking focus. Trailer opens a
// dialog with YouTube's privacy-enhanced player, sandboxed (trailerFrame); nothing is loaded from YouTube before that,
// and the player is removed again when the dialog closes.

/** The trailer a lookup query names ("" for none), or null while it is asked or when there is none. */
function useTrailer(query: string) {
  const [found, setFound] = useState<{query: string; trailer: TrailerInfo | null}>({query: '', trailer: null});
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    void extrasClient().trailer(query).then(trailer => {if (!cancelled) setFound({query, trailer});});
    return () => {cancelled = true;};
  }, [query]);
  return query && found.query === query ? found.trailer : null;
}

/** Back keys a remote or keyboard may send while the dialog is open (Escape closes a dialog by itself). */
const isBackKey = (event: React.KeyboardEvent) =>
  event.key === 'GoBack' || event.key === 'BrowserBack' || event.keyCode === 461 || event.keyCode === 10009 ||
  (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement));

/**
 * detailsTmdb: the provider's TMDB id from the title's details; detailsPending: those details are still loading. A title
 * whose row has no TMDB id of its own waits for them, so the page asks once, with the best id it has.
 */
export default function TrailerButton({title, detailsTmdb, detailsPending}: {title: ExtrasTitle; detailsTmdb: string; detailsPending: boolean}) {
  const query = detailsPending && !tmdbId(title.hint) ? '' : trailerQuery(title, detailsTmdb);
  const trailer = useTrailer(query);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    if (!element.open) element.showModal();
    if (closeButton.current) focusElement(closeButton.current);
  }, [open]);

  const frame = trailer ? trailerFrame(trailer.key) : null;
  if (!trailer || !frame) return null;
  const close = () => dialog.current?.close();
  return <>
    <button ref={button} type="button" className="small-button" data-focus-key="action:trailer" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Clapperboard size={16} aria-hidden="true"/> Trailer
    </button>
    {open && <dialog ref={dialog} className="watch-shortcuts watch-trailer" aria-labelledby={titleId}
      onClose={() => {setOpen(false); if (button.current) focusElement(button.current);}}
      onKeyDown={event => {if (isBackKey(event)) {event.preventDefault(); event.stopPropagation(); close();}}}>
      <p className="eyebrow">TRAILER</p>
      <h2 id={titleId}>{title.name}</h2>
      <div className="watch-trailer-frame">
        <iframe src={frame.src} title={frame.title} allow={frame.allow} allowFullScreen={frame.allowFullScreen} referrerPolicy={frame.referrerPolicy} sandbox={frame.sandbox}/>
      </div>
      <div className="watch-trailer-actions">
        <button ref={closeButton} type="button" className="small-button" onClick={close}>Close</button>
        <a className="small-button" href={trailerWatchURL(trailer.key)} target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>
      </div>
    </dialog>}
  </>;
}
