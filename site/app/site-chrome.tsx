'use client';

// Shared public header and footer. The owner console (app/manage) keeps its own header.
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {footerLinks, headerHub, headerLinks} from './site-links';

const legal = [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/refunds', 'Refunds']] as const;
// eslint-disable-next-line @next/next/no-img-element -- static logo PNG with explicit width/height; vinext's next/image would route it through /_next/image and lazy-load the above-the-fold logo
const logo = (width: number) => <a className="chrome-home" href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width={width} height="64"/></a>;

/**
 * Renders the skip link and header; every page using it must give its main element id="main-content".
 * `purchases={false}` leaves out the Plans, Renew and Customer hub links (see site-links.ts).
 */
export function SiteHeader({portal, current, install = true, actions, purchases = true}: {portal?: string; current?: string; install?: boolean; actions?: ReactNode; purchases?: boolean}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const hub = headerHub(portal, purchases);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {if (event.key === 'Escape') {setOpen(false); toggle.current?.focus();}};
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="chrome-header">
      {logo(204)}
      <button ref={toggle} type="button" className="chrome-menu-toggle" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}><span className="chrome-menu-label">{open ? 'Close' : 'Menu'}</span><span aria-hidden="true">{open ? '×' : '☰'}</span></button>
      <nav id="primary-navigation" className={open ? 'is-open' : ''} aria-label="Main navigation" onClick={event => {if (event.target instanceof Element && event.target.closest('a')) setOpen(false);}}>
        {headerLinks(purchases).map(([href, label]) => <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>{label}</a>)}
        {install && <span className="chrome-install" data-pwa-install-slot=""/>}
        {hub && <a className="chrome-hub" href={hub}>Customer hub <span aria-hidden="true">↗</span></a>}
      </nav>
      {actions && <div className="chrome-actions">{actions}</div>}
    </header>
  </>;
}

export function SiteFooter({portal, support, current, purchases = true}: {portal?: string; support?: string; current?: string; purchases?: boolean}) {
  return <footer className="chrome-footer">
    <div className="chrome-footer-brand">{logo(204)}<p>Settle in. Stay curious.</p></div>
    <nav aria-label="Footer navigation">{footerLinks({portal, support, purchases}).map(([href, label]) => <a key={label} href={href}>{label}</a>)}</nav>
    <div className="chrome-copyright"><span>© {new Date().getFullYear()} LumaNest TV</span><nav aria-label="Legal">{legal.map(([href, label]) => <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>{label}</a>)}</nav></div>
  </footer>;
}
