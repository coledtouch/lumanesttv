'use client';

import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';
import {plans, periods} from '../lib/plans';

type Availability = 'checking' | 'available' | 'unavailable' | 'error';

const questions = [
  ['What are simultaneous screens?', 'Lite supports one device watching at a time, Family two, Premium three, and Titan four. You can choose the plan that fits how your household watches.'],
  ['How do I renew?', 'Open Renew subscription and sign in with your line username and password. Choose 3, 6 or 12 months and pay once on PayPal. When available for your line, you can also choose optional auto-renew and explicitly enroll on PayPal. Your existing line is extended after each confirmed payment. You can turn off future automatic payments in your renewal settings or PayPal.'],
  ['How do I set up my TV app?', 'Your customer hub provides the server address, line username, and setup details. Choose your device on our setup page for installation help. Keep your line credentials private.'],
  ['Is the price monthly?', 'The price is the total for the selected 3, 6 or 12 month period, in USD. The monthly equivalent is shown for comparison. New plans and pay-once renewals have one payment. Optional auto-renew charges the displayed total every selected period and requires your separate PayPal agreement.'],
  ['Can I add more screens?', 'Device upgrades are available up to four screens. Their price depends on your line and remaining time; request a quote from your customer hub before paying.'],
];

export default function Storefront({portal, ready, support}: {portal: string; ready: boolean; support: string}) {
  const [period, setPeriod] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<Availability>('checking');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const supportEmail = support || 'support@lumanest.tv';
  const plan = selected === null ? null : plans[selected];

  useEffect(() => {
    if (selected === null || !ready) return;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    let active = true;
    setAvailability('checking');
    fetch('/api/availability?devices=' + plans[selected].devices + '&months=' + periods[period], {signal: abort.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Availability could not be checked.');
        const result = await response.json() as {available?: boolean};
        if (typeof result.available !== 'boolean') throw new Error('Availability could not be checked.');
        if (active) setAvailability(result.available ? 'available' : 'unavailable');
      })
      .catch(() => { if (active) setAvailability('error'); })
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

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.KeyboardEvent) => {if (event.key === 'Escape') {setMenuOpen(false); menuToggleRef.current?.focus();}};
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

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
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header">
      <a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a>
      <button ref={menuToggleRef} className="mobile-menu-toggle" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Close' : 'Menu'}<span aria-hidden="true">{menuOpen ? '×' : '☰'}</span></button>
      <nav id="primary-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
        <a href="#plans">Plans</a><a href="/watch">Watch now</a><a href="/renew">Renew</a><a href="/apps">Set up my TV</a><a href={'mailto:' + supportEmail}>Help</a>
        <a className="nav-cta" href={portal || '#customer-access'}>Customer sign in <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
    <main id="main-content">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><i className="status-dot" aria-hidden="true"/> YOUR EVENING. YOUR CHANNEL.</p>
          <h1 id="hero-title">Make yourself<br/>at <em>home.</em></h1>
          <p className="intro">Settle in. Your next favorite starts here.</p>
          <p className="hero-detail">Live channels, movies, and series. Watch in your browser or connect your TV, with a plan that fits your home.</p>
          <div className="actions"><a className="button primary" href="#plans">Find your plan <span aria-hidden="true">↗</span></a><a href="/watch" className="text-link">Already a customer? Watch now <span aria-hidden="true">↗</span></a></div>
          <div className="hero-note"><span>1–4 simultaneous screens</span><span>Pay once to get started</span></div>
        </div>
        <div className="hero-art" role="img" aria-label="A cozy room with a television, sofa, and moonlit window">
          <div className="art-label">THE NIGHT IS YOURS <span>● LIVE / ON DEMAND</span></div><div className="moon"/><div className="window-frame"><i/><i/></div><div className="landscape"><div className="ridge back"/><div className="ridge front"/></div><div className="tv-frame"><div className="tv-screen"><div className="screen-orbit">▶</div><p>Your next favorite.</p></div></div><div className="lamp"><i/></div><div className="sofa"/><div className="art-caption"><span>PRESS PAUSE ON THE DAY.</span><span>LumaNest / 01</span></div>
        </div>
      </section>

      <section className="quick-access" aria-label="Get started">
        <a href="#plans"><small>NEW TO LUMANEST?</small><h2>Choose a plan</h2><p>Find the right number of screens for your home.</p><span>Explore plans <b aria-hidden="true">↗</b></span></a>
        <a href="/watch"><small>READY TO WATCH?</small><h2>Press play</h2><p>Sign in with your line login and open the web player.</p><span>Watch now <b aria-hidden="true">↗</b></span></a>
        <a href="/apps"><small>MADE FOR YOUR SOFA</small><h2>Connect your TV</h2><p>Get installation steps for your device.</p><span>Start setup <b aria-hidden="true">↗</b></span></a>
      </section>
      <div className="strip"><span>LIVE CHANNELS</span><b aria-hidden="true">✦</b><span>MOVIES & SERIES</span><b aria-hidden="true">✦</b><span>YOUR CHANNEL CHOICES</span><b aria-hidden="true">✦</b><span>EASY RENEWALS</span></div>

      <section className="section plans-section" id="plans" aria-labelledby="plans-title">
        <div className="section-top">
          <div><p className="eyebrow">A PLAN FOR YOUR PLACE</p><h2 id="plans-title">More screens.<br/>Same cozy feeling.</h2></div>
          <div className="plan-length"><p className="muted">Pick your subscription length.<br/>All prices are the full total in USD.</p><div className="periods" role="group" aria-label="Subscription length">{periods.map((months, index) => <button key={months} aria-pressed={period === index} onClick={() => setPeriod(index)}>{months} months{months === 12 && <small>Best value</small>}</button>)}</div></div>
        </div>
        <p className="sr-only" role="status">Showing total prices for a {periods[period]} month subscription.</p>
        <div className="plan-grid">{plans.map((item, index) => <article key={item.name} className={'plan-card ' + (index === 1 ? 'featured' : '')} aria-labelledby={'plan-' + item.name}>
          <div className="plan-top"><span>{item.devices} {item.devices === 1 ? 'SCREEN' : 'SCREENS'}</span>{index === 1 && <small>THE SHARED FAVORITE</small>}</div>
          <h3 id={'plan-' + item.name}>{item.name}</h3><p className="plan-description">{item.copy}</p>
          <div className="price">${item.prices[period]}<span> / {periods[period]} months</span></div><p className="equivalent">About ${(item.prices[period] / periods[period]).toFixed(2)} per month</p><hr/>
          <ul><li><span aria-hidden="true">✓</span> {item.devices} {item.devices === 1 ? 'screen' : 'screens'} at a time</li><li><span aria-hidden="true">✓</span> Your channel choices</li><li><span aria-hidden="true">✓</span> Movies and series browsing</li><li><span aria-hidden="true">✓</span> Subscription management</li></ul>
          <button className={'button ' + (index === 1 ? 'primary' : 'secondary')} aria-haspopup="dialog" onClick={() => {setSelected(index); setError(''); setAvailability('checking');}}>Choose {item.name} <span aria-hidden="true">↗</span></button>
        </article>)}</div>
        <p className="plan-reassurance"><span>PayPal checkout</span><span>Paid once for your chosen period</span><span>No recurring charge</span></p>
      </section>

      <section className="how section" id="how" aria-labelledby="how-title">
        <div><p className="eyebrow">LESS FUSS. MORE FAVORITES.</p><h2 id="how-title">From your plan<br/>to your sofa.</h2><p className="muted">Your customer hub keeps your subscription, line login, and channel choices together. Renew online whenever you need more time.</p></div>
        <div className="steps">{[['Find your fit', 'Choose 1–4 simultaneous screens and a 3, 6 or 12 month plan.'], ['Get connected', 'Review your total on PayPal. Once payment is confirmed, your subscription is activated and linked to your customer account.'], ['Settle in', 'Open the web player or follow our TV setup guide. When it’s time to renew, choose your next period and pay online.']].map(([heading, copy], index) => <div key={heading}><span aria-hidden="true">0{index + 1}</span><section><h3>{heading}</h3><p>{copy}</p></section></div>)}</div>
      </section>

      <section className="access section" id="customer-access" aria-labelledby="access-title">
        <p className="eyebrow">ALREADY PART OF THE NEST?</p><h2 id="access-title">Your subscription.<br/>One familiar place.</h2><p>Find your line login, manage your subscription, and make yourself at home.</p>
        <div className="actions access-actions">{portal && <a className="button primary" href={portal}>Open customer hub <span aria-hidden="true">↗</span></a>}<a className="button access-secondary" href="/renew">Renew subscription <span aria-hidden="true">↗</span></a><a className="button access-secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a><a className="button access-secondary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></div>
        {!portal && <p className="notice">Customer sign-in is being connected. <a href={'mailto:' + supportEmail}>Contact support for help with your subscription.</a></p>}
        <p className="access-help">Your customer account and your line login may use different passwords.</p>
      </section>

      <section className="faq section" id="faq" aria-labelledby="faq-title"><div><p className="eyebrow">GOOD TO KNOW</p><h2 id="faq-title">A few things<br/>before you settle in.</h2><a className="text-link faq-support" href={'mailto:' + supportEmail}>Need a hand? Contact support <span aria-hidden="true">↗</span></a></div><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
    </main>
    <footer className="site-footer"><div className="footer-brand"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a><p>Settle in. Stay curious.</p></div><nav aria-label="Footer navigation"><a href={'mailto:' + supportEmail}>Contact support</a><a href="/renew">Renew subscription</a><a href="/watch">Web player</a><a href="/apps">TV setup</a>{portal && <a href={portal}>Customer hub</a>}</nav><span className="copyright">© {new Date().getFullYear()} LumaNest TV</span></footer>

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
