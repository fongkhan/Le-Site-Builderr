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
  assert.ok(findDangerousUrl([{ images: [' \u0001java\tscript:void(0)'] }]));
  assert.ok(findDangerousUrl({ avatar: 'data:text/html;base64,PHNjcmlwdD4=' }));
  assert.ok(findDangerousUrl({ socials: { x: 'vbscript:msgbox(1)' } }));
  assert.equal(findDangerousUrl({ url: 'https://exemple.fr/javascript:x', image: 'data:image/png;base64,AA==' }), null);
});

test('validatePagesBody — le mot « JavaScript » reste permis dans les textes', () => {
  const faq = { blockType: 'faq', title: 'JavaScript & TypeScript', items: [{ question: 'JavaScript est-il nécessaire ?', answer: 'javascript: pas besoin.' }] };
  assert.equal(validatePagesBody({ docs: [page({ layout: [faq] })] }), null);
  assert.equal(findDangerousUrl({ image: 'javascript-logo.png' }), null);
});

test('validatePagesBody — liste des pages supprimées', () => {
  assert.equal(validatePagesBody({ docs: [page()], deleted: [{ slug: 'contact', locale: 'en' }] }), null);
  assert.match(validatePagesBody({ docs: [page()], deleted: 'contact' }), /supprimées invalide/);
  assert.match(validatePagesBody({ docs: [page()], deleted: [{ slug: '../x' }] }), /supprimées invalide/);
});

test('normalizePost — champs par défaut et statut borné', () => {
  assert.deepEqual(normalizePost({ title: 'T', slug: 't', status: 'autre' }), {
    title: 'T', slug: 't', excerpt: '', coverImage: '', body: '', tags: '', publishedAt: null, status: 'draft',
  });
});
