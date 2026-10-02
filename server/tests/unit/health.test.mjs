import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeChecks, createCachedProbe } = require('../../lib/health.js');

const build = { inProgress: false, queueLength: 0 };

test('summarizeChecks — tout va bien : ok/200 (contrôle informatif ignoré)', () => {
  assert.deepEqual(summarizeChecks({ database: 'ok', storage: 'ok', build }), { status: 'ok', httpStatus: 200 });
  assert.deepEqual(summarizeChecks({ database: 'ok', storage: 'ok', build: { inProgress: true, queueLength: 4 } }), { status: 'ok', httpStatus: 200 });
});

test('summarizeChecks — contrôle critique en échec : down/503', () => {
  assert.deepEqual(summarizeChecks({ database: 'down', storage: 'ok', build }), { status: 'down', httpStatus: 503 });
  assert.deepEqual(summarizeChecks({ database: 'ok', storage: 'down', build }), { status: 'down', httpStatus: 503 });
  assert.deepEqual(summarizeChecks({ database: 'down', storage: 'down' }), { status: 'down', httpStatus: 503 });
});

test('summarizeChecks — contrôle non critique en échec : degraded/200', () => {
  assert.deepEqual(summarizeChecks({ database: 'ok', storage: 'ok', mail: 'down', build }), { status: 'degraded', httpStatus: 200 });
  // Critique et non critique en échec : down l'emporte
  assert.deepEqual(summarizeChecks({ database: 'down', storage: 'ok', mail: 'down' }), { status: 'down', httpStatus: 503 });
});

test('summarizeChecks — contrôle critique absent ou valeur inattendue : jamais ok', () => {
  assert.deepEqual(summarizeChecks({ storage: 'ok' }), { status: 'down', httpStatus: 503 });
  assert.deepEqual(summarizeChecks({}), { status: 'down', httpStatus: 503 });
  assert.deepEqual(summarizeChecks({ database: undefined, storage: 'ok' }), { status: 'down', httpStatus: 503 });
  assert.deepEqual(summarizeChecks({ database: true, storage: 'ok' }), { status: 'down', httpStatus: 503 });
  // Un objet à la place d'un contrôle critique n'est pas « ok »
  assert.deepEqual(summarizeChecks({ database: {}, storage: 'ok' }), { status: 'down', httpStatus: 503 });
});

test('createCachedProbe — un seul calcul par période, appels simultanés partagés, jamais de refus', async () => {
  let t = 0;
  let calls = 0;
  const probe = createCachedProbe(async () => { calls++; return calls; }, 2000, () => t);
  const burst = await Promise.all(Array.from({ length: 200 }, () => probe()));
  assert.ok(burst.every((v) => v === 1));
  assert.equal(calls, 1);
  t = 1999;
  assert.equal(await probe(), 1);
  t = 2000;
  assert.equal(await probe(), 2);
  assert.equal(calls, 2);
});

test('createCachedProbe — un calcul en échec n’est pas mis en cache', async () => {
  let fail = true;
  const probe = createCachedProbe(async () => { if (fail) throw new Error('ko'); return 'ok'; }, 2000, () => 0);
  await assert.rejects(probe());
  fail = false;
  assert.equal(await probe(), 'ok');
});
