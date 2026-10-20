#!/usr/bin/env node
// Checks for the Tuner website, with no dependencies (Node.js 18 or newer). From tuner-site/:
//   node tools/site.mjs              check pages, internal links, anchors, contact email, deploy config and tool versions
//   node tools/site.mjs set-email    write supportEmail from site.config.json into every page
// HTML syntax itself is checked separately by html-validate (see README.md and the GitHub workflow).
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const ORIGIN = 'https://' + config.domain;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// File names such as logo@2x.png match the address pattern but are never contact addresses.
const ASSET_NAME = /\.(?:avif|css|gif|ico|jpe?g|js|json|mjs|png|svg|txt|webp|woff2?|xml)$/i;
const emailsIn = text => (text.match(EMAIL) || []).filter(value => !ASSET_NAME.test(value));
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(PUBLIC);
const pages = files.filter(file => file.endsWith('.html'));

const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const attrs = (html, name) => [...html.matchAll(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'gi'))].map(m => decode(m[1]));

if (process.argv[2] === 'set-email') {
  // Replace only the address(es) the pages link to with mailto: today, so nothing that merely looks like an
  // address (an image named logo@2x.png, say) is rewritten.
  const current = new Set(pages.flatMap(file => attrs(readFileSync(file, 'utf8'), 'href')
    .filter(href => href.startsWith('mailto:')).map(href => href.slice('mailto:'.length).split('?')[0])));
  current.delete(config.supportEmail);
  const old = current.size ? new RegExp('(?<![\\w.%+-])(?:' + [...current].map(escapeRegExp).join('|') + ')(?![\\w-]|\\.[A-Za-z0-9])', 'g') : null;
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const next = old ? html.replace(old, config.supportEmail) : html;
    if (next !== html) writeFileSync(file, next);
    console.log((next === html ? 'unchanged ' : 'updated   ') + relative(ROOT, file));
  }
  process.exit(0);
}

const errors = [];
const fail = (file, message) => errors.push(relative(ROOT, file) + ': ' + message);

/** Mirrors Workers static assets with html_handling "auto-trailing-slash": the published URL path of a file. */
function urlPath(file) {
  const path = '/' + relative(PUBLIC, file).split('\\').join('/');
  if (path === '/index.html') return '/';
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  return path.endsWith('.html') ? path.slice(0, -'.html'.length) : path;
}
const byUrl = new Map(files.map(file => [urlPath(file), file]));
const ids = new Map(pages.map(file => [file, new Set(attrs(readFileSync(file, 'utf8'), 'id'))]));

function checkTarget(file, raw, kind) {
  let url;
  try { url = new URL(raw, ORIGIN + urlPath(file)); } catch { return fail(file, `${kind} "${raw}" is not a valid URL`); }
  if (url.protocol === 'http:') return fail(file, `${kind} "${raw}" uses http; use https`);
  if (url.origin !== ORIGIN) return;
  if (!raw.startsWith('/') && !raw.startsWith(ORIGIN) && !raw.startsWith('#')) {
    // 404.html is served at any depth, so relative paths would break there.
    return fail(file, `${kind} "${raw}" should be root-relative (start with /)`);
  }
  if (url.pathname.endsWith('.html')) return fail(file, `${kind} "${raw}" should drop ".html" (Cloudflare redirects it)`);
  const target = byUrl.get(decodeURIComponent(url.pathname));
  if (!target) return fail(file, `${kind} "${raw}" points to a missing file`);
  if (url.hash && target.endsWith('.html') && !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))) {
    fail(file, `${kind} "${raw}" points to a missing anchor`);
  }
}

