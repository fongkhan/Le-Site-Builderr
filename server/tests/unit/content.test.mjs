import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validatePagesBody, findDangerousUrl, normalizePost } = require('../../services/content.js');

const page = (extra = {}) => ({ title: 'Accueil', slug: 'home', layout: [], ...extra });

test('validatePagesBody — corps valide', () => {
  assert.equal(validatePagesBody({ docs: [page(), page({ locale: 'en' }), page({ slug: 'contact' })] }), null);
});

test('validatePagesBody — corps invalides', () => {
  assert.match(validatePagesBody(null), /liste de pages/);
  assert.match(validatePagesBody({ docs: 'x' }), /liste de pages/);
  assert.match(validatePagesBody({ docs: [page({ title: '  ' })] }), /titre/);
  assert.match(validatePagesBody({ docs: [page({ slug: '../x' })] }), /Adresse de page invalide/);
  assert.match(validatePagesBody({ docs: [page({ slug: 'a/b' })] }), /Adresse de page invalide/);
  assert.match(validatePagesBody({ docs: [page({ layout: 'x' })] }), /liste de sections/);
  assert.match(validatePagesBody({ docs: [page(), page()] }), /double/);
});

test('validatePagesBody — liens exécutables refusés dans les blocs', () => {
  const footer = { blockType: 'footer', socials: [{ platform: 'facebook', url: 'JavaScript:alert(1)' }] };
  assert.match(validatePagesBody({ docs: [page({ layout: [footer] })] }), /Lien non autorisé/);
  assert.ok(findDangerousUrl([{ a: { b: [' \u0001javascript:void(0)'] } }]));
  assert.ok(findDangerousUrl('data:text/html;base64,PHNjcmlwdD4='));
  assert.equal(findDangerousUrl({ url: 'https://exemple.fr/javascript:x', img: 'data:image/png;base64,AA==' }), null);
});

test('normalizePost — champs par défaut et statut borné', () => {
  assert.deepEqual(normalizePost({ title: 'T', slug: 't', status: 'autre' }), {
    title: 'T', slug: 't', excerpt: '', coverImage: '', body: '', tags: '', publishedAt: null, status: 'draft',
  });
});
