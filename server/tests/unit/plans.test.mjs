import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PLANS, planOf, limitsFor, canCreateSite } = require('../../lib/plans.js');

test('planOf — repli sur l’offre par défaut', () => {
  assert.equal(planOf({ plan: 'pro' }).key, 'pro');
  assert.equal(planOf({ plan: 'inconnu' }).key, 'free');
  assert.equal(planOf({}).key, 'free');
  assert.equal(planOf(null).key, 'free');
});

test('limitsFor — illimité pour un admin ou en mode dev', () => {
  assert.equal(limitsFor({ plan: 'free' }, { isAdmin: true }), null);
  assert.equal(limitsFor({ devMode: true }), null);
  assert.deepEqual(limitsFor({ plan: 'pro' }), {
    plan: 'pro', label: PLANS.pro.label, maxSites: PLANS.pro.maxSites, aiDailyQuota: PLANS.pro.aiDailyQuota,
  });
});

test('canCreateSite — borne au nombre de sites de l’offre', () => {
  assert.equal(canCreateSite({ plan: 'free' }, 0).allowed, true);
  const refused = canCreateSite({ plan: 'free' }, 1);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /Découverte/);
  assert.equal(canCreateSite({ plan: 'pro' }, 4).allowed, true);
  assert.equal(canCreateSite({ plan: 'pro' }, 5).allowed, false);
  // Admin : jamais bloqué
  assert.equal(canCreateSite({ plan: 'free' }, 999, { isAdmin: true }).allowed, true);
});

test('canCreateSite — compteur invalide traité comme zéro', () => {
  assert.equal(canCreateSite({ plan: 'free' }, undefined).allowed, true);
  assert.equal(canCreateSite({ plan: 'free' }, NaN).allowed, true);
});
