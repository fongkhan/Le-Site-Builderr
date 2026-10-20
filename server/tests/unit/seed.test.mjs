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

const { missingAdminMessage } = require('../../lib/seed.js');
const fakePayload = (adminCount) => ({
  calls: 0,
  async find(args) {
    this.calls++;
    assert.equal(args.collection, 'users');
    return { docs: Array.from({ length: adminCount }, (_, i) => ({ id: i + 1 })) };
  },
});

test('missingAdminMessage — production sans admin ni SEED_ADMIN_EMAIL : arrêt avec message clair', async () => {
  const msg = await missingAdminMessage(fakePayload(0), { NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'Un-Mot-De-Passe-Long-42' });
  assert.match(msg, /SEED_ADMIN_EMAIL/);
});

test('missingAdminMessage — production, SEED_ADMIN_EMAIL défini mais admin non créé : arrêt', async () => {
  const msg = await missingAdminMessage(fakePayload(0), { NODE_ENV: 'production', SEED_ADMIN_EMAIL: 'ops@exemple.fr' });
  assert.match(msg, /SEED_ADMIN_PASSWORD/);
});

test('missingAdminMessage — production avec un admin existant : démarrage normal', async () => {
  assert.equal(await missingAdminMessage(fakePayload(1), { NODE_ENV: 'production' }), null);
});

test('missingAdminMessage — hors production (dev, CI) : jamais bloquant, aucune requête', async () => {
  for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }]) {
    const payload = fakePayload(0);
    assert.equal(await missingAdminMessage(payload, env), null);
    assert.equal(payload.calls, 0);
  }
});
