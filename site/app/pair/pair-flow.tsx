'use client';
import {useCallback, useEffect, useState} from 'react';

type Pending = {code: string; device: string; username: string};
type ApiError = {error?: {code?: string; message?: string}};
type Step = {kind: 'code'} | {kind: 'checking'} | {kind: 'login'} | {kind: 'confirm'; pending: Pending} | {kind: 'done'; device: string};
const message = (cause: unknown, fallback: string) => cause instanceof Error && !(cause instanceof TypeError) ? cause.message : fallback;

export default function PairFlow({initialCode}: {initialCode: string}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [step, setStep] = useState<Step>(initialCode ? {kind: 'checking'} : {kind: 'code'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async (value: string) => {
    setError(''); setStep({kind: 'checking'});
    try {
      const response = await fetch('/api/player/pair?code=' + encodeURIComponent(value), {cache: 'no-store'});
      const data = await response.json().catch(() => null) as (Pending & ApiError) | null;
      if (response.status === 401) return setStep({kind: 'login'});
      if (!response.ok || !data) throw new Error(data?.error?.message || 'That code could not be checked.');
      setStep({kind: 'confirm', pending: data});
    } catch (cause) {setError(message(cause, 'Check your connection and try again.')); setStep({kind: 'code'});}
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- a code from the QR link is checked once on arrival
  useEffect(() => {if (initialCode) void check(initialCode);}, [initialCode, check]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/player/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: fields.get('username'), password: fields.get('password')})});
      const data = await response.json().catch(() => null) as ApiError | null;
      if (!response.ok) throw new Error(data?.error?.message || 'Your line login could not be verified.');
      await check(code);
    } catch (cause) {setError(message(cause, 'Sign-in failed. Please check your connection and try again.'));}
    finally {setBusy(false);}
  }

  async function approve(pending: Pending) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/player/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: pending.code})});
      const data = await response.json().catch(() => null) as ({device: string} & ApiError) | null;
      if (!response.ok || !data) throw new Error(data?.error?.message || 'The TV could not be paired.');
      setStep({kind: 'done', device: data.device});
    } catch (cause) {setError(message(cause, 'Check your connection and try again.'));}
    finally {setBusy(false);}
  }

  return <section className="pair-card" aria-busy={busy || step.kind === 'checking'}>
    <p className="eyebrow"><i className="status-dot"/> PAIR YOUR TV</p>
    {step.kind === 'code' && <>
      <h1>Enter the code<br/>on your <em>TV.</em></h1>
      <p className="pair-lede">Open Tuner on your TV and choose <strong>Pair with your phone</strong>. Scan the QR code, or type the 8-letter code shown under it.</p>
      <form onSubmit={e => {e.preventDefault(); void check(code);}}>
        <label>TV code<input className="pair-code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" maxLength={9} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required/></label>
        <button className="button primary">Continue <span aria-hidden="true">→</span></button>
      </form>
    </>}
    {step.kind === 'checking' && <p className="pair-status" role="status"><span className="pair-spinner" aria-hidden="true"/>Checking your code…</p>}
    {step.kind === 'login' && <>
      <h1>Sign in to<br/>connect your <em>TV.</em></h1>
      <p className="pair-lede">Use the <strong>line username and password</strong> from your customer hub. Your TV is set up with this line automatically, so you don’t have to type it with the remote.</p>
      <form onSubmit={signIn}>
        <label>Line username<input name="username" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>
        <label>Line password<input name="password" type="password" required maxLength={150} autoComplete="current-password"/></label>
        <button className="button primary" disabled={busy}>{busy ? 'Checking your line…' : 'Sign in and continue'} <span aria-hidden="true">→</span></button>
      </form>
    </>}
    {step.kind === 'confirm' && <>
      <h1>Connect this<br/><em>TV?</em></h1>
      <dl className="pair-summary"><div><dt>TV</dt><dd>{step.pending.device}</dd></div><div><dt>Code</dt><dd className="pair-code">{step.pending.code}</dd></div><div><dt>Line</dt><dd>{step.pending.username}</dd></div></dl>
      <p className="pair-warning">Only approve a code that is on your own TV screen right now. The TV gets your line login and can watch with it.</p>
      <div className="pair-actions"><button type="button" className="button primary" disabled={busy} onClick={() => void approve(step.pending)}>{busy ? 'Connecting…' : 'Connect my TV'} <span aria-hidden="true">✓</span></button><button type="button" className="button secondary" disabled={busy} onClick={() => {setCode(''); setStep({kind: 'code'});}}>That’s not my code</button></div>
    </>}
    {step.kind === 'done' && <>
      <h1>You’re all<br/><em>set.</em></h1>
      <p className="pair-lede" role="status">Your {step.device} is loading your channels now. You can put your phone away.</p>
      <a className="button secondary" href="/watch">Or watch here in your browser <span aria-hidden="true">↗</span></a>
    </>}
    {error && <p className="pair-error" role="alert">{error}</p>}
  </section>;
}
