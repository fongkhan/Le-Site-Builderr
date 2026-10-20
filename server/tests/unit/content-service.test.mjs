import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Services de contenu (pages et articles) avec et sans base : fichiers de données dans un
// dossier temporaire et Payload en mémoire. Les modules lisent ces chemins et
// getPayloadInstance à leur chargement : tout est remplacé AVANT de charger content.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-service-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const config = require('../../core/config.js');
config.getSitePagesFile = (slug) => path.join(tmp, `site_${slug}_pages.json`);
config.getSiteThemeFile = (slug) => path.join(tmp, `site_${slug}_theme.json`);
config.getSitePostsFile = (slug) => path.join(tmp, `posts_${slug}.json`);
const sitesFile = path.join(tmp, 'sites.json');
config.SITES_FILE = sitesFile;
fs.writeFileSync(sitesFile, '[]');

let current = null;
require('../../core/payload.js').getPayloadInstance = () => current;
require('../../sites-store.js').init({ getPayload: () => current, sitesFile });
const content = require('../../services/content.js');

// --- Payload en mémoire : payload_sites, pages, posts ; journal des écritures ---
function memoryPayload() {
  const db = { payload_sites: [], pages: [], posts: [] };
  const journal = [];
  let nextId = 1;
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + (clock++) * 1000).toISOString();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const matches = (doc, where) => {
    if (!where) return true;
    return Object.entries(where).every(([field, cond]) => {
      if (field === 'and') return cond.every((w) => matches(doc, w));
      if ('equals' in cond) return doc[field] === cond.equals;
      if ('in' in cond) return cond.in.includes(doc[field]);
      throw new Error(`Condition non simulée : ${JSON.stringify(cond)}`);
    });
  };
  const table = (collection) => {
    if (!db[collection]) throw new Error(`Collection non simulée : ${collection}`);
    return db[collection];
  };
  return {
    db,
    journal,
    // Écritures seulement (les lectures ne sont pas journalisées)
    writes: (collection) => journal.filter((j) => !collection || j.collection === collection),
    insert(collection, data) {
      const doc = { ...clone(data), id: nextId++, updatedAt: data.updatedAt || stamp() };
      table(collection).push(doc);
      return doc;
    },
    async find({ collection, where, sort, limit, pagination }) {
      let docs = table(collection).filter((d) => matches(d, where));
      if (sort) {
        const desc = sort.startsWith('-');
        const field = sort.replace(/^-/, '');
        docs = [...docs].sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')) * (desc ? -1 : 1));
      }
      if (pagination !== false && limit) docs = docs.slice(0, limit);
      return { docs: clone(docs) };
    },
    async create({ collection, data }) {
      const doc = this.insert(collection, { ...data, updatedAt: undefined });
      journal.push({ op: 'create', collection, id: doc.id, slug: doc.slug });
      return clone(doc);
    },
    async update({ collection, id, data }) {
      const doc = table(collection).find((d) => d.id === id);
      if (!doc) throw new Error(`Document introuvable : ${collection}/${id}`);
      Object.assign(doc, clone(data), { updatedAt: stamp() });
      journal.push({ op: 'update', collection, id, slug: doc.slug });
      return clone(doc);
    },
    async delete({ collection, id, where }) {
      const rows = table(collection);
      const removed = rows.filter((d) => (id !== undefined ? d.id === id : matches(d, where)));
      db[collection] = rows.filter((d) => !removed.includes(d));
      for (const doc of removed) journal.push({ op: 'delete', collection, id: doc.id, slug: doc.slug });
      return id !== undefined ? clone(removed[0] || null) : { docs: clone(removed), errors: [] };
    },
  };
}

const page = (slug, title, extra = {}) => ({ title, slug, locale: 'fr', layout: [{ blockType: 'hero', title }], ...extra });
const post = (slug, extra = {}) => content.normalizePost({ title: `Article ${slug}`, slug, status: 'published', publishedAt: '2026-01-01T00:00:00.000Z', ...extra });
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
const slugsOf = (docs) => docs.map((d) => d.slug);
const sitePages = (mem, siteId) => mem.db.pages.filter((p) => p.site === siteId);
const sitePosts = (mem, siteId) => mem.db.posts.filter((p) => p.site === siteId);

