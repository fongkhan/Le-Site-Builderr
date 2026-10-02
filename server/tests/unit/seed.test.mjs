import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSeedAdmin } = require('../../lib/seed.js');

test('resolveSeedAdmin — production sans SEED_ADMIN_EMAIL : seed refusé', () => {
  assert.equal(resolveSeedAdmin({ NODE_ENV: 'production' }), null);
  assert.equal(resolveSeedAdmin({ NODE_ENV: 'production', SEED_ADMIN_EMAIL: '  ' }), null);
});

test('resolveSeedAdmin — production avec SEED_ADMIN_EMAIL (normalisé)', () => {
  assert.equal(resolveSeedAdmin({ NODE_ENV: 'production', SEED_ADMIN_EMAIL: ' Ops@Exemple.FR ' }), 'ops@exemple.fr');
});

test('resolveSeedAdmin — hors production : admin@admin.com par défaut, surchargeable', () => {
  assert.equal(resolveSeedAdmin({}), 'admin@admin.com');
  assert.equal(resolveSeedAdmin({ NODE_ENV: 'development' }), 'admin@admin.com');
  assert.equal(resolveSeedAdmin({ SEED_ADMIN_EMAIL: 'dev@exemple.fr' }), 'dev@exemple.fr');
});
