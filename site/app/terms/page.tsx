import LegalPage, {legalSettings} from '../legal-page';
import {plans, periods} from '../../lib/plans';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Terms | LumaNest TV', description: 'The terms for buying, renewing and using a LumaNest TV subscription.', alternates: {canonical: '/terms'}};

export default function Terms() {
  const {support, portal} = legalSettings();
  return <LegalPage path="/terms" updated={['2026-10-23', 'October 23, 2026']} eyebrow="THE HOUSE RULES" title={<>Terms of <em>service.</em></>} lead="These terms cover buying, renewing and using a LumaNest TV subscription, including a free trial. We’ve kept them short and plain. By requesting a trial or placing an order, you agree to them.">
    <h2>What you’re buying</h2>
    <p>A LumaNest TV subscription gives you access to live channels, movies and series for a set number of simultaneous screens and a set period. Plans are {plans.map(plan => plan.name + ' (' + plan.devices + (plan.devices === 1 ? ' screen' : ' screens') + ')').join(', ')}, for {periods.join(', ').replace(/, (\d+)$/, ' or $1')} months. Current prices are shown in USD on our <a href="/#plans">plans section</a>.</p>
    <h2>Free trial</h2>
    <ul>
      <li>When free trials are offered, you can request one free 24-hour trial. It’s limited to one per person and household, and we may decline a request from a home network that has already had one.</li>
      <li>Every request is reviewed by the site owner, who may approve or decline it. A trial isn’t guaranteed, and trials may be paused at any time.</li>
      <li>An approved trial lasts about 24 hours from when it’s activated (your trial’s status page shows exactly when it ends), then ends automatically.</li>
      <li>A trial is free. We don’t ask for payment details, and it never turns into a paid subscription on its own. To keep watching, choose a plan.</li>
      <li>The same rules apply as for a subscription (see Your logins and Using your subscription).</li>
    </ul>
    <h2>Payment</h2>
    <ul>
      <li>Payments are processed by PayPal. You review and approve the full total on PayPal before you’re charged.</li>
      <li>New plans and pay-once renewals are a single payment for the period you choose. They do not renew automatically.</li>
      <li>When it’s available for your line, you can choose optional auto-renew when renewing. Auto-renew charges the displayed total every selected period until you turn it off, and needs your separate PayPal agreement. You can turn it off at any time on the <a href="/renew">renewal page</a> or in PayPal.</li>
      <li>Your subscription starts, or your existing line is extended, after payment is confirmed. Some plans may need support activation; if so, we’ll tell you before you pay.</li>
    </ul>
    <h2>Your logins</h2>
    <p>You’ll have a customer account (your email and password) for your customer hub, and a line login (a username and password) for watching and renewing. <a href="/#logins">Here’s which login goes where.</a> Keep both private. You’re responsible for activity on your logins.</p>
    <h2>Using your subscription</h2>
    <ul>
      <li>Your plan sets how many devices can watch at the same time. Please don’t share your line login beyond that.</li>
      <li>Use the service for personal viewing. Don’t resell it, and don’t try to get around its limits or security.</li>
      <li>You can watch in the web player or set up a supported device using our <a href="/apps">setup guide</a>. Device apps and installation methods can change, and some devices may be temporarily unavailable.</li>
      <li>The channels, movies and series available can change over time.</li>
    </ul>
    <h2>Upgrades</h2>
    <p>You can upgrade up to four screens. The price depends on your line and its remaining time, so request a quote from your {portal ? <a href={portal}>customer hub</a> : 'customer hub'} before paying.</p>
    <h2>Refunds</h2>
    <p>See our <a href="/refunds">refund policy</a> for how refund requests are handled.</p>
    <h2>Trailers and YouTube</h2>
    <p>Trailers in the web player, and in the Tuner apps for Android TV, Google TV, Fire TV, Samsung and LG TVs, play in YouTube’s embedded player, a YouTube API Service. By using the web player or those apps, you agree to be bound by the <a href="https://www.youtube.com/t/terms" rel="noopener noreferrer">YouTube Terms of Service</a>. YouTube serves the trailers and may show its own ads in its player.</p>
    <h2>Privacy</h2>
    <p>Our <a href="/privacy">privacy policy</a> explains what we collect and why.</p>
    <h2>Changes to these terms</h2>
    <p>We may update these terms. When we do, we’ll change the “last updated” date above. Changes don’t affect a period you’ve already paid for.</p>
    <p className="legal-contact">Questions about these terms? Email <a href={'mailto:' + support}>{support}</a>.</p>
  </LegalPage>;
}
