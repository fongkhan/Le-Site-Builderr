import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateHtaccess, ERROR_PAGE_ROUTE } = require('../../lib/htaccess.js');
const { publishedRoutes } = require('../../lib/i18n.js');
const { generateSitemap } = require('../../lib/seo.js');

// Directives fournies par des modules optionnels d'Apache : toujours sous <IfModule>.
const MODULE_DIRECTIVES = /^(Header|RequestHeader|AddOutputFilterByType|SetOutputFilter|Expires\w*|Rewrite\w*)\b/;

test('generateHtaccess — page 404 du template et pas de listing de dossier', () => {
  const conf = generateHtaccess();
  assert.match(conf, /^ErrorDocument 404 \/404\.html$/m);
  assert.match(conf, /^Options -Indexes$/m);
  assert.equal(ERROR_PAGE_ROUTE, '404');
});

test('generateHtaccess — aucune réécriture d’URL', () => {
  assert.doesNotMatch(generateHtaccess(), /RewriteEngine|RewriteRule|RewriteCond/i);
});

test('generateHtaccess — directives de module sous <IfModule>, sections équilibrées', () => {
  const stack = [];
  for (const raw of generateHtaccess().split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const close = line.match(/^<\/(\w+)>$/);
    if (close) {
      assert.equal(stack.pop(), close[1], `section fermée sans ouverture : ${line}`);
      continue;
    }
    const open = line.match(/^<(\w+)[\s>]/);
    if (open) {
      stack.push(open[1]);
      continue;
    }
    if (MODULE_DIRECTIVES.test(line)) {
      assert.ok(stack.includes('IfModule'), `directive hors <IfModule> : ${line}`);
    }
  }
  assert.deepEqual(stack, [], 'section non fermée');
});

test('generateHtaccess — cache long des ressources Astro, court pour le HTML', () => {
  const conf = generateHtaccess();
  assert.match(conf, /_astro[\s\S]*?max-age=31536000, immutable/);
  assert.match(conf, /\\\.woff2\$[\s\S]*?immutable/);
  assert.match(conf, /\\\.html\$"[\s\S]*?max-age=300/);
});

test('sitemap — la page 404 du template n’y figure jamais (page CMS « 404 » réservée)', () => {
  // La fixture contient une page fr d'adresse « 404 » (masquée par la page d'erreur du
  // template) et une page en/404 (générée normalement) : mêmes routes que writeSeoFiles.
  const fixture = JSON.parse(fs.readFileSync(new URL('../../../client-template/fixtures/site.json', import.meta.url), 'utf-8'));
  assert.ok(fixture.pages.docs.some((p) => p.slug === ERROR_PAGE_ROUTE && p.locale === 'fr'), 'fixture sans page fr « 404 »');
  const routes = publishedRoutes(fixture.pages.docs, fixture.posts.docs);
  assert.ok(!routes.includes(ERROR_PAGE_ROUTE));
  assert.ok(routes.includes(`en/${ERROR_PAGE_ROUTE}`));
  const xml = generateSitemap('exemple.fr', routes, '2026-01-15');
  assert.doesNotMatch(xml, /exemple\.fr\/404/);
  assert.match(xml, /exemple\.fr\/en\/404\//);
});
