import * as workers from 'cloudflare:workers';
import {db} from './paypal.ts';

const HOUR = 60 * 60 * 1000;
// Idempotent housekeeping. Hosting may not offer cron triggers, so this runs from owner actions and,
// at most once per interval per isolate, alongside frequent public requests.
export async function cleanup(now = Date.now()) {
  const run = async (sql: string, ...values: (string | number)[]) => (await db().prepare(sql).bind(...values).run()).meta.changes || 0;
  return {
    owner_sessions: await run('DELETE FROM owner_sessions WHERE expires<=?', now),
    owner_auth_attempts: await run('DELETE FROM owner_auth_attempts WHERE expires<=?', now),
    player_login_attempts: await run('DELETE FROM player_login_attempts WHERE expires<?', now),
    player_revoked_sessions: await run('DELETE FROM player_revoked_sessions WHERE expires<?', now),
    billing_line_locks: await run('DELETE FROM billing_line_locks WHERE expires<?', now),
    paypal_webhook_events: await run('DELETE FROM paypal_webhook_events WHERE received<?', now - 30 * 24 * HOUR),
    // These never received a PayPal id, so no customer could approve or pay them.
    abandoned_orders: await run("UPDATE orders SET state='abandoned',error='checkout_not_created' WHERE state='creating' AND paypal_id IS NULL AND attempted IS NULL AND capture_id IS NULL AND created<?", now - HOUR),
    cancelled_enrollments: await run("UPDATE subscriptions SET state='CANCELLED',line_slot=NULL,error=COALESCE(error,'enrollment_not_created'),updated=? WHERE state='creating' AND paypal_id IS NULL AND created<?", now, now - HOUR),
    // Last, so the steps above still run if migration 0010 is missing. Subtitle download counts (lib/extras-service.ts)
    // of days before yesterday (UTC); the file route deletes them too.
    extras_download_counts: await run('DELETE FROM extras_download_counts WHERE day<?', new Date(now - 24 * HOUR).toISOString().slice(0, 10))
  };
}

let lastRun = 0;
export function cleanupSoon(interval = 15 * 60 * 1000) {
  if (Date.now() - lastRun < interval) return;
  lastRun = Date.now();
  const job = cleanup().catch(() => {console.error('lumanest_cleanup_failed');});
  try {workers.waitUntil?.(job);} catch {}
}
