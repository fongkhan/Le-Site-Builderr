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
