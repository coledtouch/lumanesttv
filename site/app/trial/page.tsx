import './trial.css';
import TrialRequest from './trial-request';
import {settings} from '../../lib/mybunny';
import {trialsReady} from '../../lib/trials';
import {DEFAULT_PORTAL, openGraph} from '../site';
import {SiteFooter, SiteHeader} from '../site-chrome';

export const dynamic = 'force-dynamic';
// While trials are off the page only says so, so search engines aren't offered a free trial that isn't there.
export function generateMetadata() {
  return trialsReady() ?
    {title: 'Free 24-hour trial | LumaNest TV', description: 'Request a free, full-feature 24-hour LumaNest TV trial. No payment details needed. Every request is reviewed by hand.', alternates: {canonical: '/trial'}, openGraph: {...openGraph, url: '/trial'}} :
    {title: 'Free trial | LumaNest TV', description: 'Free LumaNest TV trials aren’t available right now. See our plans instead.', alternates: {canonical: '/trial'}, robots: {index: false, follow: true}};
}

export default function Trial() {
  const portal = settings().CUSTOMER_PORTAL_URL || DEFAULT_PORTAL;
  const support = settings().SUPPORT_EMAIL || 'support@lumanest.tv';
  // The form only appears when trials are switched on and the provider, hub and request-hashing key are configured.
  const ready = trialsReady();
  return <>
    <SiteHeader portal={portal}/>
    <main id="main-content" className="trial-page">
      {ready ? <div className="trial-layout">
        <section className="trial-intro" aria-labelledby="trial-title">
          <p className="eyebrow trial-eyebrow">TRY IT BEFORE YOU SETTLE IN</p>
          <h1 id="trial-title">24 hours,<br/>on the <em>house.</em></h1>
          <p className="trial-lede">Request a free, full-feature trial of LumaNest. No payment details, nothing to cancel — it simply ends after 24 hours.</p>
          <ol className="trial-steps">
            <li><span aria-hidden="true">1</span><div><strong>Send your request</strong><p>It takes a minute. You’ll get a private link to check on it.</p></div></li>
            <li><span aria-hidden="true">2</span><div><strong>We review it</strong><p>A person checks every request, as soon as we can.</p></div></li>
            <li><span aria-hidden="true">3</span><div><strong>Settle in for 24 hours</strong><p>Once approved, your customer hub emails you an invitation. Sign in to find your line login for the web player and TV apps.</p></div></li>
          </ol>
          <p className="trial-aside">One free trial per person and household. Already know what you want? <a href="/#plans">See plans</a></p>
        </section>
        <TrialRequest support={support}/>
      </div> : <section className="trial-card trial-unavailable" aria-labelledby="trial-title">
        <p className="eyebrow trial-eyebrow">FREE TRIAL</p>
        <h1 id="trial-title">No free trials <em>right now.</em></h1>
        <p>Free trials aren’t available at the moment. You can choose a plan instead, or email us if you have a question first.</p>
        <div className="trial-actions"><a className="button primary" href="/#plans">See plans <span aria-hidden="true">↗</span></a><a className="button secondary" href={'mailto:' + support}>Contact support <span aria-hidden="true">↗</span></a></div>
      </section>}
    </main>
    <SiteFooter portal={portal} support={support}/>
  </>;
}
