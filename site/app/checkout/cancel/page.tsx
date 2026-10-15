import {settings} from '../../../lib/mybunny';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Checkout cancelled | LumaNest TV'};

export default function CheckoutCancel() {
  const portal = settings().CUSTOMER_PORTAL_URL || 'https://portal.lumanest.tv';
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  return <div className="checkout-result">
    <header className="checkout-result-header"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="64"/></a><a href={'mailto:' + support}>Contact support <span aria-hidden="true">↗</span></a></header>
    <main className="checkout-result-main"><section className="checkout-result-card"><p className="eyebrow">YOUR PLACE WILL BE HERE</p><h1>Take your time.</h1><div className="checkout-result-status"><p>You returned from checkout. Check PayPal for your payment status before trying again.</p></div><p>If you approved a payment or have a receipt, contact support before starting another checkout. Otherwise, choose a new plan or renew your existing line whenever you’re ready.</p><div className="actions"><a className="button primary" href="/renew">Renew existing line <span aria-hidden="true">↗</span></a><a className="button secondary" href="/#plans">New subscription <span aria-hidden="true">↗</span></a><a className="button secondary" href={portal}>Customer hub <span aria-hidden="true">↗</span></a><a className="button secondary" href={'mailto:' + support + '?subject=Checkout%20help'}>Contact support <span aria-hidden="true">↗</span></a></div></section></main>
    <footer className="checkout-result-footer">LumaNest TV · Settle in. Stay curious.</footer>
  </div>;
}
