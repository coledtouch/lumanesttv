import type {ReactNode} from 'react';
import {settings} from '../lib/mybunny';
import {DEFAULT_PORTAL} from './site';

export const LEGAL_UPDATED = '2026-10-15';
export const legalSettings = () => ({portal: settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL, support: settings().SUPPORT_EMAIL || 'support@lumanest.tv'});

export default function LegalPage({path, eyebrow, title, lead, children}: {path: string; eyebrow: string; title: ReactNode; lead: string; children: ReactNode}) {
  const {portal} = legalSettings();
  return <>
    <a className="skip-link" href="#legal-main">Skip to content</a>
    <header className="site-header"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a><nav className="scroll-nav" aria-label="Main navigation"><a href="/#plans">Plans</a><a href="/renew">Renew</a><a className="nav-cta" href={portal}>Customer sign in <span aria-hidden="true">↗</span></a></nav></header>
    <main className="legal-page" id="legal-main"><article aria-labelledby="legal-title">
      <p className="eyebrow">{eyebrow}</p><h1 id="legal-title">{title}</h1>
      <p className="legal-updated">Last updated <time dateTime={LEGAL_UPDATED}>October 15, 2026</time></p>
      <p className="legal-lead">{lead}</p>
      {children}
    </article></main>
    <footer className="legal-footer"><span>© {new Date().getFullYear()} LumaNest TV</span><nav aria-label="Legal">{[['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/refunds', 'Refunds'], ['/', 'Home']].map(([href, label]) => <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>{label}</a>)}</nav></footer>
  </>;
}
