import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  BAD_REQUEST_PAGE, FRAME_CSP, FRAME_SCRIPT, FRAME_STYLE, trailerEmbedKey, trailerEmbedPage, trailerEmbedResponse,
} from '../lib/trailer-embed.ts';

const KEY = 'L0fw0WzFaBM';
const BASE = 'https://lumanest.tv/embed/trailer';
const key = (query: string) => trailerEmbedKey(new URL(BASE + query));
const get = (query: string, method = 'GET') => trailerEmbedResponse(new Request(BASE + query, {method}));
const headers = (response: Response) => Object.fromEntries([...response.headers].sort(([a], [b]) => a.localeCompare(b)));

function directives(policy: string) {
  const map = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    assert.ok(!map.has(name), 'directive once: ' + name);
    map.set(name, sources);
  }
  return map;
}

test('the key: exactly one v=1 and one 11-character YouTube key, in any order, other parameters ignored', () => {
  assert.equal(key('?v=1&k=' + KEY), KEY);
  assert.equal(key('?k=' + KEY + '&v=1'), KEY);
  assert.equal(key('?v=1&k=a-_b0Z9yXwV'), 'a-_b0Z9yXwV');
  assert.equal(key('?v=1&k=' + KEY + '&utm=x'), KEY);
  for (const query of [
    '', '?v=1', '?k=' + KEY, '?v=2&k=' + KEY, '?v=01&k=' + KEY, '?v=1.0&k=' + KEY, '?v=&k=' + KEY, '?V=1&k=' + KEY,
    '?v=1&v=1&k=' + KEY, '?v=1&k=' + KEY + '&k=' + KEY, '?v=1&K=' + KEY, '?v=1&k=', '?v=1&k=L0fw0WzFaB',
    '?v=1&k=L0fw0WzFaBMx', '?v=1&k=L0fw0WzFa+M', '?v=1&k=L0fw0WzFa%20M', '?v=1&k=L0fw0WzFa.M', '?v=1&k=L0fw0WzFa/M',
    '?v=1&k=L0fw0WzFaBM%0A', '?v=1&k=%0AL0fw0WzFaB', '?v=1&k=L0fw0WzFa%C3%A9', '?v=1&k=%3Cscript%3Ex', '?v=1&k=L0fw0WzFaB%00',
  ]) assert.equal(key(query), null, query);
});

test('the page: the key once and the two same-origin files; nothing of YouTube\'s, no inline script or style', () => {
  const page = trailerEmbedPage(KEY);
  assert.equal(page.split(KEY).length, 2);
  assert.match(page, /^<!doctype html>\n<html lang="en">/);
  assert.ok(page.includes('<div id="player" data-k="' + KEY + '"></div>'));
  assert.deepEqual([...page.matchAll(/<script\b[^>]*>/g)].map(match => match[0]), ['<script src="' + FRAME_SCRIPT + '">']);
  assert.deepEqual([...page.matchAll(/<link\b[^>]*>/g)].map(match => match[0]), ['<link rel="stylesheet" href="' + FRAME_STYLE + '">']);
  assert.doesNotMatch(page, /<style|\sstyle=|\son[a-z]+=|javascript:/i);
  // The frame script adds YouTube's IFrame API only when it makes the player (tests/trailer-frame.test.mjs): opened on
  // its own or framed by a website, the page asks nothing of YouTube.
  assert.doesNotMatch(page, /youtube|ytimg|googlevideo|https?:/i);
  assert.throws(() => trailerEmbedPage('<script>xx'));
});

test('the files the page names carry the first 12 hex digits of their SHA-256', () => {
  for (const address of [FRAME_SCRIPT, FRAME_STYLE]) {
    const [path, version] = address.split('?v=');
    const bytes = readFileSync(new URL('../public' + path, import.meta.url));
    assert.equal(version, createHash('sha256').update(bytes).digest('hex').slice(0, 12), path + ' changed: update its ?v= in lib/trailer-embed.ts');
  }
});

test('served headers: frameable by any parent, strict CSP, origin-only Referer, a day in caches', async () => {
  const response = get('?v=1&k=' + KEY);
  assert.equal(response.status, 200);
  assert.deepEqual(headers(response), {
    'cache-control': 'public, max-age=86400',
    'content-security-policy': FRAME_CSP,
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
  });
  assert.equal(response.headers.get('X-Frame-Options'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(await response.text(), trailerEmbedPage(KEY));

  const csp = directives(response.headers.get('Content-Security-Policy')!);
  assert.equal(csp.has('frame-ancestors'), false, 'no frame-ancestors: file:// and app-scheme parents must be able to frame it');
  assert.equal(csp.has('sandbox'), false);
  assert.deepEqual(Object.fromEntries(csp), {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
    'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
    'child-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
    'img-src': ['https://i.ytimg.com', 'https://s.ytimg.com'],
    'style-src': ["'self'"],
    'connect-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  });
  assert.doesNotMatch(FRAME_CSP, /unsafe-|\*|data:|blob:|http:/);

  const head = get('?v=1&k=' + KEY, 'HEAD');
  assert.equal(head.status, 200);
  assert.deepEqual(headers(head), headers(response));
  assert.equal(await head.text(), '');
});

test('anything else: a plain 400 that repeats nothing from the request and is not cached', async () => {
  for (const query of ['', '?v=2&k=' + KEY, '?v=1&k=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '?v=1&k=EVILEVILEVIL', '?v=1&k=' + KEY + '&k=' + KEY]) {
    const response = get(query);
    assert.equal(response.status, 400, query);
    const body = await response.text();
    assert.equal(body, BAD_REQUEST_PAGE);
    assert.doesNotMatch(body, /script|EVIL|L0fw|youtube|player/i);
    assert.deepEqual(headers(response), {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'",
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    });
  }
  const head = get('?v=9', 'HEAD');
  assert.equal(head.status, 400);
  assert.equal(await head.text(), '');
});

test('the static files get a day in caches and nosniff from public/_headers', () => {
  const rules = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  for (const path of ['/embed/trailer-frame.js', '/embed/trailer-frame.css']) {
    const block = rules.split(/\n(?=\S)/).find(rule => rule.split('\n')[0].trim() === path);
    assert.ok(block, 'rule for ' + path);
    assert.deepEqual(block.split('\n').slice(1).map(line => line.trim()).filter(Boolean), ['Cache-Control: public, max-age=86400', 'X-Content-Type-Options: nosniff']);
  }
  assert.doesNotMatch(rules, /^\/embed\/\*/m, 'no wildcard rule: Cloudflare joins the values of overlapping rules');
});
