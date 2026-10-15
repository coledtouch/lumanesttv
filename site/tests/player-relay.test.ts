import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPlayerRelay, providerRelaySource, relayConfigured} from '../lib/player-relay.ts';

const endpoint = 'https://streams.lumanest.tv/relay';
const key = 'abcdef0123456789'.repeat(4);
const privateSource = 'http://136.148.65.1/live/private-user/private-password/42?token=private-token';

test('the relay source allowlist accepts only its bounded public provider addresses', () => {
  for (const host of ['136.148.65.1', '136.148.65.42', '136.148.65.254', '38.190.178.54']) {
    const value = `http://${host}/live/private-user/private-password/42?token=private-token`;
    assert.equal(providerRelaySource(value)?.href, value);
  }
  for (const value of [
    'not a URL', '', '/relative-stream', 'http://136.148.65.1/' + 'x'.repeat(8192),
    'http://136.148.65.0/stream', 'http://136.148.65.255/stream', 'http://136.148.65.256/stream',
    'http://136.148.64.1/stream', 'http://136.148.66.1/stream', 'http://38.190.178.53/stream',
    'http://127.0.0.1/stream', 'http://10.0.0.1/stream', 'http://172.16.0.1/stream',
    'http://192.168.1.1/stream', 'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/stream',
    'http://[::1]/stream', 'http://localhost/stream', 'http://media.lumanest.tv/stream',
    'http://136.148.65.1.attacker.invalid/stream', 'http://attacker.invalid/136.148.65.1/stream',
    'https://136.148.65.1/stream', 'ftp://136.148.65.1/stream', 'file://136.148.65.1/stream',
    'http://private-user@136.148.65.1/stream', 'http://private-user:private-password@136.148.65.1/stream',
    'http://136.148.65.1:8080/stream', 'http://38.190.178.54:443/stream',
    'http://136.148.65.1/stream#private-fragment',
  ]) assert.equal(providerRelaySource(value), null, value);
});

test('relay configuration requires the exact first-party HTTPS endpoint and a full lowercase signing key', () => {
  assert.equal(relayConfigured(endpoint, key), true);
  for (const value of [undefined, '', 'https://streams.lumanest.tv', endpoint + '/', endpoint + '?url=http://127.0.0.1', endpoint + '#private', 'http://streams.lumanest.tv/relay', 'https://streams.lumanest.tv:8443/relay', 'https://private-user@streams.lumanest.tv/relay', 'https://streams.lumanest.tv.attacker.invalid/relay']) {
    assert.equal(relayConfigured(value, key), false, String(value));
  }
  for (const value of [undefined, '', key.slice(1), key + 'a', key.toUpperCase(), 'g'.repeat(64), ' '.repeat(64), key + '\n']) {
    assert.equal(relayConfigured(endpoint, value), false, String(value));
  }
});

test('private upstream credentials travel only in the authenticated server POST body', async () => {
  const controller = new AbortController();
  const upstream = new Response(new Uint8Array([1, 2, 3]), {status:206, headers:{'Content-Type':'video/mp2t'}});
  let requests = 0;
  const result = await fetchPlayerRelay(new URL(privateSource), endpoint, key, {
    method:'GET', headers:{Range:'bytes=120-240', Cookie:'private-customer-cookie', Authorization:'private-customer-authorization', 'User-Agent':'private-customer-agent', 'X-Untrusted':'private-untrusted-header'},
    signal:controller.signal, redirect:'follow', cache:'force-cache', credentials:'include', referrer:'https://private-browser.invalid/customer', body:'private-untrusted-body',
  }, async (url, options) => {
    requests++;
    assert.equal(url, endpoint);
    assert.equal(options?.method, 'POST');
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.redirect, 'manual');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.credentials, undefined);
    assert.equal(options?.referrer, undefined);
    const headers = new Headers(options?.headers);
    assert.deepEqual([...headers.entries()], [['authorization', 'Bearer ' + key], ['content-type', 'application/json']]);
    assert.deepEqual(JSON.parse(String(options?.body)), {url:privateSource, range:'bytes=120-240'});
    const publicParts = JSON.stringify({url, headers:[...headers.entries()]});
    for (const secret of ['private-user','private-password','private-token','private-customer','private-untrusted','private-browser']) assert.ok(!publicParts.includes(secret));
    return upstream;
  });
  assert.equal(requests, 1);
  assert.equal(result, upstream);
  assert.equal(await result.text(), '\u0001\u0002\u0003');
});

