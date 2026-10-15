'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {isEnrollmentStatus} from '../billing-view';

type Status = 'checking' | 'active' | 'pending' | 'cancelled' | 'needs_review' | 'sign_in' | 'error' | 'invalid';

export default function Confirmation({support}: {support: string}) {
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState('Confirming your automatic payment agreement with PayPal…');
  const [busy, setBusy] = useState(true);
  const [busyMessage, setBusyMessage] = useState('Confirming your automatic payment agreement with PayPal…');
  const requestRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    const query = new URLSearchParams(window.location.search);
    const subscription = query.get('subscription') || '';
    const paypalId = query.get('subscription_id') || '';
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(subscription) || !/^I-[A-Z0-9]{1,40}$/.test(paypalId)) {
      setStatus('invalid'); setBusy(false);
      setMessage('This link does not contain a valid automatic payment agreement. Open your return link from PayPal, or sign in to your renewal settings to check the agreement.');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy(true); setBusyMessage('Confirming your automatic payment agreement with PayPal…');
    try {
      const response = await fetch('/api/subscriptions/return?' + new URLSearchParams({subscription, subscription_id: paypalId}), {cache: 'no-store', signal: controller.signal});
      const data = await response.json().catch(() => null) as {error?: {message?: string}} | null;
      if (requestRef.current !== controller) return;
      if (!response.ok) throw new Error(data?.error?.message || 'Your automatic payment agreement could not be checked.');
      if (!isEnrollmentStatus(data)) throw new Error('Your automatic payment result could not be confirmed.');
      let confirmed = data;
      // The public return query never authorizes activation. The server must first prove
      // PayPal approval, then the scoped authenticated endpoint verifies this exact line.
      if (data.activation_available) {
        setBusyMessage('Finishing your approved auto-renew enrollment…');
        const activation = await fetch('/api/player/renew/subscription/activate', {method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({subscription, subscription_id: paypalId})});
        const result = await activation.json().catch(() => null) as {error?: {message?: string}} | null;
        if (requestRef.current !== controller) return;
        if (activation.status === 401) {
          setStatus('sign_in'); setMessage('PayPal approval is received. Sign in with your line login, then choose Finish auto-renew enrollment in your payment settings. No line renewal is confirmed yet.');
          return;
        }
        if (!activation.ok) throw new Error(result?.error?.message || 'Finishing enrollment could not be confirmed.');
        if (!isEnrollmentStatus(result)) throw new Error('The final enrollment status could not be confirmed.');
        confirmed = result;
      }
      setStatus(confirmed.status); setMessage(confirmed.message);
    } catch (cause) {
      if (requestRef.current !== controller) return;
      setStatus('error');
      setMessage(controller.signal.aborted ? 'Confirming the agreement took too long. Check its status below or in PayPal before enrolling again.' : (cause instanceof Error ? cause.message + ' ' : '') + 'Check your renewal settings or PayPal before enrolling or paying again.');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {requestRef.current = null; setBusy(false);}
    }
  }, []);

  useEffect(() => {
    void check();
    return () => {requestRef.current?.abort(); requestRef.current = null;};
  }, [check]);

  const supportLink = 'mailto:' + support + '?subject=LumaNest%20automatic%20payment%20help';
  const heading = status === 'active' ? 'Auto-renew is arranged.' : status === 'cancelled' ? 'Auto-renew is off.' : status === 'sign_in' ? 'One step to finish.' : status === 'needs_review' ? 'Let’s check your agreement.' : status === 'invalid' ? 'Let’s find your agreement.' : 'Your payment agreement.';
  return <div className="checkout-result">
    <header className="checkout-result-header"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a><a href={supportLink}>Contact support ↗</a></header>
    <main className="checkout-result-main"><section className="checkout-result-card" aria-labelledby="agreement-result-title">
      <p className="eyebrow">YOUR AUTOMATIC PAYMENT AGREEMENT</p><h1 id="agreement-result-title">{heading}</h1>
      <div className="checkout-result-status" data-state={status === 'active' ? 'fulfilled' : status} role="status" aria-live="polite" aria-busy={busy}><p>{busy ? busyMessage : message}</p></div>
      <p>{status === 'cancelled' ? 'Future automatic payments are stopped. Any already-paid viewing time stays available.' : status === 'active' ? 'Your payment agreement schedules future automatic renewals. Your existing line is extended only after each payment is confirmed. Sign in to see the next payment date or stop future charges.' : 'PayPal approval and enrollment confirmation are separate steps. Automatic billing begins after enrollment is finished. Your existing line is extended only after a payment is confirmed.'}</p>
      <div className="actions"><a className="button primary" href="/renew?manage_auto=1">{status === 'sign_in' ? 'Sign in to finish enrollment ↗' : 'Open my payment settings ↗'}</a>{!['active', 'cancelled', 'invalid', 'sign_in'].includes(status) && <button className="button secondary" type="button" disabled={busy} onClick={() => void check()}>{busy ? 'Checking agreement…' : 'Check agreement status ↻'}</button>}<a className="button secondary" href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noreferrer">Manage payments in PayPal ↗</a></div>
      <p className="checkout-order-reference">Need help with a payment already received? <a href={supportLink}>Contact LumaNest support before paying again.</a></p>
    </section></main><footer className="checkout-result-footer">LumaNest TV · Settle in. Stay curious.</footer>
  </div>;
}
