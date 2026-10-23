import { reddit, redis } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';

// Trigger payload IDs may arrive with or without their fullname prefix; reddit.get*ById needs the prefix.
export function asT1(id: string): T1 {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as T1;
}

export function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}

/** True for the subreddit's moderators and for the app's own account, whose posts the app never acts on. */
export async function isExempt(
  authorName: string | undefined,
  subredditName: string | undefined
): Promise<boolean> {
  if (!authorName || authorName === '[deleted]' || !subredditName) return true;

  const appUser = await reddit.getAppUser();
  if (appUser && appUser.username.toLowerCase() === authorName.toLowerCase()) {
    return true;
  }

  const user = await reddit.getUserByUsername(authorName);
  if (!user) return false;
  const modPermissions =
    await user.getModPermissionsForSubreddit(subredditName);
  return modPermissions.length > 0;
}

/**
 * Claims a one-time action (for example "reply to this post") so a retried trigger doesn't do it twice.
 * Returns false when another run already claimed it. Claims expire after 30 days.
 */
export async function claimOnce(key: string): Promise<boolean> {
  const expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const result = await redis.set(key, '1', { nx: true, expiration });
  return Boolean(result);
}
