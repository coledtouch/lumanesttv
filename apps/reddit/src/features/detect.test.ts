import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPrivateInfo, isHelpPost, isVersionCommand } from './detect.js';

void test('finds playlist links', () => {
  assert.equal(
    findPrivateInfo('here http://example.com/list.m3u enjoy'),
    'playlist-link'
  );
  assert.equal(
    findPrivateInfo('(https://cdn.example.net/a/b.m3u8?token=x)'),
    'playlist-link'
  );
  assert.equal(
    findPrivateInfo(
      'http://line.example.com:8080/get.php?username=bob&password=pw123&type=m3u_plus'
    ),
    'playlist-link'
  );
  assert.equal(
    findPrivateInfo('try player_api.php?username=bob'),
    'playlist-link'
  );
});

void test('finds stream addresses with a login in the path', () => {
  assert.equal(
    findPrivateInfo('http://srv.example.com:80/live/bob/pw123/4567.ts'),
    'stream-url'
  );
  assert.equal(
    findPrivateInfo('https://srv.example.com/movie/bob/pw123/99.mkv'),
    'stream-url'
  );
});

void test('finds a username and password together', () => {
  assert.equal(
    findPrivateInfo('Username: bob123\nPassword: hunter22'),
    'login'
  );
  assert.equal(findPrivateInfo('user=bob123 pass=hunter22'), 'login');
});

void test('finds MAC addresses', () => {
  assert.equal(findPrivateInfo('my mac is 00:1A:79:AB:CD:EF'), 'mac-address');
  assert.equal(findPrivateInfo('00-1a-79-ab-cd-ef'), 'mac-address');
});

void test('leaves ordinary posts alone', () => {
  assert.equal(findPrivateInfo(''), undefined);
  assert.equal(
    findPrivateInfo(
      'Channels freeze after 10 minutes on my Roku. Version 1.1.0.'
    ),
    undefined
  );
  assert.equal(
    findPrivateInfo('I forgot my username, how do I reset it?'),
    undefined
  );
  assert.equal(
    findPrivateInfo('My password: does not work anymore'),
    undefined
  );
  assert.equal(
    findPrivateInfo('Setup guide: https://lumanest.tv/apps'),
    undefined
  );
  assert.equal(findPrivateInfo('Is the m3u format supported?'), undefined);
  assert.equal(findPrivateInfo('Watching live/sports on 10:30 PM'), undefined);
});

void test('stays fast on long hostile input', () => {
  const started = Date.now();
  findPrivateInfo(
    'http://' + 'a'.repeat(100000) + ' user: ' + 'x'.repeat(100000)
  );
  findPrivateInfo('aa:'.repeat(50000));
  assert.ok(Date.now() - started < 1000);
});

const flairs = ['help', 'support', 'setup'];
const keywords = ['help', 'not working', 'error', 'install', "can't log in"];

void test('help posts by flair or keyword', () => {
  assert.equal(
    isHelpPost({ title: 'Hi', selftext: '', flair: 'Help' }, flairs, keywords),
    true
  );
  assert.equal(
    isHelpPost(
      { title: 'Guide is not working', selftext: '', flair: undefined },
      flairs,
      keywords
    ),
    true
  );
  assert.equal(
    isHelpPost(
      { title: 'Question', selftext: "I can't log in on my LG", flair: 'LG' },
      flairs,
      keywords
    ),
    true
  );
  assert.equal(
    isHelpPost(
      { title: 'ERROR on start', selftext: '', flair: undefined },
      flairs,
      keywords
    ),
    true
  );
});

void test('keywords match whole words only', () => {
  assert.equal(
    isHelpPost(
      { title: 'Terrorism documentary', selftext: '', flair: undefined },
      flairs,
      keywords
    ),
    false
  );
  assert.equal(
    isHelpPost(
      { title: 'Love the new installment', selftext: '', flair: undefined },
      flairs,
      keywords
    ),
    false
  );
  assert.equal(
    isHelpPost(
      {
        title: 'Loving the trailers!',
        selftext: 'Great update',
        flair: 'Roku',
      },
      flairs,
      keywords
    ),
    false
  );
});

void test('the !version command', () => {
  assert.equal(isVersionCommand('!version'), true);
  assert.equal(isVersionCommand('  !Versions please'), true);
  assert.equal(isVersionCommand('!version\nthanks'), true);
  assert.equal(isVersionCommand('what !version'), false);
  assert.equal(isVersionCommand('!versioning'), false);
  assert.equal(isVersionCommand(''), false);
});
