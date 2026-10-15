import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

let runtime;

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {verifyPayPalConnection, paypal} from './lib/paypal.ts';
        import {bunny} from './lib/mybunny.ts';
        export default {async fetch(request) {
          try {
            const path = new URL(request.url).pathname;
            const result = path === '/paypal' ? await verifyPayPalConnection() :
              path === '/paypal-redirect' ? await paypal('/test-redirect') : await bunny(path === '/bunny-redirect' ? '/test-redirect' : '/account');
            return Response.json(result);
          } catch(error) { return Response.json({code:error.code,message:error.message}, {status:error.status || 500}); }
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'payment-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:*']
  });
  runtime = new Miniflare({
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], cf: false,
    workers: [{
      name: 'payment-runtime', modules: true, script: bundle.outputFiles[0].text,
      bindings: {PAYPAL_MODE: 'live', PAYPAL_CLIENT_ID: 'runtime-test-id', PAYPAL_CLIENT_SECRET: 'runtime-test-secret', MYBUNNY_API_KEY: 'runtime-test-provider'},
      outboundService: 'mock-upstream'
    }, {
      name: 'mock-upstream', modules: true,
      script: `
        let followed = 0;
        export default {fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/stats') return Response.json({followed});
          if (url.hostname === 'never-follow.example.test') { followed++; return new Response('Unexpected redirect', {status:400}); }
          if (url.pathname === '/v1/oauth2/token') return Response.json({access_token:'runtime-test-token'});
          if (url.pathname === '/api/v1/account') return Response.json({data:{balance:35}});
          if (url.pathname.endsWith('/test-redirect')) return new Response(null, {status:302,headers:{Location:'https://never-follow.example.test/secrets'}});
          return new Response('Unmocked request', {status:500});
        }};
      `
    }]
  });
});
test.after(async () => { await runtime?.dispose(); });

test('PayPal authentication works inside the Cloudflare runtime', async () => {
  const response = await runtime.dispatchFetch('http://localhost/paypal');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result, {connected: true, mode: 'live'});
});

test('reseller reads work inside the Cloudflare runtime', async () => {
  const response = await runtime.dispatchFetch('http://localhost/bunny');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result, {balance: 35});
});

test('PayPal and reseller redirects are refused without forwarding credentials', async () => {
  const payment = await runtime.dispatchFetch('http://localhost/paypal-redirect');
  const provider = await runtime.dispatchFetch('http://localhost/bunny-redirect');
  assert.equal(payment.status, 502);
  assert.equal((await payment.json()).code, 'paypal_error');
  assert.equal(provider.status, 502);
  const result = await provider.json();
  assert.equal(result.code, 'provider_redirect_rejected', JSON.stringify(result));
  const upstream = await runtime.getWorker('mock-upstream');
  assert.deepEqual(await (await upstream.fetch('https://mock-upstream/stats')).json(), {followed: 0});
});
