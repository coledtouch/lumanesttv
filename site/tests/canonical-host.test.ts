import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRedirectTarget} from '../lib/canonical-host.ts';

const target = (url: string, method = 'GET') => canonicalRedirectTarget({url, method});

test('platform pages move to the branded domain while retaining path and query', () => {
  assert.equal(target('https://lumanest-preview.chatgpt.site/apps?device=lg&next=%2Fwatch')?.href, 'https://lumanest.tv/apps?device=lg&next=%2Fwatch');
  assert.equal(target('https://lumanest-preview.chatgpt.site/manage/login?return_to=%2Fmanage')?.href, 'https://lumanest.tv/manage/login?return_to=%2Fmanage');
  assert.equal(target('http://LUMANEST-PREVIEW.CHATGPT.SITE./watch', 'HEAD')?.href, 'https://lumanest.tv/watch');
});

test('custom domains and previews do not redirect or trust forwarded host headers', () => {
  for (const origin of ['https://lumanest.tv', 'https://www.lumanest.tv', 'https://portal.lumanest.tv', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174', 'https://chatgpt.site', 'https://fakechatgpt.site', 'https://preview.chatgpt.site.evil.example']) {
    assert.equal(target(origin + '/apps'), null);
  }
  const request = new Request('https://lumanest.tv/watch', {headers: {'Host': 'preview.chatgpt.site', 'X-Forwarded-Host': 'preview.chatgpt.site'}});
  assert.equal(canonicalRedirectTarget(request), null);
});

test('API, framework, and hosting authentication routes remain on their request origin', () => {
  for (const path of ['/api', '/api/owner/login', '/api/player/stream?token=private', '/_next/static/app.js', '/signin-with-chatgpt?return_to=%2Fmanage', '/signout-with-chatgpt', '/callback?code=private', '/callback/', '/%61pi/player/channels', '/%61pi%2Fplayer/channels', '//api/owner/login', '/%63allback?code=private']) {
    assert.equal(target('https://lumanest-preview.chatgpt.site' + path), null);
  }
});

test('requests carrying mutations or bodies never redirect', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(target('https://lumanest-preview.chatgpt.site/manage', method), null);
});

test('unusual public paths cannot become external redirects', () => {
  for (const path of ['//evil.example/watch?next=https%3A%2F%2Fevil.example', '/%2F%2Fevil.example', '/watch?next=//evil.example']) {
    const destination = target('https://lumanest-preview.chatgpt.site' + path);
    assert.equal(destination?.origin, 'https://lumanest.tv');
    assert.equal(destination?.pathname, new URL('https://lumanest-preview.chatgpt.site' + path).pathname);
  }
  assert.equal(target('not a URL'), null);
  assert.equal(target('https://lumanest-preview.chatgpt.site/%ZZ'), null);
});
