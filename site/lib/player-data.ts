export type PlaylistChannel = {name: string; group: string; url: string; format: 'hls' | 'mpegts' | 'file'; logo?: string};
export type PlayerSession = {username: string; password: string; exp: number; sid: string};
export type PlayerMedia = {url: string; bind: string; exp: number; root?: 1};

export function normalizeProviderURL(value: string, portal?: string): URL {
  const url = new URL(value);
  if (!portal || url.protocol !== 'http:' || url.username || url.password || url.port) return url;
  const customerPortal = new URL(portal);
  if (customerPortal.protocol === 'https:' && !customerPortal.username && !customerPortal.password &&
    !customerPortal.port && url.hostname === customerPortal.hostname) url.protocol = 'https:';
  return url;
}

export function validSession(value: unknown, now = Date.now()): value is PlayerSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PlayerSession>;
  return typeof item.username === 'string' && item.username.length > 0 && item.username.length <= 100 &&
    typeof item.password === 'string' && item.password.length > 0 && item.password.length <= 150 &&
    typeof item.exp === 'number' && Number.isFinite(item.exp) && item.exp > now && typeof item.sid === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(item.sid);
}

export function validMedia(value: unknown, binding: string, now = Date.now()): value is PlayerMedia {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PlayerMedia>;
  return typeof item.url === 'string' && item.url.length > 0 && item.bind === binding &&
    typeof item.exp === 'number' && Number.isFinite(item.exp) && item.exp > now;
}

export function parseM3U(text: string, portal?: string): PlaylistChannel[] {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('The line login did not return a valid playlist.');
  const result: PlaylistChannel[] = [];
  const seen = new Set<string>();
  let info = '', group = 'Other';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) info = line;
    else if (line.startsWith('#EXTGRP:')) group = line.slice(8).trim();
    else if (line && !line.startsWith('#') && info) {
      let quoted = false, comma = -1;
      for (let i = 0; i < info.length; i++) {
        if (info[i] === '"') quoted = !quoted;
        else if (info[i] === ',' && !quoted) {comma = i; break;}
      }
      const title = comma >= 0 ? info.slice(comma + 1).trim() : '';
      const attribute = (key: string) => info.match(new RegExp('(?:^|\\s)' + key + '="([^"\\r\\n]*)"'))?.[1];
      try {
        const url = normalizeProviderURL(line, portal);
        if (['http:', 'https:'].includes(url.protocol) && !seen.has(url.href)) {
          seen.add(url.href);
          result.push({
            name: (attribute('tvg-name') || title || 'Channel ' + (result.length + 1)).slice(0, 150),
            group: (attribute('group-title') || group || 'Other').slice(0, 100),
            url: url.href,
            format: /\.m3u8$/i.test(url.pathname) ? 'hls' : /\.(mp4|m4v|webm)$/i.test(url.pathname) ? 'file' : 'mpegts',
          });
          const logo = attribute('tvg-logo')?.trim();
          if (logo && logo.length <= 1024) result[result.length - 1].logo = logo;
        }
      } catch {}
      info = ''; group = 'Other';
      if (result.length >= 50000) break;
    }
  }
  if (!result.length) throw new Error('No channels are available for this line. Check that the subscription is active.');
  return result;
}

/** A public host name or IPv4 address: no IP literal in a private or reserved range, no IPv6 literal, no local names. */
export function safeHTTPHost(host: string) {
  if (host.includes(':') || host === 'localhost' || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|example|onion)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  return host.includes('.') && /^[a-z0-9.-]+$/.test(host);
}

export function trustedStreamURL(value: string, hosts: string[], httpHosts: string[] = []): URL {
  const u = new URL(value);
  if (u.username || u.password) throw new Error('This source needs a supported stream address.');
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:') {
    if (u.port || !safeHTTPHost(host) || !httpHosts.some(item => !item.includes('*') && host === item.toLowerCase())) throw new Error('This provider stream address has not been enabled. Please contact support.');
    return u;
  }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) throw new Error('This source needs a supported secure stream address.');
  const allowed = hosts.some(h => h.startsWith('*.') ? host.endsWith(h.slice(1)) && host !== h.slice(2) : host === h);
  if (!allowed) throw new Error('This provider stream host has not been enabled. Please contact support.');
  return u;
}

