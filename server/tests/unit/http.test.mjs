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
