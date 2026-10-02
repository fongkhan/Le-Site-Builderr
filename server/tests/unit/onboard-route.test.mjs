import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// POST /api/onboard (ouvert aux clients) : la réponse ne contient jamais les chemins
// serveur du site créé (documentRoot, repositoryPath) ni son jeton de domaine.
// Sans base ni IA : magasin de sites JSON temporaire, génération IA, quota, écriture
// des fichiers et dépôt remplacés AVANT le chargement de la route.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-'));
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

require('../../ai.js').runOnboard = async () => ({
  qualification: { site_name: 'Boulangerie Test', stack_requirements: {} },
  pages: null,
  theme: null,
});
const aiQuota = require('../../ai-quota.js');
aiQuota.reserveSlot = async () => ({ ok: true, quota: null });
aiQuota.releaseSlot = async () => {};
require('../../services/content.js').writeJsonFile = () => {};
const sitesService = require('../../services/sites.js');
sitesService.provisionRepository = () => false;
sitesService.resolveSiteDomain = async (slug) => `${slug}.example`;
sitesService.uniqueSlug = async (slug) => slug;
sitesService.attachSiteToUser = async () => {};
sitesService.purgeSiteData = () => {};

const router = require('../../routes/ai.js');

async function onboard(user) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/api/onboard' && l.route.methods.post);
  assert.ok(layer, 'route /api/onboard introuvable');
  const handlers = layer.route.stack.map((s) => s.handle);
  const handler = handlers[handlers.length - 1]; // après authenticate et requireAuth
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      set() { return this; },
      setHeader() {},
    };
    const req = { body: { name: `Site ${user.roles[0]} ${Date.now()}`, description: 'Une boulangerie' }, user, userSiteSlugs: new Set(), headers: {}, ip: '127.0.0.1' };
    Promise.resolve(handler(req, res, (err) => (err ? reject(err) : resolve({ status: 404 })))).catch(reject);
  });
}

test('onboarding client — aucun chemin serveur ni jeton de domaine dans la réponse', async () => {
  const { status, body } = await onboard({ id: 7, email: 'client@exemple.fr', roles: ['client'], plan: 'pro' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.site && body.site.slug, JSON.stringify(body));
  for (const key of ['documentRoot', 'repositoryPath', 'domainVerifyToken']) {
    assert.ok(!(key in body.site), `${key} renvoyé au client : ${JSON.stringify(body.site)}`);
  }
  assert.ok(!JSON.stringify(body).includes(path.sep + 'simulated_public_html'), 'chemin serveur dans la réponse');
});

test('onboarding admin — les chemins restent visibles pour un administrateur', async () => {
  const { status, body } = await onboard({ id: 1, email: 'admin@exemple.fr', roles: ['admin'] });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(typeof body.site.documentRoot, 'string');
  assert.equal(typeof body.site.repositoryPath, 'string');
});
