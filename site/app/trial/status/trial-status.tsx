'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {SiteFooter, SiteHeader} from '../../site-chrome';

type TrialState = 'pending' | 'declined' | 'setting_up' | 'active' | 'ended' | 'support';
type View = TrialState | 'checking' | 'not_found' | 'invalid' | 'error';
type Details = {requested: string; expires: string; left: string; message: string};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STATES: readonly TrialState[] = ['pending', 'declined', 'setting_up', 'active', 'ended', 'support'];
const isTrialState = (value: unknown): value is TrialState => typeof value === 'string' && (STATES as readonly string[]).includes(value);
// Waiting states are re-checked politely: a few times per visit, further apart each time, and only while the tab is visible.
const AUTO_CHECKS = 6;
const firstDelay = (view: View) => view === 'setting_up' ? 5000 : 15000;

function when(iso: unknown) {
  if (typeof iso !== 'string') return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'});
}

function timeLeft(iso: unknown) {
  const end = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (Number.isNaN(end)) return '';
  const hours = (end - Date.now()) / 3600000;
  if (hours <= 0) return '';
  if (hours < 1) return 'less than an hour left';
  const rounded = Math.round(hours);
  return 'about ' + rounded + (rounded === 1 ? ' hour' : ' hours') + ' left';
}

