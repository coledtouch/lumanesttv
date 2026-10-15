export const metadata = {title: 'Page not found | LumaNest TV', robots: {index: false, follow: false}};

export default function NotFound() {
  return <div className="checkout-result">
    <header className="checkout-result-header"><a href="/" aria-label="LumaNest TV home"><img className="logo" src="/logo.png" alt="LumaNest TV" width="204" height="52"/></a><a href="mailto:support@lumanest.tv">Contact support <span aria-hidden="true">↗</span></a></header>
    <main className="checkout-result-main"><section className="checkout-result-card" aria-labelledby="not-found-title"><p className="eyebrow">PAGE NOT FOUND</p><h1 id="not-found-title">This room is empty.</h1><p>The page you’re looking for has moved or doesn’t exist. Let’s get you back somewhere cozy.</p><div className="actions"><a className="button primary" href="/">Back to LumaNest <span aria-hidden="true">↗</span></a><a className="button secondary" href="/watch">Watch now <span aria-hidden="true">↗</span></a><a className="button secondary" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></div></section></main>
    <footer className="checkout-result-footer">LumaNest TV · Settle in. Stay curious.</footer>
  </div>;
}
