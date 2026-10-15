import {settings} from '../../../lib/mybunny';
import {DEFAULT_PORTAL} from '../../site';
import {SiteFooter, SiteHeader} from '../../site-chrome';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Checkout cancelled | LumaNest TV', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default function CheckoutCancel() {
  const portal = settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL;
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  return <div className="checkout-result">
    <SiteHeader portal={portal} install={false}/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card"><p className="eyebrow">YOUR PLACE WILL BE HERE</p><h1>Take your time.</h1><div className="checkout-result-status"><p>You returned from checkout. Check PayPal for your payment status before trying again.</p></div><p>If you approved a payment or have a receipt, contact support before starting another checkout. Otherwise, choose a new plan or renew your existing line whenever you’re ready.</p><div className="actions"><a className="button primary" href="/renew">Renew existing line <span aria-hidden="true">↗</span></a><a className="button secondary" href="/#plans">New subscription <span aria-hidden="true">↗</span></a><a className="button secondary" href={portal}>Customer hub <span aria-hidden="true">↗</span></a><a className="button secondary" href={'mailto:' + support + '?subject=Checkout%20help'}>Contact support <span aria-hidden="true">↗</span></a></div></section></main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
