// Navigation links for the shared public header and footer (site-chrome.tsx).
import {DEFAULT_PORTAL} from './site.ts';

export type SiteLink = readonly [href: string, label: string];

// Links to buying or renewing a plan. Pages reached from a store-distributed app (the TV pairing page,
// opened from the Apple TV app's QR code) leave them out, because App Store review doesn't allow an app
// to steer customers to purchases outside the store.
const PURCHASE = new Set(['/#plans', '/renew']);

const HEADER: readonly SiteLink[] = [['/#plans', 'Plans'], ['/watch', 'Watch now'], ['/renew', 'Renew'], ['/apps', 'Set up my TV'], ['/#faq', 'Help']];

export function headerLinks(purchases = true): SiteLink[] {
  return HEADER.filter(([href]) => purchases || !PURCHASE.has(href));
}

export function footerLinks({portal, support, purchases = true}: {portal?: string; support?: string; purchases?: boolean}): SiteLink[] {
  const links: SiteLink[] = [
    ['mailto:' + (support || 'support@lumanest.tv'), 'Contact support'],
    ['/renew', 'Renew subscription'],
    ['/watch', 'Web player'],
    ['/apps', 'TV setup'],
    [portal || DEFAULT_PORTAL, 'Customer hub'],
    ['/#logins', 'Which login?'],
  ];
  return links.filter(([href]) => purchases || !PURCHASE.has(href));
}
