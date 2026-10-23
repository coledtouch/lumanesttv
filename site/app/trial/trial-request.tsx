'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {TRIAL_DEVICES} from '../../lib/trial-devices';

// The API answers with a same-site path whose fragment is the private token; the token never goes in a query string.
const STATUS_URL = /^\/trial\/status#[A-Za-z0-9_-]{43}$/;

type Failure = {message: string; code?: string};

export default function TrialRequest({support}: {support: string}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<{link: string; email: string} | null>(null);
  const [copied, setCopied] = useState<'' | 'copied' | 'selected'>('');
  const submittingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {if (event.persisted) {submittingRef.current = false; setBusy(false);}};
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  useEffect(() => {
    if (done) headingRef.current?.focus();
  }, [done]);

  // The controls are disabled while sending, so focus moves to the error once one is shown.
  function fail(next: Failure) {
    setFailure(next);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setFailure(null);
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email') || '').trim();
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch('/api/trial', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
        body: JSON.stringify({name: String(fields.get('name') || '').trim(), email, device: String(fields.get('device') || ''), consent: fields.get('consent') === 'on', website: String(fields.get('website') || '')}),
      });
      const result = await response.json().catch(() => null) as {state?: string; status_url?: string; message?: string; error?: {code?: string; message?: string}} | null;
      if (!response.ok) {
        fail({message: result?.error?.message || result?.message || 'We couldn’t send your trial request. Please try again or contact support.', code: result?.error?.code});
        submittingRef.current = false;
        setBusy(false);
        return;
      }
      if (result?.state !== 'pending' || typeof result.status_url !== 'string' || !STATUS_URL.test(result.status_url)) throw new Error('We couldn’t create your private status link. Please contact support before requesting again.');
      setDone({link: new URL(result.status_url, window.location.origin).href, email});
      setBusy(false);
    } catch (cause) {
      fail({message: abort.signal.aborted ? 'Sending your request took too long. Please try again, or contact support if it keeps happening.' : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'We couldn’t reach LumaNest. Check your connection and try again.'});
      submittingRef.current = false;
      setBusy(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function copy() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.link);
      setCopied('copied');
    } catch {
      // No clipboard access (an older browser or an insecure context): select the link so it can be copied by hand.
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopied('selected');
    }
  }

  if (done) return <section className="trial-card" aria-labelledby="trial-done-title">
    <p className="eyebrow trial-eyebrow">REQUEST RECEIVED</p>
    <h2 id="trial-done-title" ref={headingRef} tabIndex={-1}>You’re on the <em>list.</em></h2>
    <p>Thanks! We review every trial request by hand, as soon as we can. Once yours is approved, your customer hub will email an invitation to <strong>{done.email}</strong> so you can sign in and start watching.</p>
    <div className="trial-link-box">
      <label htmlFor="trial-status-link">Your private status link</label>
      <div className="trial-link-row">
        <input id="trial-status-link" ref={linkRef} readOnly value={done.link} onFocus={event => event.currentTarget.select()} aria-describedby="trial-status-link-help"/>
        <button type="button" className="button secondary" onClick={() => void copy()}>{copied === 'copied' ? 'Copied' : 'Copy link'}</button>
      </div>
      <p id="trial-status-link-help" className="trial-help">Bookmark it or save it somewhere safe — it’s how you check on your request, and we can’t show it again. Keep it private: anyone with the link can see whether your trial was approved.</p>
      <p className="trial-copy-status" role="status">{copied === 'copied' ? 'Link copied.' : copied === 'selected' ? 'The link is selected. Use your device’s copy command to copy it.' : ''}</p>
    </div>
    <div className="trial-actions"><a className="button primary" href={done.link}>Check my request <span aria-hidden="true">↗</span></a></div>
    <ul className="trial-next">
      <li>Keep an eye on your inbox, and your spam folder, for the customer hub invitation.</li>
      <li>Your 24 hours start when your trial is activated. It ends on its own, with nothing to pay or cancel.</li>
      <li>If we can’t offer you a trial, you’ll see that on your status link. We don’t email declines.</li>
    </ul>
  </section>;

  return <section className="trial-card" aria-labelledby="trial-form-title">
    <h2 id="trial-form-title">Request your <em>free trial.</em></h2>
    <form className="trial-form" method="post" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="trial-name">Your name<input id="trial-name" name="name" required maxLength={100} autoComplete="name" disabled={busy}/></label>
      <label htmlFor="trial-email">Email address<input id="trial-email" name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" disabled={busy} aria-describedby="trial-email-help"/></label>
      <p id="trial-email-help" className="trial-help">If your trial is approved, your customer hub invitation is sent here.</p>
      <label htmlFor="trial-device">Where will you watch first?<select id="trial-device" name="device" required defaultValue="" disabled={busy} aria-describedby="trial-device-help"><option value="" disabled>Choose a device</option>{TRIAL_DEVICES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <p id="trial-device-help" className="trial-help">This helps us point you to the right setup steps.</p>
      <div className="trial-hp" aria-hidden="true"><label htmlFor="trial-website">Leave this field empty<input id="trial-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue=""/></label></div>
      <label className="trial-consent" htmlFor="trial-consent"><input id="trial-consent" name="consent" type="checkbox" required disabled={busy}/><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of service</a>, including the free trial terms, and I’ve read the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</span></label>
      {failure && <p ref={errorRef} tabIndex={-1} role="alert" className="trial-error">{failure.message}{failure.code === 'trial_already_requested' && <> Lost your status link? <a href={'mailto:' + support + '?subject=' + encodeURIComponent('LumaNest free trial')}>Contact support</a>.</>}{failure.code === 'trial_network_used' && <> <a href="/#plans">See plans</a> · <a href={'mailto:' + support + '?subject=' + encodeURIComponent('LumaNest free trial')}>Contact support</a></>}{failure.code === 'trials_unavailable' && <> <a href="/#plans">See plans</a></>}</p>}
      <button type="submit" className="button primary" disabled={busy}>{busy ? 'Sending your request…' : 'Request my free trial'}<span aria-hidden="true">↗</span></button>
      <p className="trial-note">No payment details needed. One trial per person and household.</p>
    </form>
  </section>;
}
