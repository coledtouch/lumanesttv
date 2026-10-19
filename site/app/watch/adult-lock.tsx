'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {hashPasscode} from '../../lib/player-data';

// Adult categories stay hidden until they are unlocked with a 4-digit passcode chosen in this browser. Only a salted
// SHA-256 hash of the passcode is stored, in this browser's localStorage; unlocking lasts until the page is reloaded.

type Stored = {salt: string; hash: string};
type Attempts = {fails: number; until: number};
type Mode = 'create' | 'enter' | 'change' | 'unlocked';

const PASSCODE_KEY = 'lumanest_adult_passcode';
const ATTEMPTS_KEY = 'lumanest_adult_attempts';
const MAX_TRIES = 5;
const WAIT_MS = 60_000;
const PASSCODE = /^\d{4}$/;

function readJSON(key: string): unknown {
  try {return JSON.parse(localStorage.getItem(key) || 'null');} catch {return null;}
}
function writeJSON(key: string, value: unknown) {
  try {localStorage.setItem(key, JSON.stringify(value)); return true;} catch {return false;}
}
function storedPasscode(): Stored | null {
  const value = readJSON(PASSCODE_KEY) as Partial<Stored> | null;
  return value && typeof value.salt === 'string' && typeof value.hash === 'string' && /^[0-9a-f]{64}$/.test(value.hash) ? {salt: value.salt, hash: value.hash} : null;
}
function readAttempts(): Attempts {
  const value = readJSON(ATTEMPTS_KEY) as Partial<Attempts> | null;
  return {fails: Number(value?.fails) || 0, until: Number(value?.until) || 0};
}
async function savePasscode(passcode: string) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!writeJSON(PASSCODE_KEY, {salt, hash: await hashPasscode(passcode, salt)})) throw new Error('This browser could not save the passcode. Check that site data is allowed.');
}

function PasscodeField({label, name, autoFocus}: {label: string; name: string; autoFocus?: boolean}) {
  const id = useId();
  return <div className="watch-passcode-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} name={name} type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required
      autoComplete="off" autoCorrect="off" spellCheck={false} autoFocus={autoFocus} aria-describedby={id + '-hint'}/>
    <small id={id + '-hint'}>4 digits</small>
  </div>;
}

