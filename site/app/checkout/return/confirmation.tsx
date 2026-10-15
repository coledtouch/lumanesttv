'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {SiteFooter, SiteHeader} from '../../site-chrome';

type OrderState = 'checking' | 'fulfilled' | 'sandbox_paid' | 'needs_review' | 'processing' | 'error' | 'invalid';

export default function Confirmation({portal, support}: {portal: string; support: string}) {
  const [message, setMessage] = useState('Confirming your payment and subscription…');
  const [state, setState] = useState<OrderState>('checking');
  const [busy, setBusy] = useState(true);
  const [orderReference, setOrderReference] = useState('');
  const [autoChecks, setAutoChecks] = useState(0);
  const requestRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (requestRef.current && !requestRef.current.signal.aborted) return;
    const query = new URLSearchParams(window.location.search);
    const order = query.get('order') || '';
    const token = query.get('token') || '';
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(order) || !/^[A-Z0-9]{10,40}$/.test(token)) {
      setState('invalid');
      setMessage('This link does not contain a valid order reference. Open the return link from PayPal, or contact support with your receipt before paying again.');
      setBusy(false);
      return;
    }
    setOrderReference(order);
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    try {
      const response = await fetch('/api/checkout/capture', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal, body: JSON.stringify({order, token})});
      const result = await response.json().catch(() => null) as {state?: string; message?: string; error?: {message?: string}} | null;
      if (requestRef.current !== controller) return;
      if (!response.ok) throw new Error(result?.error?.message || 'Your order could not be checked.');
      const nextState: OrderState = result?.state === 'fulfilled' || result?.state === 'sandbox_paid' || result?.state === 'needs_review' ? result.state : 'processing';
      setState(nextState);
      setMessage(result?.message || 'Your order is processing. Please check again shortly.');
    } catch (cause) {
      if (requestRef.current !== controller) return;
      setState('error');
      setMessage(controller.signal.aborted ? 'The order check took too long. Check the status again or contact support with your receipt. Please do not pay again.' : (cause instanceof Error && !(cause instanceof TypeError) ? cause.message + ' ' : 'We couldn’t reach checkout to confirm your order. ') + 'Contact support with your receipt before paying again.');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {requestRef.current = null; setBusy(false);}
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- checks the order with the server on mount; the URL query it reads only exists after hydration
    void check();
    return () => {requestRef.current?.abort(); requestRef.current = null;};
  }, [check]);

  useEffect(() => {
    if (state !== 'processing' || busy || autoChecks >= 6) return;
    const timer = window.setTimeout(() => {setAutoChecks(count => count + 1); void check();}, 3000 * 2 ** autoChecks);
    return () => window.clearTimeout(timer);
  }, [state, busy, autoChecks, check]);

  const confirmed = state === 'fulfilled';
  const heading = confirmed ? 'Your subscription is ready.' : state === 'sandbox_paid' ? 'Your test payment is confirmed.' : state === 'invalid' ? 'Let’s find your order.' : state === 'error' ? 'Let’s check your order.' : state === 'needs_review' ? 'We’re updating your subscription.' : 'Your next evening awaits.';
  const supportLink = 'mailto:' + support + '?subject=' + encodeURIComponent('LumaNest checkout help' + (orderReference ? ' · ' + orderReference : ''));

  return <div className="checkout-result">
    <SiteHeader portal={portal} install={false}/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card" aria-labelledby="checkout-result-title"><p className="eyebrow">{confirmed ? 'WELCOME TO YOUR NEXT EVENING' : 'YOUR ORDER STATUS'}</p><h1 id="checkout-result-title">{heading}</h1><div className="checkout-result-status" data-state={state} role="status" aria-live="polite" aria-busy={busy}><p>{busy ? 'Confirming your payment and subscription…' : message}</p></div>
      <p>{confirmed ? 'Open your customer hub to see your subscription, line login and TV setup details. If you renewed, continue using your existing line login. Keep your PayPal receipt for your records.' : state === 'sandbox_paid' ? 'This was a test payment. No live subscription was activated or renewed.' : 'Keep your PayPal receipt. If your payment is confirmed but your subscription update is still processing, contact support before placing another order.'}</p>
      <div className="actions">{confirmed ? <><a className="button primary" href={portal}>Open customer hub <span aria-hidden="true">↗</span></a><a className="button secondary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a><a className="button secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a></> : <>{state !== 'invalid' && state !== 'sandbox_paid' && <button type="button" className="button primary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking order…' : 'Check order status'}<span aria-hidden="true">↻</span></button>}<a className="button secondary" href={supportLink}>Contact support <span aria-hidden="true">↗</span></a><a className="button secondary" href="/">Back to LumaNest <span aria-hidden="true">↗</span></a></>}</div>
      {orderReference && <p className="checkout-order-reference">Order reference: {orderReference}</p>}
    </section></main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