export default function TrialStatus({portal, support}: {portal: string; support: string}) {
  const [view, setView] = useState<View>('checking');
  const [details, setDetails] = useState<Details>({requested: '', expires: '', left: '', message: ''});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [autoChecks, setAutoChecks] = useState(0);
  const [visible, setVisible] = useState(true);
  const requestRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    // The token lives in the fragment, which browsers never send to the server or in a Referer; it is posted in the body.
    const token = window.location.hash.slice(1);
    if (!TOKEN.test(token)) {
      setView('invalid');
      setError('');
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    try {
      const response = await fetch('/api/trial/status', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, body: JSON.stringify({token})});
      const result = await response.json().catch(() => null) as {state?: string; requested_at?: string; expires_at?: string; message?: string; error?: {code?: string; message?: string}} | null;
      if (requestRef.current !== controller) return;
      if (response.status === 404) {
        setView('not_found');
        setError('');
        return;
      }
      if (!response.ok) throw new Error(result?.error?.message || 'We couldn’t check your trial request.');
      if (!result || !isTrialState(result.state)) throw new Error('We couldn’t read your trial status.');
      setDetails({requested: when(result.requested_at), expires: when(result.expires_at), left: result.state === 'active' ? timeLeft(result.expires_at) : '', message: result.state === 'declined' && typeof result.message === 'string' ? result.message.slice(0, 500) : ''});
      setView(result.state);
      setError('');
    } catch (cause) {
      if (requestRef.current !== controller) return;
      // Keep showing the last known state; the error appears beside it and stops automatic checks until "Check again".
      setView(current => isTrialState(current) ? current : 'error');
      setError(controller.signal.aborted ? 'Checking your trial took too long. Please try again in a moment.' : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'We couldn’t reach LumaNest to check your trial. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {requestRef.current = null; setBusy(false);}
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- checks the trial with the server on mount; the token in the URL fragment only exists after hydration
    void check();
    const changed = () => {requestRef.current?.abort(); requestRef.current = null; setAutoChecks(0); void check();};
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    window.addEventListener('hashchange', changed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('hashchange', changed);
      document.removeEventListener('visibilitychange', visibility);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [check]);

  useEffect(() => {
    if ((view !== 'pending' && view !== 'setting_up') || busy || error || !visible || autoChecks >= AUTO_CHECKS) return;
    const timer = window.setTimeout(() => {setAutoChecks(count => count + 1); void check();}, firstDelay(view) * 2 ** autoChecks);
    return () => window.clearTimeout(timer);
  }, [view, busy, error, visible, autoChecks, check]);

  const supportLink = 'mailto:' + support + '?subject=' + encodeURIComponent('LumaNest free trial');
  const copy: Record<View, {eyebrow: string; heading: string; status: string; body: string}> = {
    checking: {eyebrow: 'YOUR FREE TRIAL', heading: 'Checking on your trial…', status: 'Checking your trial request…', body: ''},
    pending: {eyebrow: 'REQUEST RECEIVED', heading: 'Your request is in the queue.', status: 'Waiting for review. We check every request by hand, as soon as we can.', body: 'When your trial is approved, your customer hub will email an invitation to the address you gave us. You don’t need to keep this page open: bookmark it and check back any time.'},
    setting_up: {eyebrow: 'APPROVED', heading: 'We’re setting up your trial.', status: 'Your request was approved. Your trial is being set up now.', body: 'Your customer hub invitation should arrive by email shortly. It can take a few minutes, so check your spam folder too.'},
    active: {eyebrow: 'WELCOME IN', heading: 'Your trial is ready.', status: details.expires ? 'Your free trial is active until ' + details.expires + (details.left ? ' (' + details.left + ').' : '.') : 'Your free trial is active.', body: 'Check your email for your customer hub invitation. Accept it to set your password, then open the hub to find your line login for the web player and TV apps.'},
    ended: {eyebrow: 'THANKS FOR STOPPING BY', heading: 'Your free trial has ended.', status: details.expires ? 'Your trial ended ' + details.expires + '.' : 'Your trial has ended.', body: 'We hope you felt at home. Whenever you’re ready to keep watching, choose a plan that fits your household.'},
    declined: {eyebrow: 'YOUR TRIAL REQUEST', heading: 'We couldn’t offer a trial this time.', status: 'Your trial request wasn’t approved.', body: 'You can still choose a plan, or contact support if you have any questions.'},
    support: {eyebrow: 'YOUR TRIAL REQUEST', heading: 'Your trial needs a hand.', status: 'Your request needs a closer look from our team.', body: 'If you haven’t heard from us by email, contact support and include the email address you used for your request.'},
    not_found: {eyebrow: 'YOUR TRIAL REQUEST', heading: 'Let’s find your trial.', status: 'We couldn’t find that trial request. Check the link from your request.', body: 'Open the private link you saved when you sent your request. If you’ve lost it, contact support with the email address you used.'},
    invalid: {eyebrow: 'YOUR TRIAL REQUEST', heading: 'Let’s find your trial.', status: 'This link doesn’t include a valid trial reference.', body: 'Open the private link you saved when you sent your request. If you’ve lost it, contact support with the email address you used.'},
    error: {eyebrow: 'YOUR TRIAL REQUEST', heading: 'Let’s check your trial.', status: error || 'We couldn’t check your trial request.', body: 'Your request is safe. Please try again in a moment.'},
  };
  const text = copy[view];
  const waiting = view === 'pending' || view === 'setting_up';
  const checkAgain = (waiting || view === 'error') && <button type="button" className="button primary" disabled={busy} onClick={() => {setError(''); void check();}}>{busy ? 'Checking…' : 'Check again'}<span aria-hidden="true">↻</span></button>;
  const contact = <a className="button secondary" href={supportLink}>Contact support <span aria-hidden="true">↗</span></a>;
  const home = <a className="button secondary" href="/">Back to LumaNest <span aria-hidden="true">↗</span></a>;

  return <div className="checkout-result trial-result">
    <SiteHeader portal={portal} install={false}/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card trial-result-card" aria-labelledby="trial-status-title">
      <p className="eyebrow">{text.eyebrow}</p>
      <h1 id="trial-status-title">{text.heading}</h1>
      <div className="checkout-result-status trial-status-box" data-state={view} role="status" aria-live="polite" aria-busy={busy}><p>{busy && view === 'checking' ? 'Checking your trial request…' : text.status}</p></div>
      {error && view !== 'error' && <p role="alert" className="trial-error">{error}</p>}
      {details.message && view === 'declined' && <div className="trial-owner-message"><p>A NOTE FROM LUMANEST</p><p>{details.message}</p></div>}
      {(details.requested || details.expires) && STATES.includes(view as TrialState) && <dl className="trial-status-meta">
        {details.requested && <div><dt>Requested</dt><dd>{details.requested}</dd></div>}
        {details.expires && (view === 'active' || view === 'ended') && <div><dt>{view === 'active' ? 'Trial ends' : 'Trial ended'}</dt><dd>{details.expires}</dd></div>}
      </dl>}
      {text.body && <p>{text.body}</p>}
      <div className="actions">{view === 'active' ? <>
        <a className="button primary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a>
        <a className="button secondary" href={portal}>Open customer hub <span aria-hidden="true">↗</span></a>
        <a className="button secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a>
      </> : view === 'ended' || view === 'declined' ? <>
        <a className="button primary" href="/#plans">Choose a plan <span aria-hidden="true">↗</span></a>
        {contact}
      </> : view === 'checking' ? null : <>{checkAgain}{contact}{home}</>}</div>
    </section></main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
