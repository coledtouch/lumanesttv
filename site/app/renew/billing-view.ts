export type BillingOffer = {months: 3 | 6 | 12; amount: number; currency: 'USD'; available: boolean};
export type BillingSubscription = {
  status: 'approval_pending' | 'active' | 'suspended' | 'cancelled' | 'expired' | 'needs_review';
  months: 3 | 6 | 12;
  amount: number;
  currency: 'USD';
  starts_at: string | null;
  next_billing_at: string | null;
  last_payment_status: 'fulfilled' | 'needs_review' | null;
  cancel_available: boolean;
  activation_available: boolean;
  message: string | null;
};
export type BillingOptions = {
  available: boolean;
  pay_once_available: boolean;
  offers: BillingOffer[];
  starts_at: string | null;
  subscription: BillingSubscription | null;
  message: string | null;
};

const validDate = (value: unknown) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const validMessage = (value: unknown) => value === null || typeof value === 'string';

export function isBillingOptions(value: unknown): value is BillingOptions {
  if (!value || typeof value !== 'object') return false;
  const data = value as BillingOptions;
  if (typeof data.available !== 'boolean' || typeof data.pay_once_available !== 'boolean' || !validDate(data.starts_at) || !validMessage(data.message) ||
    !Array.isArray(data.offers) || data.offers.length !== 3 || new Set(data.offers.map(offer => offer?.months)).size !== 3 ||
    !data.offers.every(offer => offer && [3, 6, 12].includes(offer.months) && Number.isFinite(offer.amount) && offer.amount > 0 && offer.currency === 'USD' && typeof offer.available === 'boolean')) return false;
  if (data.subscription === null) return true;
  const subscription = data.subscription;
  return !!subscription && ['approval_pending', 'active', 'suspended', 'cancelled', 'expired', 'needs_review'].includes(subscription.status) &&
    [3, 6, 12].includes(subscription.months) && Number.isFinite(subscription.amount) && subscription.amount > 0 && subscription.currency === 'USD' &&
    validDate(subscription.starts_at) && validDate(subscription.next_billing_at) &&
    [null, 'fulfilled', 'needs_review'].includes(subscription.last_payment_status) && typeof subscription.cancel_available === 'boolean' && typeof subscription.activation_available === 'boolean' &&
    (!subscription.activation_available || subscription.status === 'approval_pending') && validMessage(subscription.message);
}

export type EnrollmentStatus = {status: 'active' | 'pending' | 'cancelled' | 'needs_review'; message: string; activation_available: boolean};
export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  if (!value || typeof value !== 'object') return false;
  const data = value as EnrollmentStatus;
  return ['active', 'pending', 'cancelled', 'needs_review'].includes(data.status) && typeof data.message === 'string' && typeof data.activation_available === 'boolean' &&
    (!data.activation_available || data.status === 'pending');
}

export function canStartAutoRenew(billing: BillingOptions | null, months: number) {
  return !!(billing?.available && billing.pay_once_available && billing.offers.some(offer => offer.months === months && offer.available));
}

export const billingStatus = {
  approval_pending: 'Awaiting PayPal approval', active: 'Auto-renew is on', suspended: 'Automatic billing is paused',
  cancelled: 'Auto-renew is off', expired: 'Auto-renew has ended', needs_review: 'Renewal needs support review',
} satisfies Record<BillingSubscription['status'], string>;

export const money = (amount: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2}).format(amount);
export const billingDate = (value: string) => new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(value));
export function recurringTerms(amount: number, months: number) {return `${money(amount)} every ${months} months until cancelled`;}
