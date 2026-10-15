import {settings, ServiceError} from './mybunny';
import {parseM3U, trustedStreamURL, normalizeProviderURL, mapProviderOrigin, rewriteHLS, castSource, validSession, validMedia, type PlayerSession, type PlayerMedia} from './player-data';
import {seal, open, digest} from './player-crypto';
import {relayPlayerStream} from './player-stream-relay';
import {sampleDiagnosticContainer} from './player-diagnostic-container';
import {fetchPlayerRelay, providerRelaySource, relayConfigured} from './player-relay';
import {db} from './paypal';

export const PLAYER_COOKIE = 'lumanest_player';
export const PLAYER_EXPIRED_COOKIE = PLAYER_COOKIE + '=; Path=/api/player; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const hosts = () => settings().PLAYER_ALLOWED_HOSTS?.split(',').map(h => h.trim().toLowerCase()).filter(Boolean) || ['tv.lumanest.tv', 'connect.turbobunny.net', '*.turbobunny.net'];
const httpHosts = () => settings().PLAYER_ALLOWED_HTTP_HOSTS?.split(',').map(h => h.trim().toLowerCase()).filter(Boolean) || [];
const portal = () => settings().CUSTOMER_PORTAL_PRIMARY_URL || settings().CUSTOMER_PORTAL_URL || 'https://tv.lumanest.tv';
const relayEnabled = () => relayConfigured(settings().PLAYER_STREAM_RELAY_URL, settings().PLAYER_STREAM_RELAY_KEY);
function approvedStreamURL(value: string) {
  const relay = relayEnabled() ? providerRelaySource(value, settings().STREAM_RELAY_ALLOWED_HOSTS) : null;
  return trustedStreamURL(value, hosts(), relay ? [...httpHosts(), relay.hostname] : httpHosts());
}
const streamURL = (value: string) => approvedStreamURL(normalizeProviderURL(value, portal()).href);
const relaySources = new WeakMap<Response, string>();
type DiagnosticHop = {origin: string; status: number; contentType: string};
type FetchTrace = {onResponse: (hop: DiagnosticHop) => void; onBlockedOrigin?: (origin: string) => void; normalizePortal?: boolean};
const diagnosticTypes = new Set(['video/mp4', 'video/mp2t', 'video/webm', 'audio/mpeg', 'audio/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/octet-stream', 'application/json', 'text/html', 'text/plain']);
function secret() {
  const key = settings().PLAYER_COOKIE_KEY || '';
  if (!/^[a-f0-9]{64}$/.test(key)) throw new ServiceError(503, 'player_not_configured', 'The webplayer is being configured. Please contact support.');
  return key;
}
export function cookie(req: Request) {
  const match = (req.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(PLAYER_COOKIE + '='));
  return match?.slice(PLAYER_COOKIE.length + 1) || '';
}
export async function session(req: Request) {
  const value = cookie(req);
  if (!value) throw new ServiceError(401, 'player_login_required', 'Sign in with your line login to watch.');
  const key = secret();
  let credentials: unknown;
  try {credentials = await open<unknown>(value, key, 'player-session');} catch {throw new ServiceError(401, 'player_session_expired', 'Your player session expired. Please sign in again.');}
  if (!validSession(credentials)) throw new ServiceError(401, 'player_session_expired', 'Your player session expired. Please sign in again.');
  return {credentials, binding: await digest(value)};
}
// Signed-out sessions are checked when channels are listed, when a stream starts and whenever an HLS playlist
// mints new segment tokens. Segment requests skip D1; a short per-isolate cache bounds playlist refresh reads.
const liveSessions = new Map<string, number>();
export async function assertNotRevoked(credentials: PlayerSession) {
  if ((liveSessions.get(credentials.sid) || 0) > Date.now()) return;
  const revoked = await db().prepare('SELECT id FROM player_revoked_sessions WHERE id=?').bind(credentials.sid).first();
  if (revoked) throw new ServiceError(401, 'player_session_expired', 'You signed out of this player session. Please sign in again.');
  if (liveSessions.size >= 5000) liveSessions.clear();
  liveSessions.set(credentials.sid, Date.now() + 20000);
}
export async function revokeSession(req: Request) {
  const value = cookie(req);
  if (!value || !/^[a-f0-9]{64}$/.test(settings().PLAYER_COOKIE_KEY || '')) return false;
  let credentials: unknown;
  try {credentials = await open<unknown>(value, secret(), 'player-session');} catch {return false;}
  if (!validSession(credentials)) return false;
  liveSessions.delete(credentials.sid);
  await db().prepare('INSERT OR IGNORE INTO player_revoked_sessions (id,expires) VALUES (?,?)').bind(credentials.sid, credentials.exp).run();
  return true;
}
async function limitedText(res: Response, max = 8 * 1024 * 1024) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let count = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    count += value.length;
    if (count > max) {await reader.cancel(); throw new ServiceError(502, 'playlist_too_large', 'The provider playlist is too large for the webplayer.');}
    chunks.push(value);
  }
  const data = new Uint8Array(count);
  let offset = 0;
  for (const part of chunks) {data.set(part, offset); offset += part.length;}
  return new TextDecoder().decode(data);
}
export async function safeFetch(url: string, options: RequestInit = {}, hops = 0, trace?: FetchTrace): Promise<Response> {
  if (hops > 4) throw new ServiceError(502, 'stream_redirects', 'The provider redirected too many times.');
  let source: URL;
  try {source = trace?.normalizePortal === false ? approvedStreamURL(url) : streamURL(url);}
  catch (error) {
    try {
      const rejected = new URL(url);
      if (['http:', 'https:'].includes(rejected.protocol)) trace?.onBlockedOrigin?.(rejected.origin);
    } catch {}
    throw error;
  }
  if (relayEnabled() && providerRelaySource(source.href, settings().STREAM_RELAY_ALLOWED_HOSTS)) {
    const response = await fetchPlayerRelay(source, settings().PLAYER_STREAM_RELAY_URL, settings().PLAYER_STREAM_RELAY_KEY, options, fetch, settings().STREAM_RELAY_ALLOWED_HOSTS);
    relaySources.set(response, source.href);
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    trace?.onResponse({origin: source.origin, status: response.status, contentType: diagnosticTypes.has(type) ? type : 'other'});
    return response;
  }
  const aliasZone = new URL(portal()).hostname.replace(/^tv\./, '');
  let endpoint: URL;
  try {endpoint = mapProviderOrigin(source.href, settings().PLAYER_STREAM_ORIGIN_MAP, hosts(), httpHosts(), aliasZone);}
  catch {throw new ServiceError(503, 'invalid_stream_origin_map', 'The stream connection is being configured. Please contact support.');}
  const res = await fetch(endpoint.href, {...options, redirect: 'manual'});
  const contentType = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  trace?.onResponse({origin: endpoint.origin, status: res.status, contentType: diagnosticTypes.has(contentType) ? contentType : 'other'});
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const target = res.headers.get('Location');
    await res.body?.cancel();
    if (!target) throw new ServiceError(502, 'invalid_redirect', 'The provider returned an invalid stream address.');
    return safeFetch(new URL(target, endpoint.href).href, options, hops + 1, trace);
  }
  return res;
}
export async function playlist(credentials: PlayerSession, requestSignal?: AbortSignal) {
  const endpoint = new URL('/m3u', portal());
  endpoint.searchParams.set('u', credentials.username); endpoint.searchParams.set('p', credentials.password);
  let res: Response;
  try {res = await safeFetch(endpoint.href, {signal: requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), headers: {Accept: 'audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain'}});}
  catch (e) {if (e instanceof ServiceError) throw e; throw new ServiceError(502, 'playlist_unavailable', 'The customer portal could not load your playlist. Please try again.');}
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) throw new ServiceError(401, 'invalid_line_login', 'The line login was not accepted. Check the username, password and subscription status.');
    throw new ServiceError(502, 'playlist_unavailable', 'The customer portal could not load your playlist. Please try again.');
  }
  let text: string;
  try {text = await limitedText(res);}
  catch (e) {if (e instanceof ServiceError) throw e; throw new ServiceError(502, 'playlist_unavailable', 'The customer portal could not finish loading your playlist. Please try again.');}
  try {return parseM3U(text, portal());}
  catch {throw new ServiceError(401, 'invalid_line_login', 'No channels were returned for this line. Check the username, password and subscription status.');}
}
export async function login(username: string, password: string) {
  const key = secret();
  const credentials: PlayerSession = {username, password, exp: Date.now() + 8 * 60 * 60 * 1000, sid: crypto.randomUUID()};
  const channels = await playlist(credentials);
  return {cookie: await seal(credentials, key, 'player-session'), count: channels.length};
}
export async function channelList(req: Request) {
  const {credentials, binding} = await session(req);
  await assertNotRevoked(credentials);
  const entries = await playlist(credentials);
  const key = secret();
  const result = [];
  for (let start = 0; start < entries.length; start += 150) {
    const part = await Promise.all(entries.slice(start, start + 150).map(async entry => {
      let token: string | null = null, reason = '';
      try {const source = streamURL(entry.url); token = await seal({url: source.href, bind: binding, exp: credentials.exp, root: 1} satisfies PlayerMedia, key, 'player-media');}
      catch {reason = 'This channel is unavailable in the webplayer. Try the Tuner app or contact support.';}
      return {id: await digest(entry.url), name: entry.name, group: entry.group, format: entry.format, token, reason};
    }));
    result.push(...part);
  }
  return {channels: result, username: credentials.username, expiresAt: credentials.exp};
}
export async function diagnostics(req: Request) {
  const {credentials} = await session(req);
  const params = new URL(req.url).searchParams;
  const profile = params.get('profile') || 'default';
  if (!['default', 'ua', 'http', 'http-ua'].includes(profile)) throw new ServiceError(400, 'invalid_diagnostic_profile', 'Choose a supported diagnostic profile.');
  const indices = params.getAll('index');
  const explicitIndex = indices.length > 0;
  if (indices.length > 1 || (explicitIndex && (!/^(0|[1-9]\d{0,4})$/.test(indices[0]) || Number(indices[0]) > 49999))) throw new ServiceError(400, 'invalid_diagnostic_index', 'Choose a channel from your playlist.');
  const index = explicitIndex ? Number(indices[0]) : 0;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20000)]);
  const entries = await playlist(credentials, signal);
  if (index >= entries.length) throw new ServiceError(400, 'invalid_diagnostic_index', 'Choose a channel from your playlist.');
  const entry = entries[index];
  const selection = explicitIndex ? {index, format: entry.format} : {};
  const source = new URL(entry.url);
  const originalHTTP = profile === 'http' || profile === 'http-ua';
  const configuredPortal = new URL(portal());
  if (originalHTTP && source.protocol === 'https:' && source.hostname === configuredPortal.hostname && !source.port) source.protocol = 'http:';
  const hops: DiagnosticHop[] = [];
  let blockedOrigin: string | undefined;
  const headers: Record<string, string> = {Accept: '*/*'};
  if (profile === 'ua' || profile === 'http-ua') headers['User-Agent'] = 'LumaNestTV/1.0';
  try {
    const response = await safeFetch(source.href, {headers, signal}, 0, {normalizePortal: !originalHTTP, onResponse: hop => hops.push(hop), ...(explicitIndex ? {onBlockedOrigin: (origin: string) => {blockedOrigin = origin;}} : {})});
    const sample = explicitIndex ? {container: await sampleDiagnosticContainer(response.body, signal)} : {};
    if (!explicitIndex) await response.body?.cancel();
    const ipRejected = hops.some(hop => hop.status === 403 && /^\d+\.\d+\.\d+\.\d+$/.test(new URL(hop.origin).hostname));
    return {profile, ...selection, ...sample, hops, ...(ipRejected ? {hint: 'worker_ip_origin_requires_hostname'} : {})};
  } catch (error) {
    const knownCodes = new Set(['invalid_stream_origin_map', 'stream_redirects', 'invalid_redirect']);
    const errorCode = blockedOrigin ? 'stream_origin_blocked' : error instanceof ServiceError && knownCodes.has(error.code) ? error.code : signal.aborted ? 'stream_request_aborted' : 'stream_fetch_failed';
    return {profile, ...selection, hops, error: 'stream_connection_failed', ...(explicitIndex ? {errorCode, ...(blockedOrigin ? {blockedOrigin} : {})} : {})};
  }
}
export async function media(req: Request) {
  const {binding, credentials} = await session(req);
  const raw = new URL(req.url).searchParams.get('token');
  if (!raw) throw new ServiceError(400, 'missing_stream', 'Choose a channel to watch.');
  const key = secret();
  let item: unknown;
  try {item = await open<unknown>(raw, key, 'player-media');} catch {throw new ServiceError(403, 'stream_forbidden', 'This stream is no longer available. Refresh your channel list.');}
  if (!validMedia(item, binding) || item.exp > credentials.exp) throw new ServiceError(403, 'stream_forbidden', 'This stream belongs to another or expired player session.');
  const expiresAt = item.exp;
  return serveMedia(req, item, () => assertNotRevoked(credentials), async source =>
    '/api/player/stream?token=' + encodeURIComponent(await seal({url: source, bind: binding, exp: expiresAt} satisfies PlayerMedia, key, 'player-media')), {});
}

