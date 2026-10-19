import * as workers from 'cloudflare:workers';
import {cacheStore, createCatalog, NO_ROWS_BODY, type CacheLike, type CatalogAnswer} from '../../../../lib/catalog';

// Popularity rows for the Tuner apps' Movies & Series browsing (docs/browse.md). Public: no login, no cookies,
// any origin (the TV apps are not pages on this site). Without TMDB_API_KEY it answers source "none" (HTTP 200);
// when TMDB fails and there is no copy yet it answers 503.
const catalog = createCatalog();
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400'};

function sharedCache(): CacheLike | null {
  try {return (globalThis as unknown as {caches?: {default?: CacheLike}}).caches?.default || null;}
  catch {return null;}
}

export function OPTIONS() {return new Response(null, {status: 204, headers: cors});}

export async function GET(req: Request) {
  const url = new URL(req.url), version = url.searchParams.get('v');
  if (version !== null && version !== '1') {
    return Response.json({error: {code: 'unsupported_version', message: 'This catalog version is not available.'}}, {status: 400, headers: {...cors, 'Cache-Control': 'no-store'}});
  }
  let answer: CatalogAnswer;
  try {
    const cache = sharedCache();
    answer = await catalog.rows({
      key: workers.env.TMDB_API_KEY,
      store: cache ? cacheStore(cache, url.origin) : null,
      waitUntil: promise => workers.waitUntil?.(promise),
    });
  } catch {
    console.error('lumanest_catalog_rows_failed');
    answer = {body: NO_ROWS_BODY, source: 'none', failed: true};
  }
  // TMDB failed and there is no copy to serve: a failed request (503, not stored anywhere), so the apps keep the
  // copy they have instead of replacing it with "none" for 12 hours. Only the deliberate no-key answer is a 200.
  return new Response(answer.body, {status: answer.failed ? 503 : 200, headers: {
    ...cors,
    'Content-Type': 'application/json',
    ...(answer.failed ? {'Cache-Control': 'no-store', 'Retry-After': '300'} : {'Cache-Control': 'public, max-age=3600'}),
    'X-Content-Type-Options': 'nosniff',
  }});
}

export async function HEAD(req: Request) {
  const response = await GET(req);
  await response.body?.cancel();
  return new Response(null, {status: response.status, headers: response.headers});
}