test('(A) sans base — pages supprimées retirées du fichier, pages absentes du corps conservées', async () => {
  current = null;
  const file = config.getSitePagesFile('sans-base-a');
  writeJson(file, { docs: [page('home', 'Accueil'), page('equipe', 'Équipe'), page('ancienne', 'Ancienne')] });
  const r = await content.saveSitePages('sans-base-a', {
    docs: [page('home', 'Accueil modifié')],
    // home figure aussi dans les suppressions : une page renvoyée n'est jamais supprimée
    deleted: [{ slug: 'ancienne', locale: 'fr' }, { slug: 'home', locale: 'fr' }],
  });
  assert.deepEqual(r, { created: [], deleted: [] });
  const saved = readJson(file).docs;
  assert.deepEqual(slugsOf(saved), ['home', 'equipe']);
  assert.equal(saved[0].title, 'Accueil modifié');
});

test('(B) sans base — page en double dans le fichier : une seule lue et réécrite', async () => {
  current = null;
  const file = config.getSitePagesFile('sans-base-b');
  writeJson(file, { docs: [page('home', 'Première'), page('home', 'Seconde'), page('home', 'Home EN', { locale: 'en' })] });
  const read = await content.readSitePages('sans-base-b');
  assert.deepEqual(read.docs.map((p) => `${p.locale}:${p.slug}:${p.title}`), ['fr:home:Première', 'en:home:Home EN']);
  await content.saveSitePages('sans-base-b', { docs: [page('contact', 'Contact')] });
  assert.deepEqual(readJson(file).docs.map((p) => `${p.locale}:${p.slug}`), ['fr:contact', 'fr:home', 'en:home']);
});

test('(C) base — seules les pages modifiées sont écrites ; miroir écrit seulement après une écriture', async () => {
  const mem = memoryPayload();
  current = mem;
  const file = config.getSitePagesFile('base-c');
  const docs = [page('home', 'Accueil'), page('contact', 'Contact')];
  const first = await content.saveSitePages('base-c', { docs });
  assert.deepEqual(first, { created: ['fr:home', 'fr:contact'], deleted: [] });

  // Seul le titre de contact change : 1 mise à jour, aucune création ni suppression
  mem.journal.length = 0;
  const changed = [docs[0], page('contact', 'Nous contacter')];
  const second = await content.saveSitePages('base-c', { docs: changed });
  assert.deepEqual(second, { created: [], deleted: [] });
  const writes = mem.writes('pages');
  assert.deepEqual(writes.map((w) => `${w.op}:${w.slug}`), ['update:contact']);
  assert.deepEqual(readJson(file).docs.map((p) => p.title), ['Accueil', 'Nous contacter']);

  // Enregistrement identique : aucune opération, miroir non réécrit
  fs.writeFileSync(file, 'SENTINELLE');
  mem.journal.length = 0;
  await content.saveSitePages('base-c', { docs: changed });
  assert.deepEqual(mem.writes(), []);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'SENTINELLE');
});

test('(D, E) base — doublon : la page la plus ancienne supprimée, page d\'un autre onglet conservée puis supprimée sur demande', async () => {
  const mem = memoryPayload();
  current = mem;
  const site = mem.insert('payload_sites', { slug: 'base-d', name: 'Base D' });
  const toDoc = (p, extra) => ({ ...content.toPageData(p, 0), site: site.id, ...extra });
  const older = mem.insert('pages', toDoc(page('home', 'Accueil'), { updatedAt: '2025-01-01T00:00:00.000Z' }));
  const newer = mem.insert('pages', toDoc(page('home', 'Accueil'), { updatedAt: '2025-06-01T00:00:00.000Z' }));
  const other = mem.insert('pages', toDoc(page('autre-onglet', 'Autre onglet'), { navOrder: 1 }));
  const r = await content.saveSitePages('base-d', { docs: [page('home', 'Accueil')] });
  // Doublon purgé, mais jamais compté comme une page supprimée (journal d'audit)
  assert.deepEqual(r, { created: [], deleted: [] });
  assert.deepEqual(sitePages(mem, site.id).map((p) => p.id).sort(), [newer.id, other.id].sort());
  assert.ok(mem.writes('pages').some((w) => w.op === 'delete' && w.id === older.id));

  // (E) page listée dans les suppressions : supprimée
  const e = await content.saveSitePages('base-d', { docs: [page('home', 'Accueil')], deleted: [{ slug: 'autre-onglet' }] });
  assert.deepEqual(e.deleted, ['fr:autre-onglet']);
  assert.deepEqual(slugsOf(sitePages(mem, site.id)), ['home']);
});

