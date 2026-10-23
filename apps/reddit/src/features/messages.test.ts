import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VERSIONS, parseList } from './config.js';
import {
  renderPostReply,
  renderRemovalMessage,
  renderVersionReply,
} from './messages.js';

void test('no reply when neither part applies', () => {
  assert.equal(
    renderPostReply({ help: false, flairReminder: false }, DEFAULT_VERSIONS),
    undefined
  );
});

void test('help reply has setup links and every TV version', () => {
  const body =
    renderPostReply({ help: true, flairReminder: false }, DEFAULT_VERSIONS) ??
    '';
  assert.match(body, /lumanest\.tv\/apps/);
  assert.match(body, /tunertv\.app\/support/);
  assert.match(body, /support@tunertv\.app/);
  for (const version of Object.values(DEFAULT_VERSIONS))
    assert.ok(body.includes(version), version);
  assert.doesNotMatch(body, /add a flair/);
});

void test('flair reminder alone skips the help links', () => {
  const body =
    renderPostReply({ help: false, flairReminder: true }, DEFAULT_VERSIONS) ??
    '';
  assert.match(body, /add a flair for your TV/);
  assert.doesNotMatch(body, /lumanest\.tv\/pair/);
});

void test('version reply uses the configured versions', () => {
  const body = renderVersionReply({ ...DEFAULT_VERSIONS, roku: '9.9.9' });
  assert.match(body, /\| Roku \| 9\.9\.9 \|/);
});

void test('removal message names the subreddit and never echoes the content', () => {
  const body = renderRemovalMessage('comment', 'TunerTVapp');
  assert.match(body, /r\/TunerTVapp/);
  assert.match(body, /support@tunertv\.app/);
});

void test('parseList splits, lowercases and dedupes', () => {
  assert.deepEqual(parseList('Help, SUPPORT\n\nhelp ,setup,'), [
    'help',
    'support',
    'setup',
  ]);
  assert.deepEqual(parseList(undefined), []);
});
