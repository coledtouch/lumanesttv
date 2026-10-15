import type {ReactNode} from 'react';
import {settings} from '../lib/mybunny';
import {DEFAULT_PORTAL} from './site';
import {SiteFooter, SiteHeader} from './site-chrome';

export const LEGAL_UPDATED = '2026-10-15';
export const legalSettings = () => ({portal: settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL, support: settings().SUPPORT_EMAIL || 'support@lumanest.tv'});

export default function LegalPage({path, eyebrow, title, lead, children}: {path: string; eyebrow: string; title: ReactNode; lead: string; children: ReactNode}) {
  const {portal, support} = legalSettings();
  return <>
    <SiteHeader portal={portal}/>
    <main className="legal-page" id="main-content"><article aria-labelledby="legal-title">
      <p className="eyebrow">{eyebrow}</p><h1 id="legal-title">{title}</h1>
      <p className="legal-updated">Last updated <time dateTime={LEGAL_UPDATED}>October 15, 2026</time></p>
      <p className="legal-lead">{lead}</p>
      {children}
    </article></main>
    <SiteFooter portal={portal} support={support} current={path}/>
  </>;
}
