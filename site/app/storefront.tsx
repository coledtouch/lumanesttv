'use client';

import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode} from 'react';
import {plans, periods} from '../lib/plans';
import LoginExplainer from './login-explainer';
import {SiteFooter, SiteHeader} from './site-chrome';

type Availability = 'checking' | 'available' | 'unavailable' | 'error';

const money = (value: number) => '$' + (Number.isInteger(value) ? String(value) : value.toFixed(2));
const monthly = (price: number, months: number) => money(Math.round(price / months * 100) / 100);
const starter = plans.reduce((low, item) => item.prices[0] < low.prices[0] ? item : low, plans[0]);
const icon = {
  tv: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  stick: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="11" rx="2"/><path d="M12 14v2"/><rect x="9" y="16" width="6" height="5" rx="1"/></svg>,
  browser: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/></svg>,
  phone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>,
  laptop: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>,
  lock: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>,
  once: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>,
  mail: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
};
const worksOn: [string, string, keyof typeof icon, string][] = [
  ['android', 'Android TV / Google TV', 'tv', 'TV app'],
  ['android', 'Amazon Fire TV', 'stick', 'TV app'],
  ['lg', 'LG webOS', 'tv', 'Developer install'],
  ['roku', 'Roku', 'stick', 'Developer install'],
  ['browser', 'Any web browser', 'browser', 'No install needed'],
  ['samsung', 'Samsung TV', 'tv', 'App temporarily unavailable'],
];
const included = ['Live channels, with your channel choices', 'Movies and series to browse', 'The web player in your browser', 'TV app setup for Android TV, Google TV, Fire TV, LG webOS and Roku', 'Online renewals and subscription management'];

