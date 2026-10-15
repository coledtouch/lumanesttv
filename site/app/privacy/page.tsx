import LegalPage, {legalSettings} from '../legal-page';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Privacy | LumaNest TV', description: 'What LumaNest TV collects, why, and who processes it. No ad trackers or analytics scripts.', alternates: {canonical: '/privacy'}};

export default function Privacy() {
  const {support} = legalSettings();
  return <LegalPage path="/privacy" eyebrow="YOUR HOME, YOUR BUSINESS" title={<>Privacy <em>policy.</em></>} lead="We collect only what we need to sell, activate and renew your subscription. This page explains what that is and where it goes.">
    <h2>What we collect at checkout</h2>
    <ul>
      <li><strong>Your email address</strong> (required) and <strong>your name</strong> (optional).</li>
      <li>Your order details: plan, number of screens, period, amount, PayPal order and payment references, and the order’s status.</li>
    </ul>
    <p>We use these to create or extend your subscription, set up your customer account, help you with support, and keep a record of payments.</p>
    <h2>Payments</h2>
    <p>Payments are handled by PayPal. You pay on PayPal’s own pages, so this website never sees your card or bank details. We receive the payment confirmation and references we need to activate your order. If you choose auto-renew, PayPal also tells us about each scheduled payment and if the agreement is cancelled.</p>
    <h2>Your customer account</h2>
    <p>To activate a new subscription, we send your email address and name to our subscription management provider, which creates your line and emails you an invitation to your customer hub. Your customer account password is set and kept in the customer hub, not on this website.</p>
    <h2>Your line login</h2>
    <p>When you sign in to the web player or the renewal page, your line username and password are used only to sign you in and are checked with our subscription provider. They are kept in an encrypted, HttpOnly session cookie in your browser, not stored in our database. If you set up auto-renew, we store a one-way hash of your line login to link the agreement to your line.</p>
    <h2>Admin access</h2>
    <p>The site owner can view orders and subscription records in a protected admin console, to fulfil orders and answer support requests.</p>
    <h2>Security and abuse prevention</h2>
    <p>To limit repeated sign-in and checkout attempts, we keep short-lived rate-limit records. They are stored as hashes, not as your IP address or your login.</p>
    <h2>Cookies and browser storage</h2>
    <ul>
      <li>We only use cookies needed for signing in: the web player, renewal and admin sessions.</li>
      <li>Your browser’s local storage keeps your web player favorites and whether you dismissed the “install app” prompt. This stays on your device.</li>
      <li>We don’t use advertising trackers or analytics scripts.</li>
    </ul>
    <h2>Other services</h2>
    <ul>
      <li>The site runs on Cloudflare, which processes requests to deliver it.</li>
      <li>Fonts are loaded from Google Fonts, which receives standard request information such as your IP address.</li>
    </ul>
    <h2>Your choices</h2>
    <p>You can ask us what we hold about you, or ask us to correct or delete it, by emailing support. We may need to keep payment records where the law requires it.</p>
    <p className="legal-contact">Privacy questions? Email <a href={'mailto:' + support}>{support}</a>.</p>
  </LegalPage>;
}
