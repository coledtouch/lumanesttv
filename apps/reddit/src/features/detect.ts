// Pure text checks used by the triggers. No Reddit calls here, so they can be unit tested.

export type PrivateInfoKind =
  'playlist-link' | 'stream-url' | 'login' | 'mac-address';

// Each pattern is linear: no nested quantifiers, so a long post can't stall the check.
const PLAYLIST_LINK =
  /https?:\/\/\S+?\.m3u8?(?:[?#]\S*)?(?=$|[\s)\]>"'])|\b(?:get|player_api|panel_api|xmltv)\.php\?\S*(?:username|password)=/i;
// Xtream-style stream addresses carry the line's username and password in the path: /live/USER/PASS/123.ts
const STREAM_URL =
  /https?:\/\/[^\s/]+\/(?:live|movie|series|timeshift)\/[^\s/]+\/[^\s/]+\/\d+(?:\.\w{1,5})?\b/i;
const USERNAME_FIELD = /\b(?:user(?:name)?|login|u)\s*[:=]\s*\S{3,}/i;
const PASSWORD_FIELD = /\b(?:pass(?:word)?|pwd|pw|p)\s*[:=]\s*\S{3,}/i;
const MAC_ADDRESS = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;

/** The first kind of private information found in the text, or undefined when there is none. */
export function findPrivateInfo(text: string): PrivateInfoKind | undefined {
  if (!text) return undefined;
  if (PLAYLIST_LINK.test(text)) return 'playlist-link';
  if (STREAM_URL.test(text)) return 'stream-url';
  // A username alone ("my user: bob") or a password field alone is too common to act on; both together is a login.
  if (USERNAME_FIELD.test(text) && PASSWORD_FIELD.test(text)) return 'login';
  if (MAC_ADDRESS.test(text)) return 'mac-address';
  return undefined;
}

/** Whether a new post asks for help: a help flair, or a help keyword in the title or text. */
export function isHelpPost(
  post: { title: string; selftext: string; flair: string | undefined },
  helpFlairs: readonly string[],
  helpKeywords: readonly string[]
): boolean {
  const flair = post.flair?.trim().toLowerCase();
  if (flair && helpFlairs.includes(flair)) return true;

  const text = `${post.title}\n${post.selftext}`.toLowerCase();
  return helpKeywords.some((keyword) => containsWord(text, keyword));
}

// Keywords match whole words, so "error" doesn't match "terrorism" and "install" doesn't match "installment".
function containsWord(text: string, keyword: string): boolean {
  let from = 0;
  for (;;) {
    const index = text.indexOf(keyword, from);
    if (index < 0) return false;
    const before = index === 0 ? '' : text.charAt(index - 1);
    const after = text.charAt(index + keyword.length);
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = index + 1;
  }
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

/** Whether a comment is the !version command: the comment starts with !version or !versions. */
export function isVersionCommand(body: string): boolean {
  return /^\s*!versions?(?:\s|$)/i.test(body);
}
