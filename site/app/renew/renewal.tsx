'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowRight, ChevronDown, RefreshCw, ShieldCheck} from 'lucide-react';
import {plans} from '../../lib/plans';
import {canStartAutoRenew, isBillingOptions, isEnrollmentStatus, recurringTerms, type BillingOptions} from './billing-view';
import BillingAgreement from './billing-agreement';
import AutoRenewManagement from './management';
import styles from './renewal.module.css';
import {SiteFooter, SiteHeader} from '../site-chrome';

type Offer = {months: 3 | 6 | 12; amount: number; currency: 'USD'; available: boolean};
type Quote = {
  line: {username: string; devices: number; status: 'active' | 'expired'; expires_at: string | null; days_left: number | null};
  offers: Offer[];
  quote_token: string;
  checkout_available: boolean;
  message: string | null;
};

function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Quote;
  return !!quote.line && typeof quote.line.username === 'string' && Number.isInteger(quote.line.devices) &&
    quote.line.devices >= 1 && quote.line.devices <= 4 && ['active', 'expired'].includes(quote.line.status) &&
    (quote.line.expires_at === null || (typeof quote.line.expires_at === 'string' && Number.isFinite(Date.parse(quote.line.expires_at)))) &&
    (quote.line.days_left === null || Number.isFinite(quote.line.days_left)) &&
    typeof quote.checkout_available === 'boolean' && (quote.message === null || typeof quote.message === 'string') &&
    typeof quote.quote_token === 'string' && quote.quote_token.length > 0 && quote.quote_token.length <= 2048 &&
    Array.isArray(quote.offers) && quote.offers.length === 3 &&
    quote.offers.every(offer => !!offer && [3, 6, 12].includes(offer.months) && Number.isFinite(offer.amount) && offer.amount > 0 && offer.currency === 'USD' && typeof offer.available === 'boolean') &&
    new Set(quote.offers.map(offer => offer.months)).size === 3;
}

class RenewalError extends Error {
  constructor(message: string, readonly status: number, readonly code: string = '') {super(message);}
}

async function request(path: string, controller: AbortController, body?: Record<string, unknown>) {
  const response = await fetch('/api/player/renew' + path, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
    ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const data = await response.json().catch(() => null) as {error?: {message?: string; code?: string}} | null;
  if (!response.ok) throw new RenewalError(typeof data?.error?.message === 'string' ? data.error.message : 'We couldn’t reach your subscription. Please try again.', response.status, typeof data?.error?.code === 'string' ? data.error.code : '');
  return data;
}

const money = (amount: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2}).format(amount);
const date = (value: string) => new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(value));
const mask = (value: string) => value.length > 4 ? '••••' + value.slice(-4) : '••••';

