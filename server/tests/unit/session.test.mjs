import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { authCookieOptions } = require('../../lib/session.js');
const { publicSiteView } = require('../../lib/sites-view.js');

test('authCookieOptions — Secure en production, Lax toujours', () => {
  assert.deepEqual(authCookieOptions({ NODE_ENV: 'production' }), { sameSite: 'Lax', secure: true });
  assert.deepEqual(authCookieOptions({}), { sameSite: 'Lax', secure: false });
});

test('authCookieOptions — COOKIE_SECURE prioritaire', () => {
  assert.equal(authCookieOptions({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }).secure, false);
  assert.equal(authCookieOptions({ COOKIE_SECURE: 'true' }).secure, true);
  assert.equal(authCookieOptions({ NODE_ENV: 'production', COOKIE_SECURE: '' }).secure, true);
});

test('publicSiteView — chemins serveur retirés pour un client, conservés pour un admin', () => {
  const site = { slug: 'demo', name: 'Démo', documentRoot: '/srv/www/demo', repositoryPath: '/srv/repos/demo', domainVerifyToken: 'tok', previewPath: '/preview/demo/' };
  const view = publicSiteView(site, { isAdmin: false });
  assert.equal('documentRoot' in view, false);
  assert.equal('repositoryPath' in view, false);
  assert.equal('domainVerifyToken' in view, false);
  assert.equal(view.previewPath, '/preview/demo/');
  assert.equal(site.documentRoot, '/srv/www/demo'); // objet d'origine intact
  assert.deepEqual(publicSiteView(site, { isAdmin: true }), site);
  assert.equal('documentRoot' in publicSiteView(site), false); // client par défaut
});
