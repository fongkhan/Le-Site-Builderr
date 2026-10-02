import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeLocale, localePath, localeRouteParam, localesInPages, DEFAULT_LOCALE, publishedRoutes, ROUTE_SLUG_RE } = require('../../lib/i18n.js');

test('normalizeLocale — repli sur la langue par défaut', () => {
  assert.equal(normalizeLocale('fr'), 'fr');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('de'), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
  assert.equal(normalizeLocale('../etc'), DEFAULT_LOCALE); // valeur hostile ignorée
});

test('localePath — langue par défaut à la racine, autres préfixées', () => {
  assert.equal(localePath('fr', 'home'), '/');
  assert.equal(localePath('fr', 'contact'), '/contact/');
  assert.equal(localePath('en', 'home'), '/en/');
  assert.equal(localePath('en', 'contact'), '/en/contact/');
  assert.equal(localePath('de', 'home'), '/'); // langue inconnue → défaut
});

test('localeRouteParam — segments Astro sans slashs', () => {
  assert.equal(localeRouteParam('fr', 'home'), '');
  assert.equal(localeRouteParam('fr', 'contact'), 'contact');
  assert.equal(localeRouteParam('en', 'home'), 'en');
  assert.equal(localeRouteParam('en', 'contact'), 'en/contact');
});

test('localesInPages — langues présentes, dans l’ordre canonique', () => {
  assert.deepEqual(localesInPages([{ locale: 'en' }, { locale: 'fr' }]), ['fr', 'en']);
  assert.deepEqual(localesInPages([{ locale: 'fr' }]), ['fr']);
  assert.deepEqual(localesInPages([{}]), ['fr']); // sans locale → défaut
  assert.deepEqual(localesInPages([]), []);
});

// Le template Astro embarque sa propre copie (ESM) : elle doit rester identique,
// sinon les URLs du sitemap et celles générées au build divergeraient.
test('i18n — serveur et template appliquent exactement la même règle', async () => {
  const tpl = await import('../../../client-template/src/lib/i18n.mjs');
  assert.deepEqual(tpl.LOCALES, require('../../lib/i18n.js').LOCALES);
  assert.equal(tpl.DEFAULT_LOCALE, DEFAULT_LOCALE);
  for (const locale of ['fr', 'en', 'de', undefined]) {
    for (const slug of ['home', 'contact', 'a-propos']) {
      assert.equal(tpl.localePath(locale, slug), localePath(locale, slug), `localePath(${locale}, ${slug})`);
      assert.equal(tpl.localeRouteParam(locale, slug), localeRouteParam(locale, slug));
    }
  }
});

test('isRoutablePage — adresses réservées de la langue par défaut', async () => {
  const { isRoutablePage } = require('../../lib/i18n.js');
  assert.equal(isRoutablePage('fr', 'blog'), false);
  assert.equal(isRoutablePage(undefined, 'en'), false);
  assert.equal(isRoutablePage('fr', 'contact'), true);
  assert.equal(isRoutablePage('en', 'blog'), true); // /en/blog/ n'entre en collision avec rien
});

test('publishedRoutes — uniquement les routes générées par le template', () => {
  const pages = [
    { slug: 'home', title: 'Accueil' },
    { slug: 'contact', title: 'Contact' },
    { slug: 'contact', title: 'Contact bis' }, // doublon de route
    { slug: 'a-propos/equipe', title: 'Équipe' }, // adresse invalide
    { slug: 'blog', title: 'Blog' }, // réservée
    { slug: 'home', locale: 'en', title: 'Home' },
  ];
  const posts = [
    { slug: 'nouveau', title: 'Nouveau' },
    { slug: 'nouveau', title: 'Ancien homonyme' },
    { slug: 'Mon article', title: 'Espace' },
    { slug: 'sans-titre', title: '' },
  ];
  assert.deepEqual(publishedRoutes(pages, posts), ['home', 'contact', 'en', 'blog', 'blog/nouveau']);
  assert.deepEqual(publishedRoutes([], []), []);
});

test('publishedRoutes — même expression d’adresse que le template', () => {
  const source = fs.readFileSync(new URL('../../../client-template/src/lib/content.ts', import.meta.url), 'utf-8');
  const match = source.match(/const SLUG_RE = (\/.+\/);/);
  assert.ok(match, 'SLUG_RE introuvable dans le template');
  assert.equal(match[1], String(ROUTE_SLUG_RE));
});
