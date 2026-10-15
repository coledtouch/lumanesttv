import {SiteFooter, SiteHeader} from './site-chrome';

export const metadata = {title: 'Page not found | LumaNest TV', robots: {index: false, follow: false}};

export default function NotFound() {
  return <div className="checkout-result">
    <SiteHeader/>
    <main id="main-content" className="checkout-result-main"><section className="checkout-result-card" aria-labelledby="not-found-title"><p className="eyebrow">PAGE NOT FOUND</p><h1 id="not-found-title">This room is empty.</h1><p>The page you’re looking for has moved or doesn’t exist. Let’s get you back somewhere cozy.</p><div className="actions"><a className="button primary" href="/">Back to LumaNest <span aria-hidden="true">↗</span></a><a className="button secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a><a className="button secondary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></div></section></main>
    <SiteFooter/>
  </div>;
}
