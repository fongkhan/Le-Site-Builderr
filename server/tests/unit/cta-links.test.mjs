import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCtaLink, resolveCtaLink, safeMailto, safeTel } from '../../../client-template/src/lib/links.mjs';
import { t } from '../../../client-template/src/lib/ui-strings.mjs';

test('parseCtaLink — pages du site normalisées', () => {
  assert.deepEqual(parseCtaLink('/'), { kind: 'page', path: '/' });
  assert.deepEqual(parseCtaLink('/cours'), { kind: 'page', path: '/cours/' });
  assert.deepEqual(parseCtaLink('  /cours/  '), { kind: 'page', path: '/cours/' });
  assert.deepEqual(parseCtaLink('/en/about/'), { kind: 'page', path: '/en/about/' });
  assert.deepEqual(parseCtaLink('/blog/ouverture_atelier-2'), { kind: 'page', path: '/blog/ouverture_atelier-2/' });
});

test('parseCtaLink — ancres', () => {
  assert.deepEqual(parseCtaLink('#contact'), { kind: 'anchor', href: '#contact' });
  assert.deepEqual(parseCtaLink('#rendez-vous-2'), { kind: 'anchor', href: '#rendez-vous-2' });
  assert.equal(parseCtaLink(`#a${'b'.repeat(64)}`), null);
});

test('parseCtaLink — téléphone, email et adresses web', () => {
  assert.deepEqual(parseCtaLink('tel:04 78 00 00 00'), { kind: 'external', href: 'tel:0478000000', newTab: false });
  assert.deepEqual(parseCtaLink('TEL:+33 4 78'), { kind: 'external', href: 'tel:+33478', newTab: false });
  assert.deepEqual(parseCtaLink('mailto:bonjour@atelier.fr'), { kind: 'external', href: 'mailto:bonjour@atelier.fr', newTab: false });
  assert.deepEqual(parseCtaLink('https://reservation.example/atelier'), { kind: 'external', href: 'https://reservation.example/atelier', newTab: true });
  assert.deepEqual(parseCtaLink('http://x.fr'), { kind: 'external', href: 'http://x.fr/', newTab: true });
  assert.deepEqual(parseCtaLink('www.planity.com/atelier'), { kind: 'external', href: 'https://www.planity.com/atelier', newTab: true });
});

test('parseCtaLink — tout le reste est refusé', () => {
  const refused = [
    '//evil.com', '/\\evil', '/cours/../x', '/cours?x=1', '/cours/#contact', '/cours//x', '#1x', '# x', '#',
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:x', 'data:text/html,x', 'vbscript:x',
    'tel:', 'tel:12', 'mailto:x', 'https:/', 'https://', 'ftp://x.fr', 'file:///etc/passwd',
    'https://user:p@x.fr', 'https://user@x.fr', `https://x.fr/${'a'.repeat(2049 - 'https://x.fr/'.length)}`,
    'https://x.fr/\u0007', 'cours', '', '   ', 42, null, undefined, {},
  ];
  assert.equal(`https://x.fr/${'a'.repeat(2049 - 'https://x.fr/'.length)}`.length, 2049);
  for (const value of refused) assert.equal(parseCtaLink(value), null, JSON.stringify(value));
  // 2048 caractères : encore accepté
  assert.ok(parseCtaLink(`https://x.fr/${'a'.repeat(2048 - 'https://x.fr/'.length)}`));
});

test('resolveCtaLink — cible existante seulement, chemin de base appliqué aux pages', () => {
  const ctx = {
    routes: new Set(['/', '/cours/', '/en/', '/blog/']),
    anchors: new Set(['contact']),
    withBase: (p) => `/preview/demo${p}`,
  };
  assert.deepEqual(resolveCtaLink('/cours', ctx), { href: '/preview/demo/cours/', newTab: false });
  assert.deepEqual(resolveCtaLink('/', ctx), { href: '/preview/demo/', newTab: false });
  assert.equal(resolveCtaLink('/supprimee/', ctx), null);
  assert.deepEqual(resolveCtaLink('#contact', ctx), { href: '#contact', newTab: false });
  assert.equal(resolveCtaLink('#rendez-vous', ctx), null);
  assert.deepEqual(resolveCtaLink('https://reservation.example/x', ctx), { href: 'https://reservation.example/x', newTab: true });
  assert.deepEqual(resolveCtaLink('tel:0478000000', ctx), { href: 'tel:0478000000', newTab: false });
  for (const value of ['', undefined, null, 'javascript:alert(1)']) assert.equal(resolveCtaLink(value, ctx), null, String(value));
  // Sans contexte : pages et ancres jamais résolues, chemin de base neutre
  assert.equal(resolveCtaLink('/cours/'), null);
  assert.equal(resolveCtaLink('#contact'), null);
  assert.deepEqual(resolveCtaLink('/x/', { routes: new Set(['/x/']) }), { href: '/x/', newTab: false });
});

test('safeMailto / safeTel — comportement inchangé (déplacés depuis url.ts)', () => {
  assert.equal(safeMailto('a@b.fr'), 'mailto:a@b.fr');
  assert.equal(safeMailto('  a@b.fr '), 'mailto:a@b.fr');
  assert.equal(safeMailto('pas un email'), '');
  assert.equal(safeMailto(42), '');
  assert.equal(safeTel('04 78 00 00 00'), 'tel:0478000000');
  assert.equal(safeTel('+33 (0)4 78'), 'tel:+330478');
  assert.equal(safeTel('ab'), '');
  assert.equal(safeTel(null), '');
});

test('ui-strings — mention « nouvel onglet » traduite', () => {
  assert.equal(t('fr', 'newTab'), '(nouvel onglet)');
  assert.equal(t('en', 'newTab'), '(opens in a new tab)');
});