/** Fetches one approved upstream URL for the web player or a cast device; HLS playlists get re-signed child URLs. */
async function serveMedia(req: Request, item: {url: string; root?: 1}, checkRevoked: () => Promise<void>, sign: (source: string) => Promise<string>, extraHeaders: Record<string, string>) {
  if (item.root === 1) await checkRevoked();
  const url = streamURL(item.url);
  const headers: Record<string, string> = {Accept: '*/*'};
  const range = req.headers.get('Range');
  if (range && /^bytes=\d*-\d*(,\d*-\d*)*$/.test(range)) headers.Range = range;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let upstream: Response;
  try {upstream = await safeFetch(url.href, {headers, signal: AbortSignal.any([req.signal, controller.signal])});}
  catch (e) {if (e instanceof ServiceError) throw e; throw new ServiceError(502, 'stream_unavailable', 'This channel could not be reached. Choose another channel or try again.');}
  finally {clearTimeout(timeout);}
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new ServiceError(upstream.status === 401 || upstream.status === 403 ? 403 : 502, 'stream_unavailable', 'This channel could not be loaded. Check your subscription or choose another channel.');
  }
  const finalURL = streamURL(relaySources.get(upstream) || upstream.url || url.href);
  const type = upstream.headers.get('Content-Type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8$/i.test(finalURL.pathname)) {
    if (item.root !== 1) {
      try {await checkRevoked();} catch (error) {await upstream.body?.cancel(); throw error;}
    }
    const text = await limitedText(upstream, 2 * 1024 * 1024);
    if (!text.trimStart().startsWith('#EXTM3U')) throw new ServiceError(502, 'invalid_media', 'The provider returned an invalid media playlist.');
    const output = await rewriteHLS(text, finalURL.href, next => sign(streamURL(next).href));
    return new Response(output, {headers: {'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extraHeaders}});
  }
  // Only media types are served from this origin; anything else (for example upstream HTML) becomes inert bytes.
  const mediaType = /^(?:video|audio)\/[a-z0-9.+-]+$|^application\/(?:vnd\.apple\.mpegurl|x-mpegurl|mp4|octet-stream)$/i.test(type.split(';')[0].trim()) ? type : type ? 'application/octet-stream' : 'video/mp2t';
  const responseHeaders: Record<string, string> = {'Content-Type': mediaType, 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extraHeaders};
  for (const name of ['Content-Range', 'Accept-Ranges']) {const value = upstream.headers.get(name); if (value) responseHeaders[name] = value;}
  return new Response(relayPlayerStream(upstream.body, controller), {status: upstream.status, headers: responseHeaders});
}

// ---------------------------------------------------------------- casting
// A Chromecast or AirPlay receiver fetches media itself, without this browser's session cookie. A cast link is a
// short-lived, cookie-free token for one channel, tied to the player session's id so signing out stops it.
export const CAST_TTL_MS = 4 * 60 * 60 * 1000;
export const castHeaders = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'};
type CastMedia = {url: string; sid: string; exp: number; root?: 1};
function validCast(value: unknown, now = Date.now()): value is CastMedia {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CastMedia>;
  return typeof item.url === 'string' && item.url.length > 0 && typeof item.sid === 'string' && item.sid.length > 0 &&
    typeof item.exp === 'number' && Number.isFinite(item.exp) && item.exp > now && (item.root === undefined || item.root === 1);
}
export async function createCast(req: Request, body: unknown) {
  const {binding, credentials} = await session(req);
  await assertNotRevoked(credentials);
  const raw = body && typeof body === 'object' && typeof (body as {token?: unknown}).token === 'string' ? (body as {token: string}).token : '';
  if (!raw || raw.length > 6000) throw new ServiceError(400, 'missing_stream', 'Choose a channel to cast.');
  const key = secret();
  let item: unknown;
  try {item = await open<unknown>(raw, key, 'player-media');} catch {throw new ServiceError(403, 'stream_forbidden', 'This stream is no longer available. Refresh your channel list.');}
  if (!validMedia(item, binding) || item.root !== 1) throw new ServiceError(403, 'stream_forbidden', 'This stream belongs to another or expired player session.');
  const source = castSource(streamURL(item.url).href);
  const exp = Math.min(credentials.exp, Date.now() + CAST_TTL_MS);
  const token = await seal({url: source.url, sid: credentials.sid, exp, root: 1} satisfies CastMedia, key, 'player-cast');
  return {url: new URL('/api/cast/stream?t=' + encodeURIComponent(token), req.url).href, contentType: source.contentType, live: source.live, expiresAt: exp};
}
export async function castMedia(req: Request) {
  const raw = new URL(req.url).searchParams.get('t');
  if (!raw) throw new ServiceError(400, 'missing_stream', 'This cast link is incomplete.');
  const key = secret();
  let item: unknown;
  try {item = await open<unknown>(raw, key, 'player-cast');} catch {throw new ServiceError(403, 'stream_forbidden', 'This cast link is no longer valid. Cast the channel again.');}
  if (!validCast(item)) throw new ServiceError(403, 'stream_forbidden', 'This cast link expired. Cast the channel again.');
  const cast = item;
  const checkRevoked = async () => {
    const revoked = await db().prepare('SELECT id FROM player_revoked_sessions WHERE id=?').bind(cast.sid).first();
    if (revoked) throw new ServiceError(401, 'player_session_expired', 'You signed out of the web player, so casting stopped.');
  };
  return serveMedia(req, cast, checkRevoked, async source =>
    '/api/cast/stream?t=' + encodeURIComponent(await seal({url: source, sid: cast.sid, exp: cast.exp} satisfies CastMedia, key, 'player-cast')), castHeaders);
}
// Device pairing (lib/pairing.ts) hands a TV app the same line login this web player session proved.
export const playerSecret = () => secret();
export function tvAccount(credentials: PlayerSession) {
  // Accept "tv.lumanest.tv" as well as "https://tv.lumanest.tv"; a bare host means HTTPS.
  let xtream = (settings().TV_APP_XTREAM_SERVER || '').trim().replace(/\/+$/, '');
  if (xtream && !/^[a-z][a-z0-9+.-]*:/i.test(xtream)) xtream = 'https://' + xtream;
  if (/^https?:\/\/[^\s/?#]+$/i.test(xtream)) return {type: 'xtream' as const, name: 'LumaNest TV', server: xtream, username: credentials.username, password: credentials.password};
  const playlist = new URL('/m3u', portal());
  playlist.searchParams.set('u', credentials.username); playlist.searchParams.set('p', credentials.password);
  return {type: 'm3u' as const, name: 'LumaNest TV', m3uUrl: playlist.href};
}
