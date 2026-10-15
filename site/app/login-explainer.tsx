// Shared "two logins" explainer. Pages link to it with /#logins.
export default function LoginExplainer({portal, id = 'logins'}: {portal?: string; id?: string}) {
  return <section className="login-explainer" id={id} aria-labelledby={id + '-title'}>
    <div className="login-explainer-intro"><p className="eyebrow">TWO KEYS TO ONE HOME</p><h2 id={id + '-title'}>Which login <em>goes where?</em></h2><p>LumaNest uses two separate logins. Their passwords can be different, so keep both somewhere safe.</p></div>
    <div className="login-cards">
      <article className="login-card"><span className="login-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
        <p className="login-kicker">YOUR ACCOUNT</p><h3>Email &amp; password</h3><p>For billing, your subscription and your customer hub.</p>
        <dl><dt>Where to find it</dt><dd>It uses the email you entered at checkout. Look in that inbox for your customer hub invitation.</dd></dl>
        {portal && <a className="text-link" href={portal}>Open customer hub <span aria-hidden="true">↗</span></a>}
      </article>
      <article className="login-card is-line"><span className="login-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 8.5 4 2-4 2z"/></svg></span>
        <p className="login-kicker">YOUR LINE LOGIN</p><h3>Username &amp; password</h3><p>For watching in the TV apps and the web player, and for renewing online.</p>
        <dl><dt>Where to find it</dt><dd>In your customer hub, in your subscription’s TV/app setup details.</dd></dl>
        <span className="login-links"><a className="text-link" href="/watch">Watch now <span aria-hidden="true">↗</span></a><a className="text-link" href="/apps">Set up my TV <span aria-hidden="true">↗</span></a></span>
      </article>
    </div>
  </section>;
}
