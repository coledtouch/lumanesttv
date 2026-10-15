type StoredOrder = {id: string; paypal_id: string; amount: string};

export function verifiedOrder(order: StoredOrder, payment: any) {
  const units = payment?.purchase_units;
  if (payment?.id !== order.paypal_id || !Array.isArray(units) || units.length !== 1 || units[0]?.custom_id !== order.id) {
    throw new Error('Payment is not yet verified.');
  }
  if (units[0].amount?.currency_code !== 'USD' || units[0].amount?.value !== order.amount) {
    throw new Error('Payment amount requires review before capture.');
  }
  return units[0];
}

export function verifiedCapture(order: StoredOrder, payment: any): string {
  const unit = verifiedOrder(order, payment), captures = unit.payments?.captures;
  if (payment.status !== 'COMPLETED' || !Array.isArray(captures) || captures.length !== 1 || captures[0]?.status !== 'COMPLETED' || captures[0].amount?.currency_code !== 'USD' || captures[0].amount?.value !== order.amount || typeof captures[0].id !== 'string' || !captures[0].id.trim()) {
    throw new Error('Payment amount requires review before activation.');
  }
  return captures[0].id;
}

export function liveFulfillment(mode: string | undefined) { return mode === 'live'; }
