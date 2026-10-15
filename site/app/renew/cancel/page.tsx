import {SiteFooter, SiteHeader} from '../../site-chrome';
import {settings} from '../../../lib/mybunny';
import {DEFAULT_PORTAL} from '../../site';

export const dynamic = 'force-dynamic';

export const metadata = {title: 'Auto-renew approval paused | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function AutoRenewCancel() {
  const portal = settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL, support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  return <div className="checkout-result">
    <SiteHeader portal={portal} current="/renew" install={false}/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card"><p className="eyebrow">AUTOMATIC PAYMENT APPROVAL</p><h1>You’re back at LumaNest.</h1><p>Leaving PayPal approval does not confirm a cancellation. Sign in to your renewal settings to check whether the agreement is awaiting approval or active, and stop future charges if you wish.</p><div className="actions"><a className="button primary" href="/renew">Check my renewal settings ↗</a><a className="button secondary" href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noreferrer">Manage payments in PayPal ↗</a></div></section></main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