export default function Renewal({portal, support}: {portal: string; support: string}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [months, setMonths] = useState<number>(3);
  const [billingMode, setBillingMode] = useState<'once' | 'auto'>('once');
  const [billing, setBilling] = useState<BillingOptions | null>(null);
  const [billingCheckedAt, setBillingCheckedAt] = useState(0);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [managementView, setManagementView] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'checkout' | 'logout' | 'cancel' | 'activate' | null>(null);
  const [error, setError] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);
  const billingRequest = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const loginHeading = useRef<HTMLHeadingElement>(null);
  const loginForm = useRef<HTMLFormElement>(null);

  function acceptQuote(data: unknown) {
    if (!isQuote(data)) throw new Error('Your renewal options could not be checked. Please try again or contact support.');
    setQuote(data);
    setBilling(null); setBillingMode('once'); setCancelConfirm(false);
    setMonths(current => data.offers.some(offer => offer.months === current && offer.available) ? current : data.offers.find(offer => offer.available)?.months || 3);
  }

  const loadQuote = useCallback(async (reviewChangedOptions = false) => {
    if (submitting.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setChecking(true); setError(''); setReviewMessage('');
    try {
      const data = await request('', controller);
      if (activeRequest.current !== controller) return;
      acceptQuote(data);
      if (reviewChangedOptions) {
        setReviewMessage('Your renewal options were refreshed. Review your screen allowance, renewal length and total below before continuing. No payment was taken.');
        window.setTimeout(() => selectionHeading.current?.focus(), 0);
      }
    } catch (cause) {
      if (activeRequest.current !== controller) return;
      if (cause instanceof RenewalError && cause.status === 401) {
        setQuote(null);
        if (reviewChangedOptions) setError('Your renewal session expired. Please sign in again to review your current options.');
      } else {
        if (reviewChangedOptions) setQuote(null);
        setError(controller.signal.aborted ? 'Checking your subscription took too long. Please try again.' : cause instanceof Error ? cause.message : 'Your renewal options could not be loaded.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {activeRequest.current = null; setChecking(false);}
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL query after hydration, otherwise loads the quote from the server
    if (new URLSearchParams(window.location.search).get('manage_auto') === '1') {setManagementView(true); setChecking(false);}
    else void loadQuote();
    return () => {activeRequest.current?.abort(); activeRequest.current = null;};
  }, [loadQuote]);

  const loadBilling = useCallback(async () => {
    billingRequest.current?.abort();
    const controller = new AbortController();
    billingRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setBillingLoading(true); setBillingError('');
    try {
      const data = await request('/subscription', controller);
      if (billingRequest.current !== controller) return;
      if (!isBillingOptions(data)) throw new Error('Your billing options could not be checked. Please try again.');
      setBilling(data); setBillingCheckedAt(Date.now());
      if (!data.available || !data.pay_once_available) setBillingMode('once');
    } catch (cause) {
      if (billingRequest.current !== controller) return;
      setBilling(null); setBillingMode('once');
      if (cause instanceof RenewalError && cause.status === 401) setQuote(null);
      else setBillingError(controller.signal.aborted ? 'Checking automatic payments took too long. Check again before paying.' : cause instanceof Error ? cause.message : 'Your billing options could not be checked.');
    } finally {
      window.clearTimeout(timeout);
      if (billingRequest.current === controller) {billingRequest.current = null; setBillingLoading(false);}
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads billing options from the server whenever a new quote arrives
    if (quote) void loadBilling();
    else {setBilling(null); setBillingMode('once'); setBillingError(''); setBillingLoading(false);}
    return () => {billingRequest.current?.abort(); billingRequest.current = null;};
  }, [quote, loadBilling]);

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 700px)');
    const sync = () => setGuideOpen(!narrow.matches);
    sync(); narrow.addEventListener('change', sync);
    return () => narrow.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {if (event.persisted && submitting.current) {activeRequest.current = null; submitting.current = false; setBusy(null);}};
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>, action: 'login' | 'checkout') {
    event.preventDefault();
    if (submitting.current || checking || (action === 'checkout' && billingLoading)) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (action === 'checkout' && (!quote?.checkout_available || !billing?.pay_once_available ||
      !(billingMode === 'auto' ? canStartAutoRenew(billing, months) : quote.offers.some(offer => offer.months === months && offer.available)))) return;
    submitting.current = true;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    let redirecting = false;
    let refreshChangedOptions = false;
    setBusy(action); setError('');
    try {
      const payload = action === 'login'
        ? {username: String(fields.get('username') || '').trim(), password: String(fields.get('password') || '')}
        : {months, email: String(fields.get('email') || '').trim(), name: String(fields.get('name') || '').trim(), quoteToken: quote!.quote_token,
          ...(billingMode === 'auto' ? {consent: fields.get('autoConsent') === 'on'} : {})};
      const data = await request(action === 'login' ? '/login' : billingMode === 'auto' ? '/subscription' : '/checkout', controller, payload);
      if (activeRequest.current !== controller) return;
      if (action === 'login') {
        acceptQuote(data); form.reset(); setShowPassword(false); setReviewMessage('');
        window.setTimeout(() => selectionHeading.current?.focus(), 0);
      } else {
        const url = (data as {approval_url?: unknown} | null)?.approval_url;
        if (typeof url !== 'string') throw new Error('Your PayPal checkout link could not be created. Please try again.');
        const approval = new URL(url);
        if (approval.protocol !== 'https:' || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(approval.hostname)) throw new Error('Your PayPal checkout link could not be verified. Please contact support.');
        window.location.assign(approval.href);
        redirecting = true;
        return;
      }
    } catch (cause) {
      if (activeRequest.current !== controller) return;
      if (action === 'checkout' && cause instanceof RenewalError && cause.status === 409) refreshChangedOptions = true;
      if (action === 'checkout' && cause instanceof RenewalError && cause.status === 401) {
        setQuote(null); setShowPassword(false);
        window.setTimeout(() => loginHeading.current?.focus(), 0);
      }
      setError(controller.signal.aborted ? 'This took too long to respond. Please try again or contact support.' : cause instanceof Error ? cause.message : 'We couldn’t complete this step. Please try again.');
      if (action === 'login') {
        const password = form.elements.namedItem('password');
        if (password instanceof HTMLInputElement) password.value = '';
        setShowPassword(false);
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller && !redirecting) {activeRequest.current = null; setBusy(null); submitting.current = false;}
      if (refreshChangedOptions && activeRequest.current === null) void loadQuote(true);
    }
  }

  async function cancelAutoRenew() {
    if (submitting.current || checking || billingLoading || !billing?.subscription?.cancel_available || !cancelConfirm) return;
    submitting.current = true;
    billingRequest.current?.abort(); billingRequest.current = null;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy('cancel'); setError(''); setReviewMessage('');
    try {
      const data = await request('/subscription/cancel', controller, {});
      if (activeRequest.current !== controller) return;
      if (!isBillingOptions(data)) throw new Error('The cancellation result could not be checked. Check your auto-renew status before paying.');
      setBilling(data); setBillingCheckedAt(Date.now()); setBillingMode('once'); setCancelConfirm(false);
      setReviewMessage(!data.subscription || ['cancelled', 'expired'].includes(data.subscription.status) ? 'Future automatic payments are stopped. Your already-paid viewing time stays available.' : data.subscription.message || 'Your stop request is saved. PayPal approval is still pending; check the agreement status before starting another renewal.');
    } catch (cause) {
      if (activeRequest.current !== controller) return;
      if (cause instanceof RenewalError && cause.status === 401) setQuote(null);
      setError(controller.signal.aborted ? 'The cancellation result is not confirmed. Check your auto-renew status before trying again or paying.' : cause instanceof Error ? cause.message : 'Automatic payments could not be stopped. Please check the status or contact support.');
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {activeRequest.current = null; setBusy(null); submitting.current = false;}
    }
  }

  async function activateAutoRenew() {
    if (submitting.current || checking || billingLoading || !billing?.subscription?.activation_available) return;
    submitting.current = true;
    const controller = new AbortController(); activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy('activate'); setError(''); setReviewMessage('');
    let refresh = false;
    try {
      const data = await request('/subscription/activate', controller, {});
      if (activeRequest.current !== controller) return;
      if (!isEnrollmentStatus(data)) throw new Error('Enrollment could not be confirmed. Check your automatic payment status before trying again.');
      setReviewMessage(data.message); refresh = true;
    } catch (cause) {
      if (activeRequest.current !== controller) return;
      if (cause instanceof RenewalError && cause.status === 401) setQuote(null);
      setError(controller.signal.aborted ? 'Finishing enrollment took too long. Check its status before trying again; no line renewal is confirmed.' : cause instanceof Error ? cause.message : 'Enrollment could not be confirmed.');
      refresh = true;
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {activeRequest.current = null; setBusy(null); submitting.current = false; if (refresh) void loadBilling();}
    }
  }

  async function logout() {
    if (submitting.current || checking) return;
    submitting.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setBusy('logout'); setError('');
    try {
      await request('/logout', controller, {});
      if (activeRequest.current !== controller) return;
      setQuote(null); setShowPassword(false); setReviewMessage(''); loginForm.current?.reset();
      window.setTimeout(() => loginHeading.current?.focus(), 0);
    } catch (cause) {
      if (activeRequest.current === controller) setError(controller.signal.aborted ? 'Signing out took too long. Please try again.' : cause instanceof Error ? cause.message : 'Unable to sign out. Please try again.');
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {activeRequest.current = null; setBusy(null); submitting.current = false;}
    }
  }

  const plan = quote ? plans.find(item => item.devices === quote.line.devices) : null;
  const selected = quote?.offers.find(offer => offer.months === months);
  const autoSelected = billing?.offers.find(offer => offer.months === months);
  const canCheckout = !!(quote?.checkout_available && billing?.pay_once_available &&
    (billingMode === 'auto' ? canStartAutoRenew(billing, months) : selected?.available));
  const disabled = !!busy || checking || billingLoading;
  const supportLink = 'mailto:' + support + '?subject=LumaNest%20renewal%20help';

  return <div className={styles.shell}>
    <SiteHeader portal={portal} current="/renew"/>
    <main id="main-content" className={styles.main}>
      <div className={styles.title}><p className={styles.eyebrow}><RefreshCw size={15} aria-hidden="true"/> YOUR NEXT CHAPTER</p><h1>Keep your<br/><em>evenings going.</em></h1><p>Renew your existing subscription in a few simple steps. Your line login and screen allowance stay the same.</p></div>
      <div className={styles.layout}>
        <aside className={styles.guide} aria-label="How renewal works"><details className={styles.guideDetails} open={guideOpen} onToggle={event => setGuideOpen(event.currentTarget.open)}>
          <summary className={styles.guideSummary}><RefreshCw size={16} aria-hidden="true"/>How renewal works<ChevronDown className={styles.guideChevron} size={17} aria-hidden="true"/></summary><div className={styles.guideBody}>
          <div className={styles.guideIcon}><RefreshCw size={26} aria-hidden="true"/></div><h2>More time.<br/>Same familiar place.</h2>
          <ol><li><span aria-hidden="true">1</span><div><strong>Find your subscription</strong><p>Use your line login, even if your subscription has expired.</p></div></li><li><span aria-hidden="true">2</span><div><strong>Choose your time</strong><p>Pick 3, 6 or 12 months. Pay once, or choose optional auto-renew when available.</p></div></li><li><span aria-hidden="true">3</span><div><strong>Approve on PayPal</strong><p>Your line is extended after each confirmed payment. Auto-renew needs your separate agreement on PayPal.</p></div></li></ol>
          <div className={styles.guideNote}><ShieldCheck size={19} aria-hidden="true"/><p>You choose how to pay. Automatic billing stays off unless you explicitly enroll.</p></div>
        </div></details></aside>
        <section className={styles.card} aria-busy={managementView ? undefined : checking || !!busy || billingLoading} aria-label={managementView ? 'Automatic payment settings' : checking && !quote ? 'Subscription renewal' : undefined} aria-labelledby={managementView || checking && !quote ? undefined : quote ? 'renew-select-title' : 'renew-login-title'}>
          {managementView ? <AutoRenewManagement supportLink={supportLink} onBack={() => {setManagementView(false); void loadQuote();}}/> : checking && !quote ? <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true"/><p>Checking your renewal session…</p></div> : !quote ? <>
            <p className={styles.step}>STEP 1 OF 2</p><h2 id="renew-login-title" ref={loginHeading} tabIndex={-1}>Find your subscription.</h2><p className={styles.cardIntro}>Enter the <strong>line username and line password</strong> from your TV/app setup details. Your customer hub email login can be different. <a className={styles.whichLogin} href="/#logins">Which login is this?</a></p>
            <form ref={loginForm} onSubmit={event => void submit(event, 'login')}>
              <label htmlFor="renew-username">Line username<input id="renew-username" name="username" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={disabled}/></label>
              <label htmlFor="renew-password">Line password</label><div className={styles.password}><input id="renew-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={150} autoComplete="current-password" disabled={disabled}/><button type="button" aria-controls="renew-password" aria-pressed={showPassword} aria-label={showPassword ? 'Hide line password' : 'Show line password'} disabled={disabled} onClick={() => setShowPassword(current => !current)}>{showPassword ? 'Hide' : 'Show'}</button></div>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button type="submit" className={styles.primary} disabled={disabled}>{busy === 'login' ? 'Checking your line…' : 'View my renewal options'}<ArrowRight size={18} aria-hidden="true"/></button>
            </form>
            <p className={styles.loginHelp}><a href={portal}>Find my line login in the customer hub <ArrowRight size={14} aria-hidden="true"/></a></p>
            <p className={styles.helpRow}><button className={styles.textButton} type="button" disabled={disabled} onClick={() => setManagementView(true)}>Manage auto-renew</button><span aria-hidden="true">·</span><a href="/#plans">New customer? Choose a plan</a>{error && <><span aria-hidden="true">·</span><button type="button" className={styles.textButton} disabled={disabled} onClick={() => void loadQuote()}>Check my session again</button></>}</p>
          </> : <>
            <div className={styles.cardHeading}><p className={styles.step}>STEP 2 OF 2</p><button type="button" className={styles.textButton} disabled={disabled} onClick={() => void logout()}>{busy === 'logout' ? 'Signing out…' : 'Use a different line'}</button></div>
            <h2 id="renew-select-title" ref={selectionHeading} tabIndex={-1}>A little more time.</h2>
            {reviewMessage && <p className={styles.reviewNotice} role="status">{reviewMessage}</p>}
            <div className={styles.subscription}><div><strong>{plan?.name || 'Your'} subscription</strong><span>{quote.line.devices} {quote.line.devices === 1 ? 'screen' : 'screens'} at a time · Line {mask(quote.line.username)}</span></div><span className={quote.line.status === 'expired' ? styles.expired : styles.active}>{quote.line.status === 'expired' ? 'Expired' : 'Active'}</span></div>
            <p className={styles.expiry}>{quote.line.expires_at ? <>{quote.line.status === 'expired' ? 'Expired on ' : 'Current expiry: '}<time dateTime={quote.line.expires_at}>{date(quote.line.expires_at)}</time>{quote.line.status === 'active' && quote.line.days_left !== null && quote.line.days_left >= 0 ? ' · ' + Math.floor(quote.line.days_left) + (Math.floor(quote.line.days_left) === 1 ? ' day left' : ' days left') : ''}.</> : 'Your current expiry will be updated after confirmed payment.'}</p>
            {billingLoading && <p className={styles.billingLoading} role="status"><span className={styles.spinner} aria-hidden="true"/>Checking your payment options…</p>}
            {billingError && <div className={styles.unavailable} role="alert"><p>{billingError}</p><button className={styles.textButton} type="button" disabled={disabled} onClick={() => void loadBilling()}>Check payment options again</button></div>}
            {billing?.subscription && <BillingAgreement billing={billing} checkedAt={billingCheckedAt} disabled={disabled} cancelling={busy === 'cancel'} activating={busy === 'activate'} confirming={cancelConfirm} onConfirm={setCancelConfirm} onCancel={() => void cancelAutoRenew()} onActivate={() => void activateAutoRenew()} onRefresh={() => void loadBilling()}/>}
            <form onSubmit={event => void submit(event, 'checkout')}>
              <fieldset className={styles.periods} disabled={disabled || !quote.checkout_available || !billing?.pay_once_available}><legend>Choose your renewal length</legend><div>{quote.offers.map(offer => <label key={offer.months} className={months === offer.months ? styles.selected : ''}><input type="radio" name="period" value={offer.months} checked={months === offer.months} onChange={() => {setMonths(offer.months); setBillingMode('once'); setError('');}} disabled={disabled || !quote.checkout_available || !billing?.pay_once_available || !offer.available}/><span>{offer.months} months</span><strong>{money(offer.amount)}</strong><small>{offer.available ? 'USD total' : 'Unavailable'}</small></label>)}</div></fieldset>
              {billing?.available && billing.pay_once_available && <fieldset className={styles.billingModes} disabled={disabled}><legend>How would you like to renew?</legend><label className={billingMode === 'once' ? styles.chosenMode : ''}><input type="radio" name="billingMode" checked={billingMode === 'once'} onChange={() => {setBillingMode('once'); setError('');}}/><span><strong>Pay once</strong><small>{selected ? money(selected.amount) : ''} for {months} months. Approve each renewal yourself.</small></span></label><label className={billingMode === 'auto' ? styles.chosenMode : ''}><input type="radio" name="billingMode" checked={billingMode === 'auto'} disabled={disabled || !canStartAutoRenew(billing, months)} onChange={() => {setBillingMode('auto'); setError('');}}/><span><strong>Auto-renew <em>Optional</em></strong><small>{autoSelected ? recurringTerms(autoSelected.amount, months) : 'Unavailable for this period'}. Separate PayPal approval required.</small></span></label></fieldset>}
              {!canCheckout && !billingLoading && !billingError && <div className={styles.unavailable} role="status"><p>{!billing?.pay_once_available ? billing?.message || 'Check your automatic payment agreement above before starting another renewal.' : quote.message || 'Online renewal is temporarily unavailable for this line. Contact us for help, or check again shortly.'}</p><button className={styles.textButton} type="button" disabled={disabled} onClick={() => void loadQuote()}>{checking ? 'Checking options…' : 'Check again'}</button><a href={supportLink}>Contact support <ArrowRight size={14} aria-hidden="true"/></a></div>}
              {canCheckout && <>
                <div className={styles.total}><div><strong>{billingMode === 'auto' ? 'Schedule automatic renewals' : 'Extend my existing line'}</strong><span>{months} months · {quote.line.devices} {quote.line.devices === 1 ? 'screen' : 'screens'}</span></div><div><strong>{money((billingMode === 'auto' ? autoSelected : selected)!.amount)}</strong><span>{billingMode === 'auto' ? `USD · every ${months} months` : 'USD · paid once'}</span></div></div>
                <label htmlFor="renew-email">Email for your renewal receipt<input id="renew-email" name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" disabled={disabled} aria-describedby="renew-email-help"/></label><p id="renew-email-help" className={styles.fieldHelp}>Use your own email address for this renewal’s payment and subscription details.</p>
                <label htmlFor="renew-name">Your name <span className={styles.optional}>(optional)</span><input id="renew-name" name="name" maxLength={100} autoComplete="name" disabled={disabled}/></label>
                {billingMode === 'auto' ? <div className={styles.autoTerms}>
                  <p><strong>{recurringTerms(autoSelected!.amount, months)}.</strong> {billing!.starts_at ? <>First payment on <time dateTime={billing!.starts_at}>{date(billing!.starts_at)}</time>, when your current paid time ends.</> : 'First payment shortly after you approve on PayPal.'} No setup fee.</p>
                  <p>Review and approve the automatic payment agreement on PayPal, then return to LumaNest to finish enrollment. Each confirmed payment extends this same line by {months} months. If PayPal reports a failed payment, automatic billing pauses for review.</p>
                  <p>Turn off auto-renew here or in PayPal to stop future charges. Already-paid viewing time remains available.</p>
                  <label className={styles.consent}><input name="autoConsent" type="checkbox" required disabled={disabled}/><span>I choose automatic payments of {recurringTerms(autoSelected!.amount, months)}.</span></label>
                </div> : <p className={styles.paymentNote}>You’ll review and approve the full total on PayPal. We extend this line after payment is confirmed. No recurring charge.</p>}
              </>}
              {error && <p className={styles.error} role="alert">{error}</p>}
              {canCheckout && <button type="submit" className={styles.paypal} disabled={disabled}>{busy === 'checkout' ? 'Opening PayPal…' : billingMode === 'auto' ? 'Review auto-renew on PayPal' : 'Continue with PayPal'}<ArrowRight size={18} aria-hidden="true"/></button>}
            </form>
            <p className={styles.privacy}>Your username and password stay the same after renewal. Screen upgrades are available through your customer hub.</p>
          </>}
          <p className={styles.support}>Need a hand? <a href={supportLink}>Contact LumaNest support.</a></p>
        </section>
      </div>
    </main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
