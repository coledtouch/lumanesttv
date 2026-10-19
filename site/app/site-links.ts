// Navigation links for the shared public header and footer (site-chrome.tsx).
import {DEFAULT_PORTAL} from './site.ts';

export type SiteLink = readonly [href: string, label: string];
type Entry = readonly [href: string, label: string, sells?: true];

// Links marked `sells` lead to buying or renewing a plan: Plans, Renew, and the customer hub (the provider's
// portal, which offers renewals). Pages reached from a store-distributed app (the TV pairing page, opened from
// the Apple TV app's QR code) leave them out, because App Store review doesn't allow an app to steer customers
// to purchases outside the store.
const HEADER: readonly Entry[] = [['/#plans', 'Plans', true], ['/watch', 'Watch now'], ['/renew', 'Renew', true], ['/apps', 'Set up my TV'], ['/#faq', 'Help']];

const keep = (purchases: boolean) => ([, , sells]: Entry) => purchases || !sells;
const link = ([href, label]: Entry): SiteLink => [href, label];

export function headerLinks(purchases = true): SiteLink[] {
  return HEADER.filter(keep(purchases)).map(link);
}

/** The header's "Customer hub" link, or null when purchase links are left out. */
export function headerHub(portal: string | undefined, purchases = true): string | null {
  return purchases ? portal || DEFAULT_PORTAL : null;
}

export function footerLinks({portal, support, purchases = true}: {portal?: string; support?: string; purchases?: boolean}): SiteLink[] {
  const links: readonly Entry[] = [
    ['mailto:' + (support || 'support@lumanest.tv'), 'Contact support'],
    ['/renew', 'Renew subscription', true],
    ['/watch', 'Web player'],
    ['/apps', 'TV setup'],
    [portal || DEFAULT_PORTAL, 'Customer hub', true],
    ['/#logins', 'Which login?'],
  ];
  return links.filter(keep(purchases)).map(link);
}
