// What the /api/extras/* routes pass to lib/extras-service.ts in the Worker: its bindings and secrets, and
// waitUntil so R2 writes finish after the answer.
import * as workers from 'cloudflare:workers';
import type {ExtrasDeps, ExtrasEnv} from './extras-service';

export function extrasDeps(): ExtrasDeps {
  return {
    env: workers.env as unknown as ExtrasEnv,
    waitUntil: typeof workers.waitUntil === 'function' ? promise => workers.waitUntil(promise) : undefined,
  };
}
