import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { handleCommentSubmit, handlePostSubmit } from '../features/triggers.js';

// Router for the trigger endpoints declared in devvit.json.
export const triggers = new Hono();

async function runSafely(
  name: string,
  runner: () => Promise<void>
): Promise<void> {
  try {
    await runner();
  } catch (error) {
    // Answer the trigger either way, so Reddit doesn't retry a post the app already handled.
    console.error(`[tunertv] ${name} failed`, error);
  }
}

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('[tunertv] Installed in r/' + input.subreddit?.name);
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  await runSafely('on-post-submit', () => handlePostSubmit(input));
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  await runSafely('on-comment-submit', () => handleCommentSubmit(input));
  return c.json<TriggerResponse>({}, 200);
});
