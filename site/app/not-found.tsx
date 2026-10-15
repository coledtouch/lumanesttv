import {SiteFooter, SiteHeader} from './site-chrome';
import {settings} from '../lib/mybunny';
import {DEFAULT_PORTAL} from './site';

export const metadata = {title: 'Page not found | LumaNest TV', robots: {index: false, follow: false}};

// The 404 page may also be rendered without a request environment; fall back to the public defaults then.
function configured() {
  try {return {portal: settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL, support: settings().SUPPORT_EMAIL || 'support@lumanest.tv'};}
  catch {return {portal: DEFAULT_PORTAL, support: 'support@lumanest.tv'};}
}

export default function NotFound() {
  const {portal, support} = configured();
  return <div className="checkout-result">
    <SiteHeader portal={portal}/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card" aria-labelledby="not-found-title"><p className="eyebrow">PAGE NOT FOUND</p><h1 id="not-found-title">This room is empty.</h1><p>The page you’re looking for has moved or doesn’t exist. Let’s get you back somewhere cozy.</p><div className="actions"><a className="button primary" href="/">Back to LumaNest <span aria-hidden="true">↗</span></a><a className="button secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a><a className="button secondary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></div></section></main>
    <SiteFooter portal={portal} support={support}/>
  </div>;
}