const questions: [string, ReactNode][] = [
  ['What are simultaneous screens?', 'A screen is any device watching at the same time. For example, a TV, a phone and a laptop watching at once count as three screens. ' + plans.map(item => item.name + ' allows ' + ['one', 'two', 'three', 'four'][item.devices - 1]).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.'],
  ['How do I renew?', 'Open Renew subscription and sign in with your line username and password. Choose 3, 6 or 12 months and pay once on PayPal. When available for your line, you can also choose optional auto-renew and explicitly enroll on PayPal. Your existing line is extended after each confirmed payment. You can turn off future automatic payments in your renewal settings or PayPal.'],
  ['How do I set up my TV app?', 'Your customer hub provides the server address, line username, and setup details. Choose your device on our setup page for installation help. Keep your line credentials private.'],
  ['Is the price monthly?', 'No. You pay the total for the selected 3, 6 or 12 month period, in USD. The monthly figure on each plan is shown for comparison only. New plans and pay-once renewals have one payment. Optional auto-renew charges the displayed total every selected period and requires your separate PayPal agreement.'],
  ['Can I add more screens?', 'Device upgrades are available up to four screens. Their price depends on your line and remaining time; request a quote from your customer hub before paying.'],
];
// Shown only while free trials are switched on (see trialsReady in lib/trials.ts).
const trialQuestion: [string, ReactNode] = ['Can I try LumaNest before I buy?', <>Yes. You can <a href="/trial" style={{color: '#6b2dd6', textDecoration: 'underline', textUnderlineOffset: 3}}>request a free, full-feature 24-hour trial</a>. We review every request by hand as soon as we can, and offer one trial per person and household. No payment details are needed, and the trial simply ends after 24 hours, with nothing to cancel.</>];

export default function Storefront({portal, ready, support, trial = false}: {portal: string; ready: boolean; support: string; trial?: boolean}) {
  const [period, setPeriod] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  // A result counts only for the plan, period and attempt it was fetched for; anything else is still being checked.
  const [checked, setChecked] = useState<{key: string; value: Availability} | null>(null);
  const availabilityKey = selected + ':' + period + ':' + availabilityAttempt;
  const availability: Availability = checked?.key === availabilityKey ? checked.value : 'checking';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const supportEmail = support || 'support@lumanest.tv';
  const plan = selected === null ? null : plans[selected];

  useEffect(() => {
    if (selected === null || !ready) return;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    let active = true;
    const key = selected + ':' + period + ':' + availabilityAttempt;
    fetch('/api/availability?devices=' + plans[selected].devices + '&months=' + periods[period], {signal: abort.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Availability could not be checked.');
        const result = await response.json() as {available?: boolean};
        if (typeof result.available !== 'boolean') throw new Error('Availability could not be checked.');
        if (active) setChecked({key, value: result.available ? 'available' : 'unavailable'});
      })
      .catch(() => { if (active) setChecked({key, value: 'error'}); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); abort.abort(); };
  }, [selected, period, ready, availabilityAttempt]);

  useEffect(() => {
    if (selected === null) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (dialog && !dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({preventScroll: true});
    };
  }, [selected]);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {if (event.persisted) {submittingRef.current = false; setBusy(false);}};
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  function closeCheckout() {
    if (!submittingRef.current) setSelected(null);
  }

  function trapCheckoutFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(control => !control.hasAttribute('disabled') && control.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) {event.preventDefault(); return;}
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || availability !== 'available' || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: abort.signal,
        body: JSON.stringify({devices: plan.devices, months: periods[period], email: String(fields.get('email') || '').trim(), name: String(fields.get('name') || '').trim()}),
      });
      const result = await response.json().catch(() => null) as {message?: string; error?: {message?: string}; approval_url?: string} | null;
      if (!response.ok) throw new Error(result?.error?.message || result?.message || 'We couldn’t open checkout. Please try again or contact support.');
      if (!result?.approval_url) throw new Error('The PayPal checkout link could not be created. Please try again.');
      const approval = new URL(result.approval_url);
      if (approval.protocol !== 'https:' || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(approval.hostname)) throw new Error('The PayPal checkout link could not be verified. Please contact support.');
      window.location.assign(approval.href);
    } catch (cause) {
      setError(abort.signal.aborted ? 'Checkout took too long to respond. Please try again or contact support.' : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Checkout is unavailable. Please try again or contact support.');
      submittingRef.current = false;
      setBusy(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return <div className="storefront">
    <SiteHeader portal={portal}/>
    <main id="main-content">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><i className="status-dot" aria-hidden="true"/> YOUR EVENING. YOUR CHANNEL.</p>
          <h1 id="hero-title">Make yourself<br/>at <em>home.</em></h1>
          <p className="intro">Live channels, movies and series on your TV app or right in your browser — from <strong>{money(starter.prices[0])}</strong> for {periods[0]} months.</p>
          <p className="hero-detail">Pay once with PayPal. As soon as your line is ready, your customer hub shows your line login, so you can press play in the web player or connect your TV.</p>
          <div className="actions"><a className="button primary" href="#plans">Find your plan <span aria-hidden="true">↗</span></a>{trial && <a className="button secondary" href="/trial">Try it free for 24 hours <span aria-hidden="true">↗</span></a>}<a href="/watch" className="text-link">Already a customer? Watch now <span aria-hidden="true">↗</span></a></div>
          <div className="hero-note"><span>1–4 simultaneous screens</span><span>About {monthly(starter.prices[0], periods[0])}/mo on {starter.name}</span></div>
        </div>
        <picture>
          <source srcSet="/hero-art.webp" type="image/webp"/>
          <img className="hero-art" src="/hero-art.png" width={600} height={480} fetchPriority="high" alt="A cozy room at night: a moonlit arched window, a television ready to play, a sofa and a reading lamp."/>
        </picture>
      </section>

      <section className="quick-access" aria-label="Get started">
        <a href="#plans"><small>NEW TO LUMANEST?</small><h2>Choose a plan</h2><p>Find the right number of screens for your home.</p><span>Explore plans <b aria-hidden="true">↗</b></span></a>
        <a href="/watch"><small>READY TO WATCH?</small><h2>Press play</h2><p>Sign in with your line login and open the web player.</p><span>Watch now <b aria-hidden="true">↗</b></span></a>
        <a href="/apps"><small>MADE FOR YOUR SOFA</small><h2>Connect your TV</h2><p>Get installation steps for your device.</p><span>Start setup <b aria-hidden="true">↗</b></span></a>
      </section>
      <section className="works-on" aria-labelledby="works-on-title">
        <h2 id="works-on-title">Works on</h2>
        <ul>{worksOn.map(([id, name, glyph, note]) => <li key={name} className={id === 'samsung' ? 'is-paused' : ''}><a href={'/apps#' + id}><span className="works-icon" aria-hidden="true">{icon[glyph]}</span><span><strong>{name}</strong><small>{note}</small></span></a></li>)}</ul>
      </section>

      <section className="section plans-section" id="plans" aria-labelledby="plans-title">
        <div className="section-top">
          <div><p className="eyebrow">A PLAN FOR YOUR PLACE</p><h2 id="plans-title">More screens.<br/>Same cozy feeling.</h2></div>
          <div className="plan-length"><p className="muted">Pick your subscription length.<br/>You pay the full total once, in USD.</p><div className="periods" role="group" aria-label="Subscription length">{periods.map((months, index) => <button key={months} aria-pressed={period === index} onClick={() => setPeriod(index)}>{months} months{months === 12 && <small>Best value</small>}</button>)}</div></div>
        </div>
        <div className="screens-explainer" role="img" aria-label="Screens are devices watching at the same time. For example, a TV, a phone and a laptop watching at once count as 3 screens."><span aria-hidden="true">{icon.tv}</span><b aria-hidden="true">+</b><span aria-hidden="true">{icon.phone}</span><b aria-hidden="true">+</b><span aria-hidden="true">{icon.laptop}</span><b aria-hidden="true">=</b><strong aria-hidden="true">3 screens</strong><small aria-hidden="true">watching at the same time</small></div>
        <p className="sr-only" role="status">Showing prices for a {periods[period]} month subscription.</p>
        <div className="plan-grid">{plans.map((item, index) => <article key={item.name} className={'plan-card ' + (index === 1 ? 'featured' : '')} aria-labelledby={'plan-' + item.devices}>
          <div className="plan-top"><span><i className="screen-dots" aria-hidden="true">{Array.from({length: item.devices}, (_, dot) => <i key={dot}/>)}</i>{item.devices} {item.devices === 1 ? 'SCREEN' : 'SCREENS'}</span>{index === 1 && <small>THE SHARED FAVORITE</small>}</div>
          <h3 id={'plan-' + item.devices}>{item.name}</h3><p className="plan-description">{item.copy}</p>
          <div className="price">{monthly(item.prices[period], periods[period])}<span>/mo</span></div><p className="equivalent"><strong>{money(item.prices[period])}</strong> paid once for {periods[period]} months</p>
          <button className={'button ' + (index === 1 ? 'primary' : 'secondary')} aria-haspopup="dialog" onClick={() => {setSelected(index); setError(''); setAvailabilityAttempt(attempt => attempt + 1);}}>Choose {item.name} <span aria-hidden="true">↗</span></button>
        </article>)}</div>
        <div className="plan-includes"><h3>Every plan includes</h3><ul>{included.map(item => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul></div>
        <ul className="plan-reassurance" aria-label="Checkout and support"><li><span aria-hidden="true">{icon.lock}</span>Secure checkout with PayPal</li><li><span aria-hidden="true">{icon.once}</span>Pay once — no automatic charges unless you choose auto-renew</li><li><span aria-hidden="true">{icon.mail}</span><a href={'mailto:' + supportEmail}>Support by email</a></li></ul>
      </section>

      <section className="how section" id="how" aria-labelledby="how-title">
        <div><p className="eyebrow">LESS FUSS. MORE FAVORITES.</p><h2 id="how-title">From your plan<br/>to your sofa.</h2><p className="muted">Your customer hub keeps your subscription, line login, and channel choices together. Renew online whenever you need more time.</p></div>
        <div className="steps">{[['Find your fit', 'Choose 1–4 simultaneous screens and a 3, 6 or 12 month plan.'], ['Get connected', 'Review your total on PayPal. Once payment is confirmed, your subscription is activated and linked to your customer account.'], ['Settle in', 'Open the web player or follow our TV setup guide. When it’s time to renew, choose your next period and pay online.']].map(([heading, copy], index) => <div key={heading}><span aria-hidden="true">0{index + 1}</span><section><h3>{heading}</h3><p>{copy}</p></section></div>)}</div>
      </section>

      <section className="access section" id="customer-access" aria-labelledby="access-title">
        <p className="eyebrow">ALREADY PART OF THE NEST?</p><h2 id="access-title">Your subscription.<br/>One familiar place.</h2><p>Find your line login, manage your subscription, and make yourself at home.</p>
        {portal && <div className="actions access-actions"><a className="button primary" href={portal}>Open customer hub <span aria-hidden="true">↗</span></a></div>}
        {!portal && <p className="notice">The customer hub is being connected. <a href={'mailto:' + supportEmail}>Contact support for help with your subscription.</a></p>}
        <nav className="access-links" aria-label="More for customers"><a href="/renew">Renew subscription <span aria-hidden="true">↗</span></a><a href="/watch">Watch now <span aria-hidden="true">↗</span></a><a href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></nav>
        <p className="access-help">Your customer account and your line login may use different passwords. <a href="#logins">Which login goes where?</a></p>
      </section>

      <LoginExplainer portal={portal} trial={trial}/>

      <section className="faq section" id="faq" aria-labelledby="faq-title"><div><p className="eyebrow">GOOD TO KNOW</p><h2 id="faq-title">A few things<br/>before you settle in.</h2><a className="text-link faq-support" href={'mailto:' + supportEmail}>Need a hand? Contact support <span aria-hidden="true">↗</span></a></div><div>{(trial ? [trialQuestion, ...questions] : questions).map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
    </main>
    <SiteFooter portal={portal} support={supportEmail}/>

    {plan && <dialog className="checkout-dialog modal" ref={dialogRef} aria-labelledby="plan-title" aria-describedby="checkout-summary" onKeyDown={trapCheckoutFocus} onCancel={event => {event.preventDefault(); closeCheckout();}} onClick={event => {if (event.target === event.currentTarget) {const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeCheckout();}}}>
      <button className="close" type="button" aria-label="Close checkout" disabled={busy} onClick={closeCheckout}>×</button><p className="eyebrow">YOUR NEXT EVENING STARTS HERE</p><h2 id="plan-title">Make room for {plan.name}.</h2>
      <div id="checkout-summary" className="checkout-summary"><div><strong>{plan.devices} {plan.devices === 1 ? 'screen' : 'screens'} at a time</strong><span>{periods[period]} month subscription</span></div><div className="checkout-total"><strong>${plan.prices[period]}</strong><span>USD total</span></div></div>
      {ready && availability === 'checking' ? <p className="availability-status" role="status"><span className="loading-dot" aria-hidden="true"/>Checking your plan’s availability…</p> : ready && availability === 'available' ? <form onSubmit={checkout} aria-busy={busy}>
        <label htmlFor="checkout-name">Your name <span className="field-optional">(optional)</span><input id="checkout-name" name="name" maxLength={100} autoComplete="name" disabled={busy}/></label>
        <label htmlFor="checkout-email">Email for your customer account<input id="checkout-email" required name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} disabled={busy} aria-describedby="checkout-email-help"/></label><p id="checkout-email-help" className="field-help">We’ll use this address for your account and subscription details.</p>
        <p className="checkout-payment-note">You’ll review and approve the full total on PayPal. Your subscription starts after payment is confirmed. No recurring charge.</p>
        {error && <p role="alert" className="error">{error}</p>}<button type="submit" className="button paypal" disabled={busy}>{busy ? 'Opening PayPal…' : 'Continue with PayPal'}<span aria-hidden="true">↗</span></button>
      </form> : ready && availability === 'error' ? <div className="checkout-unavailable" role="alert"><p>We couldn’t check this plan right now. Please try again, or contact us for help.</p><button className="button primary" type="button" onClick={() => setAvailabilityAttempt(attempt => attempt + 1)}>Try again</button><a className="text-link" href={'mailto:' + supportEmail}>Contact support <span aria-hidden="true">↗</span></a></div> : <div className="checkout-unavailable"><p>This plan currently needs support activation. We’ll help you arrange your subscription.</p><a className="button primary" href={'mailto:' + supportEmail + '?subject=' + encodeURIComponent(plan.name + ' plan · ' + periods[period] + ' months')}>Contact support <span aria-hidden="true">↗</span></a></div>}
      <p className="checkout-support">Need a hand? <a href={'mailto:' + supportEmail}>Contact support</a></p>
    </dialog>}
  </div>;
}