test('source query parameters cannot select a relay destination or inject request headers', async () => {
  const value = privateSource + '&url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data') + '&endpoint=' + encodeURIComponent('https://attacker.invalid/relay') + '&Authorization=attacker&range=bytes%3D999-';
  assert.equal(providerRelaySource(value)?.hostname, '136.148.65.1');
  await fetchPlayerRelay(new URL(value), endpoint, key, {}, async (url, options) => {
    assert.equal(url, endpoint);
    assert.deepEqual(JSON.parse(String(options?.body)), {url:value});
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + key);
    assert.equal(new Headers(options?.headers).get('Range'), null);
    return new Response();
  });
});

test('untrusted sources, configuration and byte ranges fail before any outbound request', async () => {
  let requests = 0;
  const send: typeof fetch = async () => {requests++; return new Response();};
  const invalidCases: [string, string, string, Record<string,string>][] = [
    ['http://127.0.0.1/private-user/private-password', endpoint, key, {}],
    ['https://136.148.65.1/private-user/private-password', endpoint, key, {}],
    [privateSource, endpoint + '?private-user=private-password', key, {}],
    [privateSource, endpoint, 'private-key', {}],
    ...['bytes=-0','bytes=-','bytes=1-2,4-5','items=0-1','bytes=NaN-','bytes=240-120','bytes=9007199254740992-','bytes=0-9007199254740992','bytes=-9007199254740992'].map((range): [string,string,string,Record<string,string>] => [privateSource, endpoint, key, {Range:range}]),
  ];
  for (const [source, relay, secret, headers] of invalidCases) {
    await assert.rejects(fetchPlayerRelay(new URL(source), relay, secret, {headers}, send), error => {
      assert.ok(error instanceof Error);
      for (const secret of ['private-user','private-password','private-key','127.0.0.1','136.148.65.1','secret']) assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  assert.equal(requests, 0);
});

test('valid open-ended and suffix ranges and caller abort signals are passed to the private relay', async () => {
  const controller = new AbortController();
  controller.abort();
  for (const range of ['bytes=0-', 'bytes=123456789-', 'bytes=-500']) {
    await fetchPlayerRelay(new URL(privateSource), endpoint, key, {headers:new Headers({Range:range}),signal:controller.signal}, async (_url, options) => {
      assert.equal(options?.signal?.aborted, true);
      assert.deepEqual(JSON.parse(String(options?.body)), {url:privateSource,range});
      return new Response();
    });
  }
});

test('relay redirects are canceled and rejected without a second request or private error disclosure', async () => {
  for (const status of [300,301,302,303,304,307,308,399]) {
    let requests = 0, canceled = 0;
    const response = new Response(status === 304 ? null : new ReadableStream({cancel(){canceled++;}}), {status,headers:{Location:'https://private-user:private-password@attacker.invalid/private-path?token=private-token'}});
    await assert.rejects(fetchPlayerRelay(new URL(privateSource),endpoint,key,{},async(url,options)=>{
      requests++;
      assert.equal(url,endpoint);assert.equal(options?.redirect,'manual');
      return response;
    }),error=>{
      assert.ok(error instanceof Error);
      for(const secret of ['private-user','private-password','private-path','private-token','attacker.invalid',key])assert.ok(!error.message.includes(secret));
      return true;
    });
    assert.equal(requests,1);assert.equal(canceled,status===304?0:1);
  }
});

test('an unexpectedly followed relay response is rejected and its body is canceled', async () => {
  let canceled = 0;
  const response = new Response(new ReadableStream({cancel(){canceled++;}}));
  Object.defineProperty(response,'redirected',{value:true});
  await assert.rejects(fetchPlayerRelay(new URL(privateSource),endpoint,key,{},async()=>response),/unexpected redirect/);
  assert.equal(canceled,1);
});
