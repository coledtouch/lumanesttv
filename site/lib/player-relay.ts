import {allowedHosts, hostAllowed} from '../cloudflare/lumanest-stream-relay.mjs';
const RELAY_ORIGIN = 'https://streams.lumanest.tv';

// Shares the relay Worker's parser so both sides accept exactly the same provider hosts.
export function providerRelaySource(value: string, allowed?: string): URL | null {
  if (value.length > 8192) return null;
  let url: URL;
  try {url = new URL(value);} catch {return null;}
  if (url.protocol !== 'http:' || url.port || url.username || url.password || url.hash) return null;
  return hostAllowed(url.hostname, allowedHosts(allowed)) ? url : null;
}

export function relayConfigured(endpoint: string | undefined, key: string | undefined) {
  return endpoint === RELAY_ORIGIN + '/relay' && /^[a-f0-9]{64}$/.test(key || '');
}

// Only authenticated, sealed playlist addresses reach this first-party bridge.
export async function fetchPlayerRelay(source: URL, endpoint: string, key: string, options: RequestInit = {}, send: typeof fetch = fetch, allowed?: string) {
  if (!relayConfigured(endpoint, key) || !providerRelaySource(source.href, allowed)) throw new Error('The stream connection is unavailable.');
  const range = new Headers(options.headers).get('Range');
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    const from = parts?.[1] ? Number(parts[1]) : null;
    const to = parts?.[2] ? Number(parts[2]) : null;
    if (!parts || (from === null && to === null) ||
      (from !== null && (!Number.isSafeInteger(from) || from < 0)) ||
      (to !== null && (!Number.isSafeInteger(to) || to < (from ?? 1)))) throw new Error('The stream byte range is unavailable.');
  }
  const response = await send(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
    body: JSON.stringify({url: source.href, ...(range ? {range} : {})}),
    signal: options.signal, redirect: 'manual', cache: 'no-store',
  });
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel();
    throw new Error('The stream connection returned an unexpected redirect.');
  }
  return response;
}