export function mapProviderOrigin(value: string, rawMap: string | undefined, hosts: string[], httpHosts: string[], aliasZone: string): URL {
  const source = trustedStreamURL(value, hosts, httpHosts);
  if (!rawMap) return source;
  const mappings: unknown = JSON.parse(rawMap);
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || Object.keys(mappings).length > 8) throw new Error('Invalid stream origin configuration.');
  const target = (mappings as Record<string, unknown>)[source.origin];
  if (target === undefined) return source;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(source.hostname) || !safeHTTPHost(source.hostname) || typeof target !== 'string') throw new Error('Stream origin mappings require an approved public IP origin.');
  const destination = trustedStreamURL(target, hosts, httpHosts);
  if (destination.pathname !== '/' || destination.search || destination.hash ||
    !(destination.hostname === aliasZone || destination.hostname.endsWith('.' + aliasZone))) throw new Error('The stream alias must use an approved hostname in the customer portal zone.');
  source.protocol = destination.protocol;
  source.hostname = destination.hostname;
  source.port = destination.port;
  return source;
}

export async function rewriteHLS(text: string, base: string, replace: (url: string) => Promise<string>) {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      let updated = raw;
      const matches = [...raw.matchAll(/URI="([^"\r\n]+)"/g)];
      for (const m of matches) updated = updated.replace(m[0], 'URI="' + await replace(new URL(m[1], base).href) + '"');
      out.push(updated);
    } else if (line) out.push(await replace(new URL(line, base).href));
    else out.push(raw);
  }
  return out.join('\n');
}

// Xtream live links come as /live/user/pass/id(.ts) or, in "output=ts" playlists, the short /user/pass/id(.ts).
// Both serve raw MPEG-TS; /live/user/pass/id.m3u8 is the same channel as HLS.
function xtreamLive(url: URL) {
  const live = /^\/(?:live\/)?([^/]+)\/([^/]+)\/([^/.]+)(?:\.ts)?$/i.exec(url.pathname);
  return live && !['movie', 'series', 'hls'].includes(live[1].toLowerCase()) ? live : null;
}

/** True for a live channel served as raw MPEG-TS, which only LumaNest's own Cast receiver (public/cast/) can play. */
export function transportStreamSource(value: string) {
  const url = new URL(value);
  return Boolean(xtreamLive(url)) || /\.ts$/i.test(url.pathname);
}

/** Casting receivers play HLS and MP4, not raw MPEG-TS, so a .ts live link asks the provider for its HLS form. */
export function castSource(value: string) {
  const url = new URL(value);
  const live = xtreamLive(url);
  if (live) url.pathname = `/live/${live[1]}/${live[2]}/${live[3]}.m3u8`;
  else if (/\.ts$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\.ts$/i, '.m3u8');
  const kind = /\.m3u8$/i.test(url.pathname) ? 'hls' : /\.(mp4|m4v|mov)$/i.test(url.pathname) ? 'file' : 'hls';
  return {url: url.href, contentType: kind === 'file' ? 'video/mp4' : 'application/x-mpegURL', live: kind === 'hls'};
}

/**
 * Adult categories stay hidden in the web player until the viewer unlocks them with a passcode. A category counts as
 * adult when its name holds XXX, adult(s), 18+/+18 or porn as a word of its own, so "Adult Swim" (a cartoon channel)
 * and names such as "Adultos Mayores" or "XXXL" are not caught.
 */
export function isAdultGroup(name: string) {
  return /(^|[^a-z0-9])(xxx|adults?|18\+|\+18|porn)(?![a-z0-9])/i.test(name.replace(/adult\s*swim/gi, ' '));
}

/** Hex SHA-256 of a salt and a passcode. Only this hash and its salt are kept in the browser, never the digits. */
export async function hashPasscode(passcode: string, salt: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + passcode));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
