import { reddit } from '@devvit/web/server';
import type {
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
} from '@devvit/web/shared';
import { asT1, asT3, claimOnce, isExempt } from '../lib/reddit.js';
import { getConfig } from './config.js';
import { findPrivateInfo, isHelpPost, isVersionCommand } from './detect.js';
import {
  renderPostReply,
  renderRemovalMessage,
  renderVersionReply,
} from './messages.js';

async function sendRemovalModmail(
  subredditName: string,
  authorName: string,
  contentType: 'post' | 'comment'
): Promise<void> {
  await reddit.modMail.createConversation({
    subredditName,
    subject: `Your ${contentType} was removed in r/${subredditName}`,
    body: renderRemovalMessage(contentType, subredditName),
    to: `u/${authorName}`,
    isAuthorHidden: true,
  });
}

export async function handlePostSubmit(
  input: OnPostSubmitRequest
): Promise<void> {
  const postId = input.post?.id;
  const subredditName = input.subreddit?.name;
  const authorName = input.author?.name;
  if (!postId || !subredditName || !authorName) return;
  if (await isExempt(authorName, subredditName)) return;

  const config = await getConfig();
  const title = input.post?.title ?? '';
  const selftext = input.post?.selftext ?? '';

  // Private information first: a removed post gets no help reply.
  if (
    config.privateInfoFilterEnabled &&
    findPrivateInfo(`${title}\n${selftext}\n${input.post?.url ?? ''}`)
  ) {
    if (!(await claimOnce(`removed:${postId}`))) return;
    const post = await reddit.getPostById(asT3(postId));
    if (!post.removed) await post.remove();
    await sendRemovalModmail(subredditName, authorName, 'post');
    return;
  }

  const flair = input.post?.linkFlair?.text || undefined;
  const body = renderPostReply(
    {
      help:
        config.helpReplyEnabled &&
        isHelpPost(
          { title, selftext, flair },
          config.helpFlairs,
          config.helpKeywords
        ),
      flairReminder: config.flairReminderEnabled && !flair,
    },
    config.versions
  );
  if (!body) return;
  if (!(await claimOnce(`replied:${postId}`))) return;

  const post = await reddit.getPostById(asT3(postId));
  const comment = await post.addComment({ text: body, runAs: 'APP' });
  try {
    // Pin the reply to the top of the post. This needs the app to be a moderator, which installing it does.
    await comment.distinguish(true);
  } catch (error) {
    console.warn('[tunertv] Could not pin the reply', error);
  }
}

export async function handleCommentSubmit(
  input: OnCommentSubmitRequest
): Promise<void> {
  const commentId = input.comment?.id;
  const body = input.comment?.body ?? '';
  const subredditName = input.subreddit?.name;
  const authorName = input.author?.name;
  if (!commentId || !subredditName || !authorName) return;
  if (await isExempt(authorName, subredditName)) return;

  const config = await getConfig();

  if (config.privateInfoFilterEnabled && findPrivateInfo(body)) {
    if (!(await claimOnce(`removed:${commentId}`))) return;
    const comment = await reddit.getCommentById(asT1(commentId));
    if (!comment.removed) await comment.remove();
    await sendRemovalModmail(subredditName, authorName, 'comment');
    return;
  }

  if (config.versionCommandEnabled && isVersionCommand(body)) {
    if (!(await claimOnce(`version:${commentId}`))) return;
    const comment = await reddit.getCommentById(asT1(commentId));
    await comment.reply({
      text: renderVersionReply(config.versions),
      runAs: 'APP',
    });
  }
}
