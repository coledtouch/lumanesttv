import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The rules for one `@media(max-width:…px)` block of browse.css, keyed by selector.
async function mediaRules(maxWidth: number): Promise<Map<string, string>> {
  const css = await readFile(new URL('../app/watch/browse.css', import.meta.url), 'utf8');
  const start = css.indexOf(`@media(max-width:${maxWidth}px){`);
  assert.ok(start >= 0, `browse.css has a max-width:${maxWidth}px block`);
  let depth = 0, end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {end = i; break;}
  }
  const body = css.slice(css.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, rules]) => [selector.trim(), rules]));
}

test('on phones each bottom tab fills its column, so its icon and label sit in the middle of it', async () => {
  // The tablet strip (max-width:999px, which phones also match) sizes tabs to their label with width:auto; the phone
  // tab bar must undo that, or every tab hugs the left edge of its column (Home ended up against the screen edge).
  assert.match((await mediaRules(999)).get('.watch-rail button') ?? '', /(?:^|;)width:auto(?:;|$)/);
  const phone = await mediaRules(599);
  assert.match(phone.get('.watch-rail ul') ?? '', /grid-auto-columns:1fr/);
  assert.match(phone.get('.watch-rail button') ?? '', /(?:^|;)width:100%(?:;|$)/, 'the phone tab bar sets the tabs back to width:100%');
});
