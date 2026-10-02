import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isExpressRoute } = require('../../core/http.js');

test('isExpressRoute — routes Express custom (corps JSON parsé)', () => {
  for (const p of ['/api/sites', '/api/sites/mon-site/export', '/api/site-pages', '/api/theme', '/webhook/rebuild', '/internal/site-pages', '/api/contact/x', '/api/admin/backups']) {
    assert.equal(isExpressRoute(p), true, p);
  }
});

test('isExpressRoute — routes déléguées à Next/Payload (flux intact)', () => {
  for (const p of ['/api/users/login', '/api/users/me', '/api/media', '/admin', '/', '/api/sitesx', '/api/themes']) {
    assert.equal(isExpressRoute(p), false, p);
  }
});

test('isPublicRoute — seuls le contact et le beacon sont publics', async () => {
  const { isPublicRoute } = require('../../core/http.js');
  assert.equal(isPublicRoute('/api/contact/mon-site'), true);
  assert.equal(isPublicRoute('/api/stats/hit/mon-site'), true);
  assert.equal(isPublicRoute('/api/sites/mon-site/stats'), false);
  assert.equal(isPublicRoute('/api/stats'), false);
  assert.equal(isPublicRoute('/api/contactx'), false);
});

test('trustProxySetting — désactivation explicite et valeurs Express', () => {
  const { trustProxySetting } = require('../../core/http.js');
  for (const off of [undefined, '', 'false', '0', '  ']) assert.equal(trustProxySetting(off), null, String(off));
  assert.equal(trustProxySetting('1'), 1);
  assert.equal(trustProxySetting('2'), 2);
  assert.equal(trustProxySetting('true'), 1);
  assert.equal(trustProxySetting('loopback'), 'loopback');
});

test('asyncHandler — une promesse rejetée est transmise à next()', async () => {
  const { asyncHandler } = require('../../core/http.js');
  const boom = new Error('boom');
  const received = await new Promise((resolve) => {
    asyncHandler(async () => { throw boom; })({}, {}, resolve);
  });
  assert.equal(received, boom);
  const errMw = (err, req, res, next) => next(err);
  assert.equal(asyncHandler(errMw), errMw); // middlewares d'erreur inchangés
});

test('jsonLimitFor — limite du corps JSON par méthode et par route', () => {
  const { jsonLimitFor } = require('../../core/http.js');
  assert.equal(jsonLimitFor('GET', '/api/site-pages'), null);
  assert.equal(jsonLimitFor('DELETE', '/api/sites/demo'), null);
  assert.equal(jsonLimitFor('HEAD', '/api/sites'), null);
  assert.equal(jsonLimitFor('OPTIONS', '/api/onboard'), null);
  assert.equal(jsonLimitFor('POST', '/api/onboard'), '10mb');
  assert.equal(jsonLimitFor('POST', '/api/site-pages'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/site-posts'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/theme'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/sites'), '256kb');
  assert.equal(jsonLimitFor('PUT', '/api/sites/demo'), '256kb');
  assert.equal(jsonLimitFor('POST', '/api/onboardx'), '256kb');
});
