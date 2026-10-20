import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isOrchestratorPagePath } = require('../../lib/spa-routes.js');

test('isOrchestratorPagePath — pages de l\'interface (routage côté navigateur)', () => {
  for (const p of ['/', '/login', '/sites', '/sites/a/design', '/admin-panel', '/reset-password', '/sites/a/']) {
    assert.equal(isOrchestratorPagePath(p), true, p);
  }
});

test('isOrchestratorPagePath — espaces du serveur et fichiers jamais remplacés par l\'interface', () => {
  for (const p of ['/admin', '/admin/login', '/api', '/api/x', '/_next/static/x', '/webhook/rebuild', '/preview/x', '/draft/x', '/internal/x', '/server/.env', '/x.php', '/favicon.svg', '/assets/index-abc.js', '/%2e%2e/%2e%2e/server/.env']) {
    assert.equal(isOrchestratorPagePath(p), false, p);
  }
  assert.equal(isOrchestratorPagePath(''), false);
  assert.equal(isOrchestratorPagePath(undefined), false);
});
