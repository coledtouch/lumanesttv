import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {footerLinks, headerLinks} from '../app/site-links.ts';

const purchase = (href: string) => href === '/#plans' || href === '/renew';

test('the header and footer keep the Plans and Renew links by default', () => {
  assert.deepEqual(headerLinks().map(([, label]) => label), ['Plans', 'Watch now', 'Renew', 'Set up my TV', 'Help']);
  assert.deepEqual(footerLinks({support: 'help@example.com'}).map(([href, label]) => [href, label]), [
    ['mailto:help@example.com', 'Contact support'], ['/renew', 'Renew subscription'], ['/watch', 'Web player'],
    ['/apps', 'TV setup'], ['https://portal.lumanest.tv', 'Customer hub'], ['/#logins', 'Which login?'],
  ]);
});

test('without purchases, no header or footer link leads to buying or renewing', () => {
  assert.deepEqual(headerLinks(false).map(([, label]) => label), ['Watch now', 'Set up my TV', 'Help']);
  const footer = footerLinks({portal: 'https://hub.example', purchases: false});
  assert.deepEqual(footer.map(([, label]) => label), ['Contact support', 'Web player', 'TV setup', 'Customer hub', 'Which login?']);
  assert.ok(![...headerLinks(false), ...footer].some(([href]) => purchase(href)));
});

test('the TV pairing page asks for the header and footer without purchase links', async () => {
  const page = await readFile(new URL('../app/pair/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<SiteHeader\b[^>]*\bpurchases=\{false\}/);
  assert.match(page, /<SiteFooter\b[^>]*\bpurchases=\{false\}/);
  const flow = await readFile(new URL('../app/pair/pair-flow.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(flow, /href=["'{][^>]*(?:\/renew|#plans)/, 'the pairing steps themselves link to no plan or renewal page');
});
