import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Routes de sites (création, suppression, rollback, prévisualisation) appelées sans
// serveur : handlers extraits de router.stack (comme onboard-route.test.mjs). Racines de
// publication, dépôts, versions et brouillons dans un dossier temporaire, sites en JSON,
// écriture des fichiers de contenu neutralisée — tout est remplacé AVANT de charger les routes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-ops-'));
const config = require('../../core/config.js');
// Fichiers de données des sites de test : dossier data/ réel (articles importés), créé
// d'emblée et jamais supprimé ; sauvegardes dans le dossier temporaire
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.BACKUPS_DIR = path.join(tmp, 'backups');
config.BACKUP_KEEP = 50;
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.REPOSITORIES_DIR = path.join(tmp, 'repositories');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });
require('../../services/content.js').writeJsonFile = () => {};

const router = require('../../routes/sites.js');
const healthRouter = require('../../routes/health.js');
const build = require('../../services/build.js');
const shutdown = require('../../core/shutdown.js');

const ADMIN = { id: 1, email: 'admin@exemple.fr', roles: ['admin'] };

// Appelle le dernier handler (après authentification et contrôles d'accès) d'une route.
function call(targetRouter, method, routePath, { params = {}, query = {}, body = {} } = {}) {
  const layer = targetRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} introuvable`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const handler = handlers[handlers.length - 1];
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
      set() { return this; },
      setHeader() {},
    };
    const req = { method: method.toUpperCase(), params, query, body, user: ADMIN, userSiteSlugs: new Set(), headers: {}, ip: '127.0.0.1' };
    handler(req, res, (err) => (err ? reject(err) : resolve({ status: 404 })));
  });
}

const readSites = () => JSON.parse(fs.readFileSync(sitesFile, 'utf-8'));

test('POST /api/sites — restes d’un ancien site : nouveau slug, dossier existant intact', async () => {
  const leftover = path.join(config.PUBLIC_HTML_DIR, 'boutique-ops');
  fs.mkdirSync(leftover, { recursive: true });
  fs.writeFileSync(path.join(leftover, 'index.html'), '<h1>ancien site</h1>');

  const { status, body } = await call(router, 'post', '/api/sites', { body: { name: 'Boutique Ops' } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.site.slug, 'boutique-ops-2');
  assert.equal(body.renamedFrom, 'boutique-ops');
  assert.equal(path.resolve(body.site.documentRoot), path.join(config.PUBLIC_HTML_DIR, 'boutique-ops-2'));
  assert.equal(fs.readFileSync(path.join(leftover, 'index.html'), 'utf-8'), '<h1>ancien site</h1>', 'ancien dossier intact');

  // Versions conservées d'un ancien site : même règle
  fs.mkdirSync(path.join(config.RELEASES_DIR, 'galerie-ops', '1'), { recursive: true });
  const second = await call(router, 'post', '/api/sites', { body: { name: 'Galerie Ops' } });
  assert.equal(second.body.site.slug, 'galerie-ops-2');

  // Sans restes : slug d'origine, pas de renamedFrom
  const fresh = await call(router, 'post', '/api/sites', { body: { name: 'Neuf Ops' } });
  assert.equal(fresh.body.site.slug, 'neuf-ops');
  assert.ok(!('renamedFrom' in fresh.body));
});

test('POST /api/sites — nom déjà enregistré : 400', async () => {
  const { status, body } = await call(router, 'post', '/api/sites', { body: { name: 'Neuf Ops' } });
  assert.equal(status, 400);
  assert.match(body.error, /existe déjà/);
});

test('POST /api/sites — slug trop long : refus sans boucle infinie ni site créé', async () => {
  const before = readSites().length;
  const { status } = await call(router, 'post', '/api/sites', { body: { name: 'œ'.repeat(150) } });
  assert.equal(status, 500);
  assert.equal(readSites().length, before);
});

test('suppression en cours : rollback et prévisualisation refusés (409)', async () => {
  build.markDeleting('neuf-ops');
  try {
    const rollback = await call(router, 'post', '/api/sites/:slug/rollback', { params: { slug: 'neuf-ops' }, body: { release: '1' } });
    assert.equal(rollback.status, 409);
    assert.equal(rollback.body.error, 'Ce site est en cours de suppression.');
    const preview = await call(router, 'post', '/api/sites/:slug/preview-build', { params: { slug: 'neuf-ops' } });
    assert.equal(preview.status, 409);
    assert.equal(preview.body.error, 'Ce site est en cours de suppression.');
  } finally {
    build.unmarkDeleting('neuf-ops');
  }
  assert.equal(build.isBusy(), false, 'créneau libéré après les refus');
});

test('opération réservée sur le site (rollback en cours) : suppression refusée (409)', async () => {
  assert.equal(build.tryReserve('neuf-ops'), true);
  try {
    const del = await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'neuf-ops' }, query: { deleteFiles: 'true' } });
    assert.equal(del.status, 409);
  } finally {
    build.release();
  }
  assert.ok(readSites().some((s) => s.slug === 'neuf-ops'), 'site conservé');
});

test('suppression : copie du modèle créée par l’outil retirée, dépôt importé conservé', async () => {
  const sitesService = require('../../services/sites.js');
  const ownRepo = path.join(config.REPOSITORIES_DIR, 'neuf-ops');
  fs.mkdirSync(ownRepo, { recursive: true });
  fs.writeFileSync(path.join(ownRepo, sitesService.PROVISIONED_MARKER), 'x');
  const imported = path.join(config.REPOSITORIES_DIR, 'galerie-ops-2');
  fs.mkdirSync(imported, { recursive: true });
  fs.writeFileSync(path.join(imported, 'package.json'), '{}');
  const sites = readSites().map((s) => (['neuf-ops', 'galerie-ops-2'].includes(s.slug)
    ? { ...s, repositoryPath: path.join(config.REPOSITORIES_DIR, s.slug) }
    : s));
  fs.writeFileSync(sitesFile, JSON.stringify(sites));

  assert.equal((await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'neuf-ops' }, query: { deleteFiles: 'true' } })).status, 200);
  assert.equal(fs.existsSync(ownRepo), false, 'copie marquée supprimée');
  assert.equal((await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'galerie-ops-2' }, query: { deleteFiles: 'true' } })).status, 200);
  assert.ok(fs.existsSync(path.join(imported, 'package.json')), 'dépôt sans marqueur conservé');
  assert.equal(build.isSiteDeleting('neuf-ops'), false, 'marque de suppression retirée');
});

test('suppression : dépôt et dossier publié d’un autre site imbriqués dans ceux du site supprimé conservés', async () => {
  const sitesService = require('../../services/sites.js');
  const parentRepo = path.join(config.REPOSITORIES_DIR, 'rv-parent');
  const childRepo = path.join(parentRepo, 'child');
  const parentRoot = path.join(config.PUBLIC_HTML_DIR, 'rv-parent');
  const childRoot = path.join(parentRoot, 'child');
  // Deux copies du modèle créées par l'outil (marquées), la seconde dans la première
  for (const dir of [parentRepo, childRepo]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sitesService.PROVISIONED_MARKER), 'x');
  }
  fs.writeFileSync(path.join(childRepo, 'personnalise.astro'), 'code du client');
  fs.mkdirSync(childRoot, { recursive: true });
  fs.writeFileSync(path.join(parentRoot, 'index.html'), 'parent');
  fs.writeFileSync(path.join(childRoot, 'index.html'), 'enfant');
  fs.writeFileSync(sitesFile, JSON.stringify([
    ...readSites(),
    { slug: 'rv-parent', name: 'RV Parent', repositoryPath: parentRepo, documentRoot: parentRoot, status: 'active' },
    { slug: 'rv-child', name: 'RV Child', repositoryPath: childRepo, documentRoot: childRoot, status: 'active' },
  ]));

  const del = await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'rv-parent' }, query: { deleteFiles: 'true' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.ok(!readSites().some((s) => s.slug === 'rv-parent'), 'site supprimé');
  assert.equal(fs.readFileSync(path.join(childRepo, 'personnalise.astro'), 'utf-8'), 'code du client', 'dépôt de rv-child supprimé');
  assert.equal(fs.readFileSync(path.join(childRoot, 'index.html'), 'utf-8'), 'enfant', 'dossier publié de rv-child supprimé');

  // Plus aucun site dans le dépôt : la copie marquée d'un site est bien supprimée avec lui
  const lone = path.join(config.REPOSITORIES_DIR, 'rv-seul');
  fs.mkdirSync(lone, { recursive: true });
  fs.writeFileSync(path.join(lone, sitesService.PROVISIONED_MARKER), 'x');
  fs.writeFileSync(sitesFile, JSON.stringify([...readSites(), { slug: 'rv-seul', name: 'RV Seul', repositoryPath: lone, status: 'draft' }]));
  assert.equal((await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'rv-seul' } })).status, 200);
  assert.equal(fs.existsSync(lone), false);
});

test('suppression avec sauvegarde préalable : sauvegarde de sécurité ; non restaurable (> 1 Go) : 409, rien supprimé', async () => {
  const backups = require('../../services/backups.js');
  fs.writeFileSync(sitesFile, JSON.stringify([...readSites(), { slug: 'sauve-ops', name: 'Sauve Ops', status: 'draft' }, { slug: 'lourd-ops', name: 'Lourd Ops', status: 'draft' }]));

  const ok = await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'sauve-ops' }, query: { backup: 'true' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.backup, /^backup-[\dT-]+-securite\.zip$/);
  assert.ok(fs.existsSync(path.join(config.BACKUPS_DIR, ok.body.backup)));

  // Archive de plus de 1 Go (fichier creux) : restauration impossible depuis l'interface
  const realCreate = backups.createBackupArchive;
  const huge = 'backup-2026-01-01T00-00-00-securite.zip';
  backups.createBackupArchive = async () => {
    const file = path.join(config.BACKUPS_DIR, huge);
    fs.writeFileSync(file, '');
    fs.truncateSync(file, backups.RESTORE_MAX_ARCHIVE_BYTES + 1);
    return huge;
  };
  let refused;
  try {
    refused = await call(router, 'delete', '/api/sites/:slug', { params: { slug: 'lourd-ops' }, query: { backup: 'true', deleteFiles: 'true' } });
  } finally {
    backups.createBackupArchive = realCreate;
  }
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.error, /trop volumineuse.*n'a pas été supprimé/);
  assert.ok(readSites().some((s) => s.slug === 'lourd-ops'), 'site supprimé malgré une sauvegarde non restaurable');
  assert.equal(fs.existsSync(path.join(config.BACKUPS_DIR, huge)), false, 'archive inutilisable conservée');
  assert.equal(build.isSiteDeleting('lourd-ops'), false);
});

test('export puis import d’archive : informations légales reprises (normalisées)', async () => {
  const { PassThrough } = await import('node:stream');
  const AdmZip = require('adm-zip');
  const { purgeSiteData } = require('../../services/sites.js');
  const slug = `zz-legal-ops-${process.pid}`;
  const legal = { companyName: 'Atelier Légal', address: '1 rue X\n69000 Lyon', phone: '04 78 00 00 00', email: 'contact@atelier.example', publisherName: 'Camille' };
  await sitesStore.createSite({ slug, name: 'Légal Ops', status: 'draft', legal });

  // Export : réponse streamée (archiver) dans un flux
  const layer = router.stack.find((l) => l.route && l.route.path === '/api/sites/:slug/export' && l.route.methods.get);
  const handlers = layer.route.stack.map((s) => s.handle);
  const res = new PassThrough();
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  const ended = new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); });
  res.setHeader = () => {};
  res.status = function status(code) { this.statusCode = code; return this; };
  res.json = function json(payload) { this.payload = payload; this.end(); return this; };
  await handlers[handlers.length - 1]({ method: 'GET', params: { slug }, query: {}, body: {}, user: ADMIN, headers: {}, ip: '127.0.0.1' }, res, () => {});
  await ended;
  assert.equal(res.payload, undefined, JSON.stringify(res.payload));
  const zip = Buffer.concat(chunks);
  const meta = JSON.parse(new AdmZip(zip).readAsText('meta.json'));
  assert.equal(meta.legal.companyName, 'Atelier Légal');
  assert.equal(meta.legal.address, '1 rue X\n69000 Lyon');

  // Import : informations légales normalisées (11 clés), champ inconnu écarté
  const tampered = new AdmZip(zip);
  tampered.updateFile('meta.json', Buffer.from(JSON.stringify({ ...meta, legal: { ...meta.legal, inconnu: 'x', phone: 42 } })));
  const imp = await call(router, 'post', '/api/sites/import-archive', { body: tampered.toBuffer() });
  const importedSlug = imp.body?.site?.slug;
  try {
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    assert.equal(importedSlug, `${slug}-2`);
    const stored = (await sitesStore.getSiteBySlug(importedSlug)).legal;
    assert.equal(Object.keys(stored).length, 11);
    assert.equal(stored.companyName, 'Atelier Légal');
    assert.equal(stored.publisherName, 'Camille');
    assert.equal(stored.address, '1 rue X\n69000 Lyon');
    assert.equal(stored.phone, '');
    assert.equal(stored.inconnu, undefined);
  } finally {
    for (const s of [slug, importedSlug].filter(Boolean)) purgeSiteData(s);
  }
});

test('arrêt du serveur en cours : rollback et prévisualisation 503, sonde de disponibilité 503', async () => {
  shutdown.beginDrain();
  const preview = await call(router, 'post', '/api/sites/:slug/preview-build', { params: { slug: 'boutique-ops-2' } });
  assert.equal(preview.status, 503);
  assert.match(preview.body.error, /redémarre/);
  const rollback = await call(router, 'post', '/api/sites/:slug/rollback', { params: { slug: 'boutique-ops-2' }, body: { release: '1' } });
  assert.equal(rollback.status, 503);
  const ready = await call(healthRouter, 'get', '/api/health/ready');
  assert.deepEqual(ready, { status: 503, body: { status: 'stopping', checks: {} } });
  assert.equal(build.isBusy(), false, 'aucun créneau réservé');
});
