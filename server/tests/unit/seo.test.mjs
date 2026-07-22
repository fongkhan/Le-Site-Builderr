import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateSitemap, generateRobots, pageUrl } = require('../../lib/seo.js');

test('pageUrl — home à la racine, autres pages en répertoire', () => {
  assert.equal(pageUrl('exemple.fr', 'home'), 'https://exemple.fr/');
  assert.equal(pageUrl('exemple.fr', 'contact'), 'https://exemple.fr/contact/');
});

test('generateSitemap — XML valide avec toutes les pages', () => {
  const xml = generateSitemap('exemple.fr', ['home', 'contact'], '2026-01-15');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/exemple\.fr\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/exemple\.fr\/contact\/<\/loc>/);
  assert.match(xml, /<lastmod>2026-01-15<\/lastmod>/);
  assert.equal((xml.match(/<url>/g) || []).length, 2);
});

test('generateSitemap — échappe les caractères XML', () => {
  const xml = generateSitemap('exemple.fr', ['a&b'], '2026-01-15');
  assert.match(xml, /a&amp;b/);
  assert.ok(!xml.includes('a&b<'));
});

test('generateRobots — autorise tout et référence le sitemap', () => {
  const txt = generateRobots('exemple.fr');
  assert.match(txt, /User-agent: \*/);
  assert.match(txt, /Allow: \//);
  assert.match(txt, /Sitemap: https:\/\/exemple\.fr\/sitemap\.xml/);
});
