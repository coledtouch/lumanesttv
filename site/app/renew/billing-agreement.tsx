'use client';

import {RefreshCw} from 'lucide-react';
import {billingDate, billingStatus, recurringTerms, type BillingOptions} from './billing-view';
import styles from './renewal.module.css';

export default function BillingAgreement({billing, disabled, cancelling, activating, confirming, onConfirm, onCancel, onActivate, onRefresh}: {
  billing: BillingOptions;
  disabled: boolean;
  cancelling: boolean;
  activating: boolean;
  confirming: boolean;
  onConfirm: (confirm: boolean) => void;
  onCancel: () => void;
  onActivate: () => void;
  onRefresh: () => void;
}) {
  const subscription = billing.subscription;
  if (!subscription) return null;
  const stopped = ['cancelled', 'expired'].includes(subscription.status);
  return <section className={styles.agreement} aria-label="Your automatic payment agreement">
    <div className={styles.agreementHeading}><RefreshCw size={18} aria-hidden="true"/><h3>{subscription.activation_available ? 'PayPal approval received' : billingStatus[subscription.status]}</h3></div>
    <p className={styles.agreementTerms}>{stopped ? 'Previous agreement: ' : ''}{recurringTerms(subscription.amount, subscription.months)} · USD</p>
    {subscription.next_billing_at && !stopped && <p>Next payment: <time dateTime={subscription.next_billing_at}>{billingDate(subscription.next_billing_at)}</time>.</p>}
    {!subscription.next_billing_at && (subscription.status === 'active' || subscription.activation_available) && <p>{subscription.activation_available && subscription.starts_at && Date.parse(subscription.starts_at) <= Date.now() ? 'First payment: shortly after you finish enrollment.' : subscription.starts_at ? <>First payment: <time dateTime={subscription.starts_at}>{billingDate(subscription.starts_at)}</time>.</> : 'Your next billing date is being confirmed with PayPal.'}</p>}
    {subscription.message && <p>{subscription.message}</p>}
    {subscription.last_payment_status === 'needs_review' && <p className={styles.agreementWarning}>Payment received; your renewal needs support review. Contact us before paying again.</p>}
    {!billing.pay_once_available && <p>Stop this automatic payment agreement before starting another renewal.</p>}
    {subscription.activation_available && <div className={styles.cancelReview}><p>You approved these recurring payment terms on PayPal. Finish enrollment to schedule future automatic payments. Your line extends only after each confirmed payment.</p><button className={styles.stopButton} type="button" disabled={disabled} onClick={onActivate}>{activating ? 'Finishing enrollment…' : 'Finish auto-renew enrollment'}</button></div>}
    {stopped && <p>No future automatic payments are scheduled. Your already-paid viewing time stays available.</p>}
    {subscription.cancel_available && (confirming ? <div className={styles.cancelReview}><p><strong>Stop future automatic payments?</strong> Already-paid viewing time remains available. A payment already in progress may still complete.</p><div><button className={styles.stopButton} type="button" disabled={disabled} onClick={onCancel}>{cancelling ? 'Stopping payments…' : 'Stop automatic payments'}</button><button className={styles.textButton} type="button" disabled={disabled} onClick={() => onConfirm(false)}>Keep auto-renew</button></div></div> : <button className={styles.textButton} type="button" disabled={disabled} onClick={() => onConfirm(true)}>Turn off auto-renew</button>)}
    <button className={styles.textButton} type="button" disabled={disabled} onClick={onRefresh}>Refresh billing status</button>
    <a className={styles.textButton} href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noreferrer">Manage payments directly in PayPal ↗</a>
  </section>;
}
