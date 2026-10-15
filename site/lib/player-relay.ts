const RELAY_ORIGIN = 'https://streams.lumanest.tv';

export function providerRelaySource(value: string): URL | null {
  if (value.length > 8192) return null;
  let url: URL;
  try {url = new URL(value);} catch {return null;}
  if (url.protocol !== 'http:' || url.port || url.username || url.password || url.hash) return null;
  const host = url.hostname;
  const match = /^136\.148\.65\.(\d{1,3})$/.exec(host);
  if (host !== '38.190.178.54' && (!match || Number(match[1]) < 1 || Number(match[1]) > 254)) return null;
  return url;
}

export function relayConfigured(endpoint: string | undefined, key: string | undefined) {
  return endpoint === RELAY_ORIGIN + '/relay' && /^[a-f0-9]{64}$/.test(key || '');
}

// Only authenticated, sealed playlist addresses reach this first-party bridge.
export async function fetchPlayerRelay(source: URL, endpoint: string, key: string, options: RequestInit = {}, send: typeof fetch = fetch) {
  if (!relayConfigured(endpoint, key) || !providerRelaySource(source.href)) throw new Error('The stream connection is unavailable.');
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