for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const path = urlPath(file);
  const isNotFound = path === '/404';

  if (!/^<!DOCTYPE html>\n<html lang="en">/.test(html)) fail(file, 'must start with <!DOCTYPE html> and <html lang="en">');
  if (/<script\b/i.test(html)) fail(file, 'contains a <script>; the site ships no JavaScript');
  if (/<style\b|\sstyle\s*=/i.test(html)) fail(file, 'contains inline CSS, which the Content-Security-Policy blocks');
  if (/\son[a-z]+\s*=/i.test(html)) fail(file, 'contains an inline event handler');
  if (/<iframe\b|<form\b/i.test(html)) fail(file, 'contains an iframe or form');
  if ((html.match(/<h1\b/gi) || []).length !== 1) fail(file, 'needs exactly one <h1>');
  if (!/<title>[^<]+· Tuner by LumaNest TV<\/title>|<title>Tuner by LumaNest TV<\/title>/.test(html)) fail(file, 'title must end with "· Tuner by LumaNest TV"');
  if (!/<main id="main">/.test(html) || !/href="#main"/.test(html)) fail(file, 'needs <main id="main"> and a skip link to it');
  if (!html.includes('href="/styles.css"')) fail(file, 'must use /styles.css');
  if (!html.includes(`is published by ${config.publisher}.`)) fail(file, `footer must name the publisher "${config.publisher}"`);
  for (const link of ['/privacy', '/terms', '/support', '/delete']) {
    if (!html.includes(`href="${link}"`)) fail(file, `must link to ${link}`);
  }

  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
  if (isNotFound) {
    if (canonical) fail(file, 'the 404 page must not have a canonical URL');
    if (!html.includes('<meta name="robots" content="noindex">')) fail(file, 'the 404 page must be noindex');
  } else {
    if (!canonical || canonical[1] !== ORIGIN + path) fail(file, `canonical must be ${ORIGIN + path}`);
    if (!/<meta name="description" content="[^"]{50,170}">/.test(html)) fail(file, 'needs a meta description of 50 to 170 characters');
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (!/\salt="/.test(tag)) fail(file, `image without alt text: ${tag}`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) fail(file, `image without width and height: ${tag}`);
  }

  for (const href of attrs(html, 'href')) {
    if (href.startsWith('mailto:')) {
      if (href.slice(7).split('?')[0] !== config.supportEmail) fail(file, `mailto "${href}" doesn't use ${config.supportEmail}`);
      continue;
    }
    checkTarget(file, href, 'link');
  }
  for (const src of attrs(html, 'src')) checkTarget(file, src, 'src');
  for (const set of attrs(html, 'srcset')) {
    for (const candidate of set.split(',')) checkTarget(file, candidate.trim().split(/\s+/)[0], 'srcset');
  }
  for (const content of attrs(html, 'content').filter(value => value.startsWith(ORIGIN))) checkTarget(file, content, 'meta');

  const emails = new Set(emailsIn(html));
  for (const email of emails) if (email !== config.supportEmail) fail(file, `email "${email}" differs from site.config.json (${config.supportEmail})`);
  if (!isNotFound && !['/', '/support', '/privacy', '/terms', '/delete'].includes(path)) fail(file, 'page is not in the sitemap list in tools/site.mjs');
}

// Legal pages show a "last updated" date.
for (const name of ['privacy.html', 'terms.html', 'delete.html']) {
  const html = readFileSync(join(PUBLIC, name), 'utf8');
  if (!/Last updated <time datetime="\d{4}-\d{2}-\d{2}">/.test(html)) fail(join(PUBLIC, name), 'needs a "Last updated <time datetime>" line');
}

