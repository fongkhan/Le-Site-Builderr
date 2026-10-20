import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sitesStore = require('../../sites-store.js');
const { getSitePagesFile } = require('../../core/config.js');

// Payload simulé : collections en mémoire, filtres `site` / `id` (equals, not_equals).
function fakePayload(collections) {
  const matches = (doc, where = {}) => Object.entries(where).every(([field, cond]) => {
    const value = doc[field] && typeof doc[field] === 'object' ? doc[field].id : doc[field];
    if ('equals' in cond) return String(value) === String(cond.equals);
    if ('not_equals' in cond) return String(value) !== String(cond.not_equals);
    return true;
  });
  const updates = [];
  return {
    updates,
    async find({ collection, where }) {
      return { docs: (collections[collection] || []).filter((d) => matches(d, where)) };
    },
    async update({ collection, id, data }) {
      const doc = collections[collection].find((d) => d.id === id);
      Object.assign(doc, data);
      updates.push({ collection, id, data });
      return doc;
    },
  };
}

// Fichier JSON de repli d'un site de test (nettoyé à la fin)
const FALLBACK_SLUG = 'zz-unit-media-jumeau-json';
const dataDir = path.dirname(getSitePagesFile(FALLBACK_SLUG));
const createdDataDir = !fs.existsSync(dataDir);
after(() => {
  fs.rmSync(getSitePagesFile(FALLBACK_SLUG), { force: true });
  if (createdDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('reassignSharedMedia — un média cité par un jumeau lui est rattaché, les autres restent au site supprimé', async () => {
  const payload = fakePayload({
    payload_sites: [{ id: 1, slug: 'source' }, { id: 2, slug: 'jumeau' }, { id: 3, slug: 'autre' }],
    media: [
      { id: 'm1', site: 1, filename: 'photo.jpg' },
      { id: 'm2', site: 1, filename: 'seule.png' },
      { id: 'm3', site: 3, filename: 'photo.jpg' }, // homonyme d'un autre site : jamais touché
    ],
    pages: [
      { id: 'p1', site: 1, blocks: [{ image: '/api/media/file/photo.jpg' }, { image: '/api/media/file/seule.png' }] },
      // Jumeau dupliqué avant la copie des images : cite toujours le fichier du site source
      { id: 'p2', site: 2, blocks: [{ image: '/api/media/file/photo.jpg' }] },
    ],
    posts: [],
    themes: [],
  });

  const moved = await sitesStore.reassignSharedMedia(payload, 1, {});
  assert.equal(moved, 1);
  assert.deepEqual(payload.updates, [{ collection: 'media', id: 'm1', data: { site: 2 } }]);
});

test('reassignSharedMedia — citation dans un article ou dans le JSON de repli d’un autre site', async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getSitePagesFile(FALLBACK_SLUG), JSON.stringify({ docs: [{ html: '<img src="/media/banniere.webp">' }] }));
  const payload = fakePayload({
    payload_sites: [{ id: 10, slug: 'source' }, { id: 11, slug: 'blog' }, { id: 12, slug: FALLBACK_SLUG }],
    media: [
      { id: 'a', site: 10, filename: 'article.gif' },
      { id: 'b', site: 10, filename: 'banniere.webp' },
    ],
    pages: [],
    posts: [{ id: 'x', site: { id: 11 }, content: 'texte ![](/api/media/file/article.gif)' }],
    themes: [],
  });

  assert.equal(await sitesStore.reassignSharedMedia(payload, 10, {}), 2);
  const bySite = Object.fromEntries(payload.updates.map((u) => [u.id, u.data.site]));
  assert.deepEqual(bySite, { a: 11, b: 12 });
});

test('uniqueSlug — un brouillon resté sous un slug le rend indisponible pour un nouveau site', async () => {
  const os = await import('node:os');
  const { DRAFTS_DIR } = require('../../core/config.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-store-'));
  const sitesFile = path.join(tmp, 'sites.json');
  fs.writeFileSync(sitesFile, '[]');
  sitesStore.init({ getPayload: () => null, sitesFile });
  const { uniqueSlug } = require('../../services/sites.js');

  const slug = 'zz-unit-brouillon-orphelin';
  const draftDir = path.join(DRAFTS_DIR, slug);
  const createdDrafts = !fs.existsSync(DRAFTS_DIR);
  try {
    assert.equal(await uniqueSlug(slug), slug);
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, 'index.html'), 'ancien brouillon');
    assert.equal(await uniqueSlug(slug), `${slug}-2`);
  } finally {
    fs.rmSync(createdDrafts ? DRAFTS_DIR : draftDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reassignSharedMedia — aucun média cité ailleurs : rien n’est rattaché', async () => {
  const payload = fakePayload({
    payload_sites: [{ id: 1, slug: 'seul' }],
    media: [{ id: 'm', site: 1, filename: 'photo.jpg' }],
    pages: [{ id: 'p', site: 1, blocks: [{ image: '/api/media/file/photo.jpg' }] }],
    posts: [],
    themes: [],
  });
  assert.equal(await sitesStore.reassignSharedMedia(payload, 1, {}), 0);
  assert.equal(payload.updates.length, 0);
});

// ---- Informations légales (mentions légales, confidentialité) ----

test('informations légales — repli JSON : 11 chaînes vides à la création, objet relu après mise à jour', async () => {
  const os = await import('node:os');
  const { LEGAL_KEYS } = require('../../lib/legal.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-store-legal-'));
  const sitesFile = path.join(tmp, 'sites.json');
  fs.writeFileSync(sitesFile, '[]');
  sitesStore.init({ getPayload: () => null, sitesFile });
  try {
    const created = await sitesStore.createSite({ slug: 'zz-legal', name: 'Légal' });
    assert.deepEqual(Object.keys(created.legal), LEGAL_KEYS);
    assert.ok(Object.values(created.legal).every((v) => v === ''));

    const legal = { ...created.legal, companyName: 'Société <b>X</b>', address: 'l1\nl2' };
    const updated = await sitesStore.updateSite('zz-legal', { legal });
    assert.equal(updated.legal.companyName, 'Société <b>X</b>');
    const reread = await sitesStore.getSiteBySlug('zz-legal');
    assert.deepEqual(reread.legal, legal);
    // Une mise à jour sans `legal` ne le touche pas
    await sitesStore.updateSite('zz-legal', { name: 'Autre nom' });
    assert.deepEqual((await sitesStore.getSiteBySlug('zz-legal')).legal, legal);
    assert.equal(await sitesStore.updateSite('absent', { legal }), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('informations légales — Payload : l’objet complet est transmis à payload.update', async () => {
  const payload = fakePayload({ payload_sites: [{ id: 5, slug: 'avec-base', name: 'Base' }] });
  sitesStore.init({ getPayload: () => payload, sitesFile: null });
  try {
    const site = await sitesStore.updateSite('avec-base', { legal: { companyName: ' Société ', inconnu: 'x' } });
    assert.equal(payload.updates.length, 1);
    const sent = payload.updates[0].data.legal;
    assert.equal(sent.companyName, 'Société');
    assert.equal(Object.keys(sent).length, 11);
    assert.ok(!('inconnu' in sent));
    assert.equal(site.legal.companyName, 'Société');
  } finally {
    sitesStore.init({ getPayload: () => null, sitesFile: null });
  }
});