export default function AdultLock({unlocked, onUnlock, onLock}: {unlocked: boolean; onUnlock: () => void; onLock: () => void}) {
  const [mode, setMode] = useState<Mode>('enter');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Counts down the wait after too many wrong tries.
  useEffect(() => {
    if (!waitUntil) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= waitUntil) setWaitUntil(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);

  function open() {
    const attempts = readAttempts();
    setError(''); setNow(Date.now()); setWaitUntil(attempts.until > Date.now() ? attempts.until : 0);
    setMode(unlocked ? 'unlocked' : storedPasscode() ? 'enter' : 'create');
    dialog.current?.showModal();
  }
  function close() {dialog.current?.close();}

  /** Checks a passcode against the stored hash, counting wrong tries towards the wait. Returns an error, or ''. */
  async function verify(passcode: string) {
    const stored = storedPasscode();
    if (!stored) return '';
    const attempts = readAttempts();
    if (attempts.until > Date.now()) {setWaitUntil(attempts.until); setNow(Date.now()); return 'wait';}
    if (await hashPasscode(passcode, stored.salt) === stored.hash) {writeJSON(ATTEMPTS_KEY, {fails: 0, until: 0}); return '';}
    const fails = attempts.fails + 1;
    if (fails >= MAX_TRIES) {
      const until = Date.now() + WAIT_MS;
      writeJSON(ATTEMPTS_KEY, {fails: 0, until}); setWaitUntil(until); setNow(Date.now());
      return 'wait';
    }
    writeJSON(ATTEMPTS_KEY, {fails, until: 0});
    const left = MAX_TRIES - fails;
    return `That passcode is not right. ${left} ${left === 1 ? 'try' : 'tries'} left before a 60-second wait.`;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (name: string) => String(fields.get(name) || '');
    setError('');
    if (['passcode', 'current', 'next', 'confirm'].some(name => fields.has(name) && !PASSCODE.test(value(name)))) {
      setError('Enter exactly 4 digits.'); return;
    }
    if (fields.has('confirm') && value('next') !== value('confirm')) {setError('The two new passcodes do not match.'); return;}
    setBusy(true);
    try {
      const problem = mode === 'create' ? '' : await verify(value(mode === 'enter' ? 'passcode' : 'current'));
      // The countdown message replaces the error while the wait runs.
      if (problem) {if (problem !== 'wait') setError(problem); form.reset(); return;}
      if (mode !== 'enter') await savePasscode(value('next'));
      if (mode !== 'change') onUnlock();
      close();
    } catch (cause) {
      setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'This browser cannot check a passcode here. Open the player over a secure (https) connection.');
    } finally {setBusy(false);}
  }

  const waiting = waitUntil > now ? Math.ceil((waitUntil - now) / 1000) : 0;
  const needsCurrent = mode === 'enter' || mode === 'change';
  return <>
    <button type="button" className="watch-adult-open" aria-haspopup="dialog" onClick={open}>
      Adult content: {unlocked ? 'Unlocked' : 'Locked'}
    </button>
    <dialog ref={dialog} className="watch-shortcuts watch-adult" aria-labelledby={titleId} onClose={() => {setError(''); setBusy(false);}}>
      <h2 id={titleId}>{mode === 'create' ? 'Create an adult passcode' : mode === 'change' ? 'Change passcode' : 'Adult content'}</h2>
      {mode === 'unlocked' ? <>
        <p>Adult categories are showing in your lineup and in Movies &amp; Series. Lock them again whenever you like; no passcode is needed to lock.</p>
        <div className="watch-adult-actions">
          <button type="button" className="button primary" onClick={() => {onLock(); close();}}>Lock adult content</button>
          <button type="button" className="small-button" onClick={() => {setError(''); setMode('change');}}>Change passcode</button>
          <button type="button" className="small-button" onClick={close}>Close</button>
        </div>
      </> : <form key={mode} onSubmit={event => void submit(event)} aria-busy={busy} noValidate>
        <p>{mode === 'create' ? 'Adult categories are hidden. Choose a 4-digit passcode to unlock them in this browser.'
          : mode === 'enter' ? 'Adult categories are hidden. Enter your passcode to show them until you lock them or reload the page.'
            : 'Enter your current passcode, then choose a new one.'}</p>
        {mode === 'enter' && <PasscodeField label="Passcode" name="passcode" autoFocus/>}
        {mode === 'change' && <PasscodeField label="Current passcode" name="current" autoFocus/>}
        {mode !== 'enter' && <>
          <PasscodeField label="New passcode" name="next" autoFocus={mode === 'create'}/>
          <PasscodeField label="Enter the new passcode again" name="confirm"/>
        </>}
        {error && <p className="watch-error" role="alert">{error}</p>}
        {needsCurrent && waiting > 0 && <p className="watch-error" role="alert">Too many wrong tries. Try again in {waiting} s.</p>}
        <div className="watch-adult-actions">
          <button className="button primary" disabled={busy || (needsCurrent && waiting > 0)}>{mode === 'create' ? 'Save and unlock' : mode === 'enter' ? 'Unlock' : 'Save new passcode'}</button>
          {mode === 'enter' && <button type="button" className="small-button" onClick={() => {setError(''); setMode('change');}}>Change passcode</button>}
          <button type="button" className="small-button" onClick={close}>Cancel</button>
        </div>
        {mode !== 'create' && <p className="watch-adult-note">Forgot the passcode? Clear this site’s data in your browser. That also removes your favorites on this browser.</p>}
      </form>}
    </dialog>
  </>;
}
