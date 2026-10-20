import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Payload simulé : services/media.js et services/content.js lisent getPayloadInstance à
// leur chargement (déstructuration) ; il est donc remplacé AVANT de les charger.
// Site « mon-site » (id 7) ; le média 30 appartient à un AUTRE site (id 8).
const SITE_ID = 7;
let mediaDocs = [];
let pageDocs = [];
let postDocs = [];
const updates = [];
const deletes = [];

const reset = () => {
  mediaDocs = [
    { id: 10, site: SITE_ID, filename: 'four.jpg', alt: 'Four', width: 1600, height: 1067, filesize: 2048, mimeType: 'image/jpeg', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 11, site: SITE_ID, filename: 'brouillon.png', alt: '', width: 2400, height: 1600, filesize: 4096, mimeType: 'image/png', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 12, site: SITE_ID, filename: 'libre.png', alt: '', width: 10, height: 10, filesize: 100, mimeType: 'image/png', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 13, site: SITE_ID, filename: 'logo.svg', alt: '', width: 10, height: 10, mimeType: 'image/svg+xml', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 30, site: 8, filename: 'etranger.png', alt: '', width: 10, height: 10, createdAt: '2026-10-03T00:00:00.000Z' },
  ];
  pageDocs = [
    { id: 1, site: SITE_ID, title: 'Accueil', slug: 'home', locale: 'fr', navOrder: 0, layout: [{ id: 'b1', blockType: 'hero', title: 'Bienvenue', backgroundImage: '/api/media/file/four.jpg' }] },
  ];
  postDocs = [
    { id: 2, site: SITE_ID, title: 'Noël', slug: 'noel', status: 'draft', coverImage: '/api/media/file/brouillon.png' },
  ];
  updates.length = 0;
  deletes.length = 0;
};

const matches = (doc, where) => {
  if (!where) return true;
  if (where.and) return where.and.every((w) => matches(doc, w));
  return Object.entries(where).every(([field, cond]) => {
    if ('equals' in cond) return doc[field] === cond.equals;
    if ('in' in cond) return cond.in.includes(doc[field]);
    return false;
  });
};

const fakePayload = {
  async find({ collection, where, limit }) {
    if (collection === 'payload_sites') return { docs: where.slug.equals === 'mon-site' ? [{ id: SITE_ID }] : [] };
    const source = { media: mediaDocs, pages: pageDocs, posts: postDocs }[collection] || [];
    const docs = source.filter((d) => matches(d, where));
    if (collection === 'media' && !where.and) docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { docs: limit ? docs.slice(0, limit) : docs };
  },
  async update({ collection, id, data }) {
    updates.push({ collection, id, data });
    const doc = mediaDocs.find((d) => d.id === id);
    Object.assign(doc, data);
    return { ...doc };
  },
  async delete(args) {
    deletes.push(args);
    mediaDocs = mediaDocs.filter((d) => d.id !== args.id);
    return {};
  },
};
require('../../core/payload.js').getPayloadInstance = () => fakePayload;
const { listSiteMedia, updateSiteMediaAlt, deleteSiteMedia, siteMediaManifest } = require('../../services/media.js');

test('listSiteMedia — médias du site seulement, usages des pages et des articles brouillons', async () => {
  reset();
  const items = await listSiteMedia('mon-site');
  assert.deepEqual(items.map((i) => i.id), ['10', '11', '12', '13']);
  const byName = Object.fromEntries(items.map((i) => [i.filename, i]));
  assert.deepEqual(byName['four.jpg'].usedIn, [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }]);
  assert.deepEqual(byName['brouillon.png'].usedIn, [{ type: 'post', title: 'Noël', slug: 'noel', draft: true }]);
  assert.deepEqual(byName['libre.png'].usedIn, []);
  assert.equal(byName['four.jpg'].url, '/api/media/file/four.jpg');
  assert.deepEqual(await listSiteMedia('site-inconnu'), []);
});

test('updateSiteMediaAlt — texte enregistré, média d’un autre site introuvable', async () => {
  reset();
  const item = await updateSiteMediaAlt('mon-site', '10', 'Four à céramique');
  assert.equal(item.alt, 'Four à céramique');
  assert.deepEqual(item.usedIn, [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }]);
  assert.deepEqual(updates, [{ collection: 'media', id: 10, data: { alt: 'Four à céramique' } }]);

  assert.equal(await updateSiteMediaAlt('mon-site', '30', 'Vol'), null);
  assert.equal(await updateSiteMediaAlt('mon-site', '999', 'Absent'), null);
  assert.equal(await updateSiteMediaAlt('site-inconnu', '10', 'X'), null);
  assert.equal(updates.length, 1, 'aucune autre écriture');
});

test('deleteSiteMedia — refusée si utilisée (sans suppression), effectuée sinon, introuvable ailleurs', async () => {
  reset();
  const inPage = await deleteSiteMedia('mon-site', '10');
  assert.equal(inPage.status, 'in_use');
  assert.equal(inPage.usedIn[0].title, 'Accueil');
  const inDraft = await deleteSiteMedia('mon-site', '11');
  assert.equal(inDraft.status, 'in_use');
  assert.equal(inDraft.usedIn[0].draft, true);
  assert.equal(deletes.length, 0, 'image utilisée supprimée');

  assert.deepEqual(await deleteSiteMedia('mon-site', '12'), { status: 'deleted', filename: 'libre.png' });
  assert.deepEqual(deletes, [{ collection: 'media', id: 12, overrideAccess: true }]);

  assert.deepEqual(await deleteSiteMedia('mon-site', '30'), { status: 'not_found' });
  assert.deepEqual(await deleteSiteMedia('mon-site', '12'), { status: 'not_found' });
  assert.deepEqual(await deleteSiteMedia('site-inconnu', '10'), { status: 'not_found' });
  assert.equal(deletes.length, 1);

  // Image retirée de la page : la suppression passe
  pageDocs[0].layout[0].backgroundImage = '';
  assert.equal((await deleteSiteMedia('mon-site', '10')).status, 'deleted');
});

test('siteMediaManifest — images publiables du site, aucune donnée sans site', async () => {
  reset();
  const manifest = await siteMediaManifest('mon-site');
  assert.deepEqual(manifest.docs.map((d) => d.filename), ['four.jpg', 'brouillon.png', 'libre.png']);
  assert.deepEqual(manifest.docs[0], { filename: 'four.jpg', alt: 'Four', width: 1600, height: 1067, variants: manifest.docs[0].variants });
  assert.ok(Array.isArray(manifest.docs[0].variants));
  assert.deepEqual(await siteMediaManifest('site-inconnu'), { docs: [] });
});
