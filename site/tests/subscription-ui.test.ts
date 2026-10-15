import test from 'node:test';
import assert from 'node:assert/strict';
import {canStartAutoRenew, isBillingOptions, isEnrollmentStatus, recurringTerms, type BillingOptions} from '../app/renew/billing-view.ts';

function options(): BillingOptions {
  return {available: true, pay_once_available: true, offers: [3, 6, 12].map(months => ({months: months as 3 | 6 | 12, amount: 59, currency: 'USD', available: true})), starts_at: '2027-01-01T12:00:00.000Z', subscription: null, message: null};
}

test('auto-renew is offered only after server readiness and the selected period are available', () => {
  const data = options();
  assert.equal(isBillingOptions(data), true);
  assert.equal(canStartAutoRenew(null, 3), false);
  assert.equal(canStartAutoRenew({...data, available: false}, 3), false);
  assert.equal(canStartAutoRenew({...data, pay_once_available: false}, 3), false);
  assert.equal(canStartAutoRenew({...data, offers: data.offers.map(offer => ({...offer, available: offer.months !== 3}))}, 3), false);
  assert.equal(canStartAutoRenew(data, 3), true);
});

test('billing display rejects malformed prices, duplicated periods, dates and agreement states', () => {
  const data = options();
  const subscription = {status: 'active' as const, months: 3 as const, amount: 59, currency: 'USD' as const, starts_at: null, next_billing_at: data.starts_at, last_payment_status: null, cancel_available: true, activation_available: false, message: null};
  assert.equal(isBillingOptions({...data, subscription}), true);
  assert.equal(isBillingOptions({...data, subscription: {...subscription, activation_available: true}}), false);
  assert.equal(isBillingOptions({...data, subscription: {...subscription, status: 'payment_captured'}}), false);
  assert.equal(isBillingOptions({...data, subscription: {...subscription, next_billing_at: 'tomorrow'}}), false);
  assert.equal(isBillingOptions({...data, subscription: {...subscription, last_payment_status: 'approved'}}), false);
  assert.equal(isBillingOptions({...data, offers: data.offers.map(offer => ({...offer, amount: -1}))}), false);
  assert.equal(isBillingOptions({...data, offers: [data.offers[0], data.offers[0], data.offers[2]]}), false);
  assert.equal(isBillingOptions({...data, pay_once_available: undefined}), false);
});

test('activation requires a verified server status, never an approval query or paid claim', () => {
  assert.equal(isEnrollmentStatus({status: 'pending', message: 'PayPal approved; finish enrollment.', activation_available: true}), true);
  assert.equal(isEnrollmentStatus({status: 'active', message: 'Enrollment active.', activation_available: false}), true);
  assert.equal(isEnrollmentStatus({status: 'paid', message: 'Paid.', activation_available: false}), false);
  assert.equal(isEnrollmentStatus({subscription: 'query-reference', subscription_id: 'I-QUERY'}), false);
  assert.equal(isEnrollmentStatus({status: 'pending', message: 'Pending.'}), false);
  assert.equal(isEnrollmentStatus({status: 'cancelled', message: 'Stopped.', activation_available: true}), false);
});

test('customer disclosure shows the full charge and recurrence interval', () => {
  assert.equal(recurringTerms(59, 3), '$59 every 3 months until cancelled');
  assert.equal(recurringTerms(99.5, 6), '$99.50 every 6 months until cancelled');
  assert.equal(recurringTerms(159, 12), '$159 every 12 months until cancelled');
});
