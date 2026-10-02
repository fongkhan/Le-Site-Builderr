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

// ---- Sauvegarde ciblée : seules les pages modifiées sont réécrites ----
const { planPageWrites, canonicalPage, toEditorPage } = require('../../services/content.js');

// Page telle que Payload la renvoie en depth 0 : identifiants de lignes, blockName, null.
const dbPage = (extra = {}) => ({
  id: 11,
  title: 'Accueil',
  slug: 'home',
  locale: 'fr',
  metaTitle: null,
  metaDescription: 'Bienvenue',
  navOrder: 0,
  hideFromNav: false,
  site: 4,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  layout: [
    { id: 'b1', blockName: null, blockType: 'hero', title: 'Bonjour', subtitle: '', ctaText: null, backgroundImage: null },
    { id: 'b2', blockName: null, blockType: 'gallery', title: 'Photos', images: [{ id: 'i1', url: 'https://img/a.jpg' }] },
    { id: 'b3', blockName: null, blockType: 'pricing', title: null, plans: [{ id: 'p1', name: 'Base', price: '0', isPopular: false, features: [{ id: 'f1', feature: 'x' }] }] },
  ],
  ...extra,
});
const input = (extra = {}) => ({
  title: 'Accueil',
  slug: 'home',
  metaDescription: 'Bienvenue',
  layout: [
    { blockType: 'hero', title: 'Bonjour', subtitle: '' },
    { blockType: 'gallery', title: 'Photos', images: ['https://img/a.jpg'] },
    { blockType: 'pricing', plans: [{ name: 'Base', price: '0', isPopular: false, features: [{ feature: 'x' }] }] },
  ],
  ...extra,
});
const sizes = (plan) => [plan.creates.length, plan.updates.length, plan.deletes.length];

test('planPageWrites (a) — page inchangée : aucune écriture', () => {
  assert.deepEqual(sizes(planPageWrites([dbPage()], [input()], new Set())), [0, 0, 0]);
});

test('planPageWrites (b) — page nouvelle : création avec navOrder = position', () => {
  const plan = planPageWrites([dbPage()], [input(), input({ slug: 'contact', title: 'Contact', locale: 'en' })], new Set());
  assert.deepEqual(sizes(plan), [1, 0, 0]);
  assert.equal(plan.creates[0].navOrder, 1);
  assert.equal(plan.creates[0].locale, 'en');
  assert.equal(plan.creates[0].hideFromNav, false);
});

test('planPageWrites (c) — texte, visibilité ou position modifiés : mise à jour', () => {
  assert.equal(planPageWrites([dbPage()], [input({ layout: [{ blockType: 'hero', title: 'Salut' }] })], []).updates.length, 1);
  const hidden = planPageWrites([dbPage()], [input({ hideFromNav: true })], []);
  assert.equal(hidden.updates[0].id, 11);
  assert.equal(hidden.updates[0].data.hideFromNav, true);
  const moved = planPageWrites([dbPage()], [input({ slug: 'a' }), input()], []);
  assert.equal(moved.updates[0].data.navOrder, 1);
  // '', 0 et false sont des valeurs : false → absent est une modification
  const [hero, gallery] = input().layout;
  const noFlag = { blockType: 'pricing', plans: [{ name: 'Base', price: '0', features: [{ feature: 'x' }] }] };
  assert.equal(planPageWrites([dbPage()], [input({ layout: [hero, gallery, noFlag] })], []).updates.length, 1);
});

test('planPageWrites (d) — galerie et identifiants : même forme canonique', () => {
  const [hero, , pricing] = input().layout;
  const asObjects = input({ layout: [hero, { blockType: 'gallery', title: 'Photos', images: [{ url: 'https://img/a.jpg' }] }, pricing] });
  assert.equal(canonicalPage(dbPage()), canonicalPage({ ...asObjects, navOrder: 0 }));
  // Ordre des clés indifférent
  assert.equal(canonicalPage({ navOrder: 0, ...input() }), canonicalPage({ ...input(), navOrder: 0 }));
});

test('planPageWrites (e) — suppressions : listées seulement, jamais une page renvoyée', () => {
  const other = dbPage({ id: 12, slug: 'equipe', navOrder: 1 });
  // Absente du corps (autre onglet) : conservée, à sa place
  assert.deepEqual(sizes(planPageWrites([dbPage(), other], [input()], new Set())), [0, 0, 0]);
  const listed = planPageWrites([dbPage(), other], [input()], new Set(['fr:equipe']));
  assert.deepEqual(listed.deletes.map((p) => p.id), [12]);
  assert.deepEqual(planPageWrites([dbPage(), other], [input()], ['fr:home']).deletes, []);
});

test('planPageWrites (f) — doublon en base : le plus ancien est supprimé', () => {
  const old = dbPage({ id: 5, updatedAt: '2023-01-01T00:00:00.000Z', title: 'Vieux' });
  const plan = planPageWrites([old, dbPage()], [input()], new Set());
  assert.deepEqual(sizes(plan), [0, 0, 1]);
  assert.equal(plan.deletes[0].id, 5);
});

test('planPageWrites — inchangé après aller-retour par readSitePages', () => {
  const docs = [dbPage(), dbPage({ id: 12, slug: 'en-home', locale: 'en', navOrder: 1, hideFromNav: true, metaDescription: null, layout: [] })];
  const roundTrip = JSON.parse(JSON.stringify(docs.map(toEditorPage)));
  assert.deepEqual(sizes(planPageWrites(docs, roundTrip, new Set())), [0, 0, 0]);
});

test('validatePagesBody — hideFromNav doit être un booléen', () => {
  assert.equal(validatePagesBody({ docs: [page({ hideFromNav: true })] }), null);
  assert.match(validatePagesBody({ docs: [page({ hideFromNav: 'oui' })] }), /hideFromNav/);
});

// ---- Identifiants de lignes : jamais renvoyés à Payload ----
// Une section dupliquée (ou un site dupliqué) porte les id de lignes de l'original : les
// renvoyer ferait échouer l'écriture (clé en double dans la table de la liste).
const collectIds = (value, out = []) => {
  if (Array.isArray(value)) value.forEach((v) => collectIds(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' || k === 'blockName') out.push(v);
      collectIds(v, out);
    }
  }
  return out;
};

test('toPageData — section dupliquée : aucun id de ligne transmis', () => {
  const { toPageData } = require('../../services/content.js');
  const faq = { blockType: 'faq', title: 'Questions', items: [{ id: 'r1', question: 'Q ?', answer: 'R.' }] };
  const pricing = dbPage().layout[2];
  const data = toPageData({ title: 'A', slug: 'a', layout: [faq, structuredClone(faq), pricing, structuredClone(pricing)] }, 0);
  assert.deepEqual(collectIds(data.layout), []);
  assert.equal(data.layout[1].items[0].question, 'Q ?');
  assert.equal(data.layout[3].plans[0].features[0].feature, 'x');
  assert.equal(data.layout[3].plans[0].isPopular, false);
});

test('toEditorPage — identifiants de lignes retirés (site dupliqué, copie de section)', () => {
  const page = toEditorPage(dbPage());
  assert.deepEqual(collectIds(page.layout), []);
  assert.deepEqual(page.layout[1].images, ['https://img/a.jpg']);
  assert.equal(page.layout[2].plans[0].features[0].feature, 'x');
});
