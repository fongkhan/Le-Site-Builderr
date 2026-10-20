import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Routes /api/sites/:slug/media : service et registre des sites remplacés AVANT le
// chargement de la route ; authentification simulée (l'utilisateur est fourni par la
// requête) pour exécuter la pile complète.
const auth = require('../../auth.js');
auth.authenticate = (req, res, next) => next();
auth.requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentification requise.' }));

const sitesStore = require('../../sites-store.js');
sitesStore.getSiteBySlug = async (slug) => (slug === 'mon-site' || slug === 'autre-site' ? { slug } : null);

const calls = [];
const mediaService = require('../../services/media.js');
mediaService.listSiteMedia = async (slug) => {
  calls.push(['list', slug]);
  return [{ id: '1', filename: 'a.png', usedIn: [] }];
};
mediaService.updateSiteMediaAlt = async (slug, id, alt) => {
  calls.push(['alt', slug, id, alt]);
  return id === '404' ? null : { id, alt };
};
mediaService.deleteSiteMedia = async (slug, id) => {
  calls.push(['delete', slug, id]);
  if (id === '404') return { status: 'not_found' };
  if (id === '409') return { status: 'in_use', usedIn: [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }] };
  return { status: 'deleted', filename: 'a.png' };
};

const router = require('../../routes/media.js');

const ADMIN = { id: 1, email: 'admin@exemple.fr', roles: ['admin'] };
const CLIENT = { id: 2, email: 'client@exemple.fr', roles: ['client'] };

// Exécute toute la pile de la route (contrôles d'accès compris) jusqu'à la réponse.
function call(method, path, { user = ADMIN, body, slug = 'mon-site', id } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method} ${path} introuvable`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, handled: true }); return this; },
      setHeader() {},
    };
    const req = {
      method: method.toUpperCase(),
      params: { slug, ...(id !== undefined ? { id } : {}) },
      body,
      user,
      userSiteSlugs: new Set(['mon-site']),
      headers: {},
      ip: '127.0.0.1',
    };
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      const handler = handlers[i++];
      if (!handler) return resolve({ status: 404, body: null });
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (e) {
        reject(e);
      }
    };
    next();
  });
}

test('GET /api/sites/:slug/media — liste, site inconnu 404', async () => {
  calls.length = 0;
  const ok = await call('get', '/api/sites/:slug/media');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { items: [{ id: '1', filename: 'a.png', usedIn: [] }] });
  const unknown = await call('get', '/api/sites/:slug/media', { slug: 'inconnu' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'Site non trouvé.');
  assert.deepEqual(calls, [['list', 'mon-site']]);
});

test('PATCH — alt non-chaîne 400, id invalide 400, texte nettoyé, introuvable 404', async () => {
  calls.length = 0;
  const notString = await call('patch', '/api/sites/:slug/media/:id', { id: '5', body: { alt: 42 } });
  assert.equal(notString.status, 400);
  assert.equal(notString.body.error, 'Le texte alternatif doit être une chaîne de caractères.');
  const missing = await call('patch', '/api/sites/:slug/media/:id', { id: '5', body: {} });
  assert.equal(missing.status, 400);
  const badId = await call('patch', '/api/sites/:slug/media/:id', { id: 'abc', body: { alt: 'x' } });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error, 'Image invalide.');
  assert.equal(calls.length, 0, 'service appelé malgré une requête invalide');

  const ok = await call('patch', '/api/sites/:slug/media/:id', { id: '5', body: { alt: `  Un\n four ${'x'.repeat(300)}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.alt.length, 200);
  assert.ok(ok.body.alt.startsWith('Un four x'));
  const notFound = await call('patch', '/api/sites/:slug/media/:id', { id: '404', body: { alt: 'x' } });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, 'Image introuvable.');
});

test('DELETE — 400, 404, 409 avec usages, 200', async () => {
  assert.equal((await call('delete', '/api/sites/:slug/media/:id', { id: 'abc' })).status, 400);
  const notFound = await call('delete', '/api/sites/:slug/media/:id', { id: '404' });
  assert.equal(notFound.status, 404);
  const inUse = await call('delete', '/api/sites/:slug/media/:id', { id: '409' });
  assert.equal(inUse.status, 409);
  assert.match(inUse.body.error, /^Image utilisée dans : page « Accueil »\. Retirez-la/);
  assert.deepEqual(inUse.body.usedIn, [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }]);
  const ok = await call('delete', '/api/sites/:slug/media/:id', { id: '7' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { success: true });
});

test('contrôle d’accès au site dans la pile de chaque route', async () => {
  calls.length = 0;
  for (const [method, path, extra] of [
    ['get', '/api/sites/:slug/media', {}],
    ['patch', '/api/sites/:slug/media/:id', { id: '5', body: { alt: 'x' } }],
    ['delete', '/api/sites/:slug/media/:id', { id: '5' }],
  ]) {
    const foreign = await call(method, path, { ...extra, user: CLIENT, slug: 'autre-site' });
    assert.equal(foreign.status, 403, `${method} sur le site d’un autre client`);
    const own = await call(method, path, { ...extra, user: CLIENT, slug: 'mon-site' });
    assert.equal(own.status, 200, `${method} sur son propre site`);
    const anonymous = await call(method, path, { ...extra, user: null });
    assert.equal(anonymous.status, 401, `${method} anonyme`);
  }
  assert.ok(calls.every((c) => c[1] === 'mon-site'), JSON.stringify(calls));
});
