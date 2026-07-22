import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeLimit } = require('../../ai-quota.js');

// isAdmin injectable : un admin est illimité quel que soit son quota
const notAdmin = () => false;
const isAdmin = () => true;

test('computeLimit — admin et devMode = illimité (null)', () => {
  assert.equal(computeLimit({ id: 1 }, '10', isAdmin), null);
  assert.equal(computeLimit({ id: 1, devMode: true }, '10', notAdmin), null);
  assert.equal(computeLimit(null, '10', notAdmin), null);
});

test('computeLimit — quota personnel prioritaire, 0 respecté', () => {
  assert.equal(computeLimit({ id: 1, aiDailyQuota: 3 }, '10', notAdmin), 3);
  // 0 est une valeur légitime (compte suspendu), pas un « non défini »
  assert.equal(computeLimit({ id: 1, aiDailyQuota: 0 }, '10', notAdmin), 0);
});

test('computeLimit — repli sur AI_DAILY_QUOTA puis 10', () => {
  assert.equal(computeLimit({ id: 1 }, '5', notAdmin), 5);
  assert.equal(computeLimit({ id: 1 }, '0', notAdmin), 0);
  assert.equal(computeLimit({ id: 1 }, undefined, notAdmin), 10);
  assert.equal(computeLimit({ id: 1 }, 'abc', notAdmin), 10);
});