// The sitemap lists every indexable page, and only pages that exist.
const sitemap = readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8');
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
for (const loc of listed) if (!loc.startsWith(ORIGIN) || !byUrl.has(new URL(loc).pathname)) fail(join(PUBLIC, 'sitemap.xml'), `${loc} isn't a page`);
for (const file of pages) {
  const path = urlPath(file);
  if (path !== '/404' && !listed.includes(ORIGIN + path)) fail(join(PUBLIC, 'sitemap.xml'), `missing ${ORIGIN + path}`);
}
// A legal page's lastmod is never older than its "Last updated" date: both change together (README, Changing the site).
for (const name of ['privacy.html', 'terms.html', 'delete.html']) {
  const updated = /Last updated <time datetime="(\d{4}-\d{2}-\d{2})">/.exec(readFileSync(join(PUBLIC, name), 'utf8'))?.[1];
  const loc = ORIGIN + '/' + name.slice(0, -'.html'.length);
  const lastmod = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].find(m => m[1] === loc)?.[2];
  if (updated && !(lastmod >= updated)) fail(join(PUBLIC, 'sitemap.xml'), `${loc} needs a lastmod of ${updated} or later (its "Last updated" date), not ${lastmod || 'none'}`);
}
if (!readFileSync(join(PUBLIC, 'robots.txt'), 'utf8').includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) fail(join(PUBLIC, 'robots.txt'), 'must point to the sitemap');

// Fonts and the stylesheet must stay on this origin.
const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
for (const [, value] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
  if (!value.startsWith('/') || !byUrl.has(value)) fail(join(PUBLIC, 'styles.css'), `url(${value}) must be an existing root-relative file`);
}
if (/@import/.test(css)) fail(join(PUBLIC, 'styles.css'), 'must not @import other stylesheets');

// Deployment configuration: an assets-only Worker named tuner-site serving ./public with the 404 page.
const jsonc = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
  .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? '')
  .replace(/,(\s*[}\]])/g, '$1');
let wrangler;
try { wrangler = JSON.parse(jsonc); } catch (error) { fail(join(ROOT, 'wrangler.jsonc'), 'is not valid JSONC: ' + error.message); }
if (wrangler) {
  const wf = join(ROOT, 'wrangler.jsonc');
  if (wrangler.name !== 'tuner-site') fail(wf, 'name must be "tuner-site"');
  if (wrangler.main) fail(wf, 'must stay assets-only (no "main"), or _headers would not apply to Worker responses');
  if (resolve(ROOT, wrangler.assets?.directory || '') !== PUBLIC) fail(wf, 'assets.directory must be ./public');
  if (wrangler.assets?.not_found_handling !== '404-page' || !existsSync(join(PUBLIC, '404.html'))) fail(wf, 'needs not_found_handling "404-page" and public/404.html');
  if (wrangler.assets?.html_handling !== 'auto-trailing-slash') fail(wf, 'html_handling must be "auto-trailing-slash" (the link checks assume it)');
  for (const route of wrangler.routes || []) {
    if (!route.custom_domain || ![config.domain, 'www.' + config.domain].includes(route.pattern)) fail(wf, `unexpected route ${JSON.stringify(route)}`);
  }
}
if (!existsSync(join(PUBLIC, '_headers'))) fail(join(PUBLIC, '_headers'), 'is missing');

// Tool versions are pinned in README.md, wrangler.jsonc and the GitHub workflow; they must agree.
const pinFiles = [join(ROOT, 'README.md'), join(ROOT, 'wrangler.jsonc'), join(ROOT, '..', '.github', 'workflows', 'tuner-site.yml')].filter(existsSync);
for (const tool of ['wrangler', 'html-validate']) {
  const versions = new Map();
  for (const file of pinFiles) {
    for (const [, version] of readFileSync(file, 'utf8').matchAll(new RegExp('\\b' + escapeRegExp(tool) + '@(\\d+\\.\\d+\\.\\d+)', 'g'))) {
      versions.set(version, new Set([...(versions.get(version) || []), relative(ROOT, file)]));
    }
  }
  if (versions.size > 1) {
    fail(join(ROOT, 'README.md'), `${tool} is pinned to different versions: ` + [...versions].map(([v, where]) => `${v} (${[...where].join(', ')})`).join('; '));
  }
}

if (errors.length) {
  console.error(errors.map(e => '✗ ' + e).join('\n'));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ ${pages.length} pages, ${files.length} files: links, anchors, images, contact email (${config.supportEmail}), sitemap, wrangler.jsonc and pinned tool versions are consistent.`);
