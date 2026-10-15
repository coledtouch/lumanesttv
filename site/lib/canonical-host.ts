const CANONICAL_ORIGIN = 'https://lumanest.tv';
const RESERVED_PREFIXES = new Set(['api', '_next', 'signin-with-chatgpt', 'signout-with-chatgpt', 'callback']);

export function canonicalRedirectTarget(request: Pick<Request, 'url' | 'method'>): URL | null {
  // Never forward API requests, request bodies, or hosting-owned authentication.
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  let source: URL;
  try {source = new URL(request.url);} catch {return null;}
  if (source.protocol !== 'https:' && source.protocol !== 'http:') return null;
  const hostname = source.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname.endsWith('.chatgpt.site')) return null;
  let firstSegment: string;
  try {firstSegment = decodeURIComponent(source.pathname).replace(/^\/+/, '').split('/')[0];} catch {return null;}
  if (RESERVED_PREFIXES.has(firstSegment)) return null;

  // Assign components separately so a path beginning // cannot change the host.
  const target = new URL(CANONICAL_ORIGIN);
  target.pathname = source.pathname;
  target.search = source.search;
  return target;
}
