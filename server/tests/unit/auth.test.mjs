import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('../../auth.js');

// Réponse Express minimale : enregistre le statut et le corps JSON.
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
}

function run(mw, req) {
  const res = fakeRes();
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { res, passed };
}

const admin = { id: 1, roles: ['admin'] };
const client = { id: 2, roles: ['client'] };

test('requireAuth / requireAdmin', () => {
  assert.equal(run(auth.requireAuth, {}).res.statusCode, 401);
  assert.equal(run(auth.requireAuth, { user: client }).passed, true);
  assert.equal(run(auth.requireAdmin, { user: client }).res.statusCode, 403);
  assert.equal(run(auth.requireAdmin, { user: admin }).passed, true);
});

test('requireSiteAccess — ownership, slug requis et format canonique', () => {
  const guard = auth.requireSiteAccess((req) => req.query.site);
  const owner = { user: client, userSiteSlugs: new Set(['mon-site']) };
  assert.equal(run(guard, { ...owner, query: { site: 'mon-site' } }).passed, true);
  assert.equal(run(guard, { ...owner, query: { site: 'autre-site' } }).res.statusCode, 403);
  assert.equal(run(guard, { ...owner, query: {} }).res.statusCode, 400);
  // Traversée : refusée même pour un admin (le slug finit dans des chemins de fichiers)
  assert.equal(run(guard, { user: admin, query: { site: '../../etc' } }).res.statusCode, 400);
  assert.equal(run(guard, { user: admin, query: { site: 'Mon Site' } }).res.statusCode, 400);
  assert.equal(run(guard, { user: admin, query: { site: 'n-importe-quel-site' } }).passed, true);
  assert.equal(run(guard, { query: { site: 'mon-site' } }).res.statusCode, 401);
});

test('isAdmin', () => {
  assert.equal(auth.isAdmin(admin), true);
  assert.equal(auth.isAdmin(client), false);
  assert.equal(auth.isAdmin(null), false);
});
