'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import BillingAgreement from './billing-agreement';
import {isBillingOptions, isEnrollmentStatus, type BillingOptions} from './billing-view';
import styles from './renewal.module.css';

export default function AutoRenewManagement({supportLink, onBack}: {supportLink: string; onBack: () => void}) {
  const [billing, setBilling] = useState<BillingOptions | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'cancel' | 'logout' | 'activate' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const run = useCallback(async (path: string, body?: Record<string, unknown>, silentUnauthenticated = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/player/renew/' + path, {method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
      let data = await response.json().catch(() => null) as {error?: {message?: string}} | null;
      if (controllerRef.current !== controller) return;
      if (response.status === 401) {
        setBilling(null);
        if (silentUnauthenticated) return;
      }
      if (!response.ok) throw new Error(data?.error?.message || 'Your automatic payment settings could not be checked.');
      if (path === 'subscription/activate') {
        if (!isEnrollmentStatus(data)) throw new Error('Enrollment could not be confirmed. Check your automatic payment status before trying again.');
        setNotice(data.message);
        const statusResponse = await fetch('/api/player/renew/subscription', {cache: 'no-store', signal: controller.signal});
        data = await statusResponse.json().catch(() => null) as {error?: {message?: string}} | null;
        if (controllerRef.current !== controller) return;
        if (!statusResponse.ok) throw new Error(data?.error?.message || 'The refreshed agreement status could not be confirmed.');
      }
      if (path !== 'logout') {
        if (!isBillingOptions(data)) throw new Error('The automatic payment result could not be confirmed. Check the status or manage payments directly in PayPal.');
        setBilling(data); setCheckedAt(Date.now());
        if (path === 'subscription/cancel') {
          setConfirming(false);
          setNotice(!data.subscription || ['cancelled', 'expired'].includes(data.subscription.status) ? 'Future automatic payments are stopped. Your already-paid viewing time stays available.' : data.subscription.message || 'Your stop request is saved. PayPal approval is still pending; check the status before starting another renewal.');
        }
      } else {setBilling(null); setNotice(''); setConfirming(false);}
      return true;
    } catch (cause) {
      if (controllerRef.current === controller && path === 'subscription/activate') setBilling(current => current?.subscription ? {...current, subscription: {...current.subscription, activation_available: false}} : current);
      if (controllerRef.current === controller) setError(controller.signal.aborted ? 'The result is not confirmed. Check the billing status or manage payments directly in PayPal before trying again.' : cause instanceof Error ? cause.message : 'Your billing settings could not be checked.');
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) {controllerRef.current = null; setChecking(false); setBusy(null); submitting.current = false;}
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the signed-in billing status from the server on mount
    void run('subscription', undefined, true);
    return () => {controllerRef.current?.abort(); controllerRef.current = null;};
  }, [run]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || checking) return;
    submitting.current = true;
    setBusy('login'); setError(''); setNotice('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    const accepted = await run('subscription/login', {username: String(fields.get('username') || '').trim(), password: String(fields.get('password') || '')});
    const password = form.elements.namedItem('password');
    if (password instanceof HTMLInputElement) password.value = '';
    if (accepted) form.reset();
  }

  function refresh() {
    if (submitting.current || checking) return;
    submitting.current = true; setChecking(true); setError('');
    void run('subscription');
  }

  function cancel() {
    if (submitting.current || checking || !confirming || !billing?.subscription?.cancel_available) return;
    submitting.current = true; setBusy('cancel'); setError(''); setNotice('');
    void run('subscription/cancel', {});
  }

  function activate() {
    if (submitting.current || checking || !billing?.subscription?.activation_available) return;
    submitting.current = true; setBusy('activate'); setError(''); setNotice('');
    void run('subscription/activate', {});
  }

  function logout() {
    if (submitting.current || checking) return;
    submitting.current = true; setBusy('logout'); setError('');
    void run('logout', {});
  }

  const disabled = checking || !!busy;
  return <div aria-busy={disabled}>
    <p className={styles.step}>YOUR PAYMENT SETTINGS</p><h2>Auto-renew, your choice.</h2>
    <p className={styles.cardIntro}>Use your line login to manage automatic payments. You can stop future charges even when your line is no longer available for renewal.</p>
    {checking && !billing ? <div className={styles.billingLoading} role="status"><span className={styles.spinner} aria-hidden="true"/>Checking your billing session…</div> : billing ? <>
      {notice && <p className={styles.reviewNotice} role="status">{notice}</p>}
      {billing.subscription ? <BillingAgreement billing={billing} checkedAt={checkedAt} disabled={disabled} cancelling={busy === 'cancel'} activating={busy === 'activate'} confirming={confirming} onConfirm={setConfirming} onCancel={cancel} onActivate={activate} onRefresh={refresh}/> : <p className={styles.reviewNotice} role="status">There is no automatic payment agreement for this line.</p>}
      <div className={styles.managementLinks}><button className={styles.textButton} type="button" disabled={disabled} onClick={logout}>{busy === 'logout' ? 'Signing out…' : 'Use a different line'}</button></div>
    </> : <form ref={formRef} onSubmit={event => void login(event)}>
      <label htmlFor="billing-username">Line username<input id="billing-username" name="username" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={disabled}/></label>
      <label htmlFor="billing-password">Line password<input id="billing-password" name="password" type="password" required maxLength={150} autoComplete="current-password" disabled={disabled}/></label>
      <button className={styles.primary} type="submit" disabled={disabled}>{busy === 'login' ? 'Checking your agreement…' : 'Open my payment settings'}<ArrowRight size={18} aria-hidden="true"/></button>
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.managementLinks}><button className={styles.textButton} type="button" disabled={disabled} onClick={onBack}>Back to renewal options</button><a className={styles.textButton} href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noreferrer">Manage payments in PayPal ↗</a></div>
    <p className={styles.privacy}>Turning off auto-renew stops future charges and preserves already-paid viewing time. Need help with a payment? <a href={supportLink}>Contact support.</a></p>
  </div>;
}