test('(F) base — un miroir n\'est jamais repris en base (article supprimé dans l\'admin)', async () => {
  const mem = memoryPayload();
  current = mem;
  const site = mem.insert('payload_sites', { slug: 'base-f', name: 'Base F' });
  const file = config.getSitePostsFile('base-f');
  writeJson(file, { source: 'payload', docs: [post('supprime')] });
  await content.upsertPost('base-f', post('nouveau'));
  assert.deepEqual(slugsOf(sitePosts(mem, site.id)), ['nouveau']);
  assert.deepEqual(slugsOf((await content.readSitePosts('base-f')).docs), ['nouveau']);
  const mirror = readJson(file);
  assert.equal(mirror.source, 'payload');
  assert.deepEqual(slugsOf(mirror.docs), ['nouveau']);
});

test('(G) base — articles d\'un fichier importé repris avant la première écriture (sans titre ignoré)', async () => {
  const mem = memoryPayload();
  current = mem;
  const site = mem.insert('payload_sites', { slug: 'base-g', name: 'Base G' });
  writeJson(config.getSitePostsFile('base-g'), { docs: [post('importe'), { slug: 'sans-titre', status: 'published' }] });
  await content.upsertPost('base-g', post('nouveau', { publishedAt: '2026-02-01T00:00:00.000Z' }));
  assert.deepEqual(slugsOf(sitePosts(mem, site.id)).sort(), ['importe', 'nouveau']);
  assert.deepEqual(slugsOf((await content.readSitePosts('base-g')).docs), ['nouveau', 'importe']);
});

test('(H) readSitePosts — base vide : fichier importé lu, miroir ignoré ; site absent de la base : fichier ; brouillons écartés', async () => {
  const mem = memoryPayload();
  current = mem;
  mem.insert('payload_sites', { slug: 'vide-import', name: 'Import' });
  mem.insert('payload_sites', { slug: 'vide-miroir', name: 'Miroir' });
  writeJson(config.getSitePostsFile('vide-import'), { docs: [post('importe'), post('brouillon', { status: 'draft' })] });
  writeJson(config.getSitePostsFile('vide-miroir'), { source: 'payload', docs: [post('supprime')] });
  writeJson(config.getSitePostsFile('hors-base'), { docs: [post('json')] });

  assert.deepEqual(slugsOf((await content.readSitePosts('vide-import')).docs).sort(), ['brouillon', 'importe']);
  assert.deepEqual(slugsOf((await content.readSitePosts('vide-import', { publishedOnly: true })).docs), ['importe']);
  assert.deepEqual((await content.readSitePosts('vide-miroir')).docs, []);
  assert.deepEqual(slugsOf((await content.readSitePosts('hors-base')).docs), ['json']);
  assert.deepEqual(mem.writes(), [], 'une lecture n\'écrit jamais en base');
});

test('(I) base — deletePost supprime l\'article et réécrit le miroir', async () => {
  const mem = memoryPayload();
  current = mem;
  const site = mem.insert('payload_sites', { slug: 'base-i', name: 'Base I' });
  mem.insert('posts', { ...post('garde'), site: site.id });
  mem.insert('posts', { ...post('retire'), site: site.id });
  await content.deletePost('base-i', 'retire');
  assert.deepEqual(slugsOf(sitePosts(mem, site.id)), ['garde']);
  const mirror = readJson(config.getSitePostsFile('base-i'));
  assert.equal(mirror.source, 'payload');
  assert.deepEqual(slugsOf(mirror.docs), ['garde']);
});
