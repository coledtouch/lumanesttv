import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const runtime = globalThis as unknown as {__paypalDiagnosticsEnv: Record<string, string>};
runtime.__paypalDiagnosticsEnv = {PAYPAL_MODE: 'live', PAYPAL_CLIENT_ID: 'private-client', PAYPAL_CLIENT_SECRET: 'private-secret'};
const hooks = registerHooks({resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env=globalThis.__paypalDiagnosticsEnv;', shortCircuit: true};
  return next(specifier, context);
}});
const {paypal} = await import('../lib/paypal.ts');
hooks.deregister();
test('PayPal error diagnostics preserve bounded operator codes without customer data or endpoint query', async () => {
  const originalFetch = globalThis.fetch, originalError = console.error, logs: unknown[][] = [];
  console.error = (...values) => {logs.push(values);};
  globalThis.fetch = async input => String(input).endsWith('/v1/oauth2/token') ? Response.json({access_token: 'private-token'}) : Response.json({name: 'INVALID_REQUEST', debug_id: 'debug123ABC', message: 'private-person@example.test private-customer-name', details: [{issue: 'INVALID_PARAMETER_VALUE', field: 'payer_email', value: 'private-person@example.test', description: 'private-customer-name private-secret'}], subscriber: {email_address: 'private-person@example.test'}}, {status: 400});
  try {
    await assert.rejects(paypal('/v1/billing/subscriptions/I-PRIVATEID/transactions?start_time=private-query'), {code: 'paypal_error', message: 'PayPal could not complete this request. No activation has been confirmed.'});
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'lumanest_paypal_request_failed');
    const serialized = JSON.stringify(logs);
    for (const secret of ['private-person', 'private-customer', 'private-secret', 'private-client', 'private-token', 'I-PRIVATEID', 'start_time', 'private-query', 'payer_email', 'subscriber']) assert.equal(serialized.includes(secret), false, secret);
    assert.deepEqual(JSON.parse(logs[0][1] as string), {operation: 'subscription_transactions', method: 'GET', http_status: 400, name: 'INVALID_REQUEST', issues: ['INVALID_PARAMETER_VALUE'], debug_id: 'debug123ABC'});
  } finally {globalThis.fetch = originalFetch; console.error = originalError;}
});
