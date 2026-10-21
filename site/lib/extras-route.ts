// What the /api/extras/* routes pass to lib/extras-service.ts in the Worker: its bindings and secrets, waitUntil so
// R2 and edge cache writes finish after the answer, and the location's Cache API (the lookups' edge cache).
import * as workers from 'cloudflare:workers';
import type {CacheLike} from './catalog';
import type {ExtrasDeps, ExtrasEnv} from './extras-service';

/** Shared by every isolate in one Cloudflare location; null where there is none. */
function sharedCache(): CacheLike | null {
  try {return (globalThis as unknown as {caches?: {default?: CacheLike}}).caches?.default || null;}
  catch {return null;}
}

export function extrasDeps(): ExtrasDeps {
  return {
    env: workers.env as unknown as ExtrasEnv,
    waitUntil: typeof workers.waitUntil === 'function' ? promise => workers.waitUntil(promise) : undefined,
    cache: sharedCache(),
  };
}
