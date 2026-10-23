import type { AppVersions } from './config.js';

// All text the app posts. Kept free of Reddit calls so it can be unit tested.

const SETUP_LINKS = [
  '- **Download and set up your TV:** [lumanest.tv/apps](https://lumanest.tv/apps)',
  '- **Sign in with your phone:** [lumanest.tv/pair](https://lumanest.tv/pair)',
  '- **Help and common fixes:** [tunertv.app/support](https://tunertv.app/support)',
  '- **Account and line login questions:** email [support@tunertv.app](mailto:support@tunertv.app)',
].join('\n');

const PRIVACY_NOTE =
  'Please never post your line login, password, MAC address or playlist link here. Support can help with those privately.';

const FOOTER =
  '^(I am a bot for r/TunerTVapp. Type) ^`!version` ^(in any comment to see the latest app versions.)';

export function renderVersions(versions: AppVersions): string {
  return [
    '| TV | Latest Tuner version |',
    '| --- | --- |',
    `| Android TV, Google TV, Fire TV | ${versions.android} |`,
    `| LG (webOS) | ${versions.lg} |`,
    `| Samsung (Tizen) | ${versions.samsung} |`,
    `| Roku | ${versions.roku} |`,
    `| Apple TV | ${versions.appleTv} |`,
  ].join('\n');
}

export type PostReplyParts = { help: boolean; flairReminder: boolean };

/** The single comment the app leaves on a new post, or undefined when neither part applies. */
export function renderPostReply(
  parts: PostReplyParts,
  versions: AppVersions
): string | undefined {
  if (!parts.help && !parts.flairReminder) return undefined;

  const sections: string[] = [];
  if (parts.help) {
    sections.push(
      'Thanks for posting! These links fix most problems:',
      SETUP_LINKS,
      'Make sure your TV has the latest version:',
      renderVersions(versions),
      'If you still need help, tell us your TV model, the Tuner version (Settings > About Tuner) and what happens on screen.'
    );
  }
  if (parts.flairReminder) {
    sections.push(
      '**Please add a flair for your TV** (Android TV, Fire TV, LG, Samsung, Roku or Apple TV), so people who use the same TV can find your post and help.'
    );
  }
  sections.push(PRIVACY_NOTE, FOOTER);
  return sections.join('\n\n');
}

export function renderVersionReply(versions: AppVersions): string {
  return [
    renderVersions(versions),
    'Downloads and setup steps: [lumanest.tv/apps](https://lumanest.tv/apps)',
    FOOTER,
  ].join('\n\n');
}

export function renderRemovalMessage(
  contentType: 'post' | 'comment',
  subredditName: string
): string {
  return [
    `Your ${contentType} in r/${subredditName} was removed because it looked like it contained a playlist link or login details (a username and password, a MAC address, or a stream server address).`,
    'Those let anyone use your line, so they are never allowed in public. You are welcome to post again without them.',
    'For help with your login or playlist, email support@tunertv.app.',
    'If this was a mistake, reply to this message and a moderator will take a look.',
  ].join('\n\n');
}
