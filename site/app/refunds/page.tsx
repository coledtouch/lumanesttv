import LegalPage, {legalSettings} from '../legal-page';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Refunds | LumaNest TV', description: 'How to request a refund for a LumaNest TV order, and how to turn off auto-renew.', alternates: {canonical: '/refunds'}};

export default function Refunds() {
  const {support} = legalSettings();
  return <LegalPage path="/refunds" eyebrow="IF SOMETHING ISN’T RIGHT" title={<>Refund <em>policy.</em></>} lead="If something isn’t right with your order, talk to us. Here’s how refund requests work.">
    <h2>Requesting a refund</h2>
    <p>Email <a href={'mailto:' + support + '?subject=' + encodeURIComponent('Refund request')}>{support}</a> with:</p>
    <ul>
      <li>Your order reference (shown on the order status page after checkout) or your PayPal receipt.</li>
      <li>The email address you used at checkout.</li>
      <li>A short note about what went wrong.</li>
    </ul>
    <p>Every request is reviewed individually. We’ll reply by email with the outcome. If a refund is approved, it’s issued through PayPal.</p>
    <h2>Please don’t pay twice</h2>
    <p>If your payment went through but your subscription isn’t showing yet, contact support with your order reference before placing another order. We’ll sort it out.</p>
    <h2>PayPal buyer protection</h2>
    <p>All payments are made through PayPal, so PayPal’s buyer protection may also apply to your purchase, depending on PayPal’s own terms.</p>
    <h2>Auto-renew</h2>
    <p>Optional auto-renew is only available when you renew an existing line, and only if you choose it. You can turn it off at any time before your next billing date on the <a href="/renew">renewal page</a>, or in your PayPal account. Turning it off stops future payments; the time you’ve already paid for stays on your line.</p>
    <p className="legal-contact">Need a hand? Email <a href={'mailto:' + support}>{support}</a>.</p>
  </LegalPage>;
}
