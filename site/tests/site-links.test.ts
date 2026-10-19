import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {footerLinks, headerHub, headerLinks} from '../app/site-links.ts';

const sells = (href: string) => href === '/#plans' || href === '/renew' || /portal|hub\.example/.test(href);

test('the header and footer keep the Plans, Renew and Customer hub links by default', () => {
  assert.deepEqual(headerLinks().map(([, label]) => label), ['Plans', 'Watch now', 'Renew', 'Set up my TV', 'Help']);
  assert.equal(headerHub(undefined), 'https://portal.lumanest.tv');
  assert.equal(headerHub('https://hub.example'), 'https://hub.example');
  assert.deepEqual(footerLinks({support: 'help@example.com'}).map(([href, label]) => [href, label]), [
    ['mailto:help@example.com', 'Contact support'], ['/renew', 'Renew subscription'], ['/watch', 'Web player'],
    ['/apps', 'TV setup'], ['https://portal.lumanest.tv', 'Customer hub'], ['/#logins', 'Which login?'],
  ]);
});

test('without purchases, no header or footer link leads to buying, renewing or the customer hub', () => {
  assert.deepEqual(headerLinks(false).map(([, label]) => label), ['Watch now', 'Set up my TV', 'Help']);
  assert.equal(headerHub('https://hub.example', false), null);
  const footer = footerLinks({portal: 'https://hub.example', purchases: false});
  assert.deepEqual(footer.map(([, label]) => label), ['Contact support', 'Web player', 'TV setup', 'Which login?']);
  assert.ok(![...headerLinks(false), ...footer].some(([href]) => sells(href)));
});

test('the TV pairing page leaves out purchase and customer hub links', async () => {
  const page = await readFile(new URL('../app/pair/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<SiteHeader\b[^>]*\bpurchases=\{false\}/);
  assert.match(page, /<SiteFooter\b[^>]*\bpurchases=\{false\}/);
  assert.doesNotMatch(page, /<PairFlow\b[^>]*\bportal=/, 'the pairing steps get no customer hub address');
  const flow = await readFile(new URL('../app/pair/pair-flow.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(flow, /href=["'{][^>]*(?:\/renew|#plans|portal)/, 'the pairing steps link to no plan, renewal or customer hub page');
  const chrome = await readFile(new URL('../app/site-chrome.tsx', import.meta.url), 'utf8');
  assert.match(chrome, /\{hub && <a className="chrome-hub"/, 'the header shows the hub link only when headerHub returns one');
});
