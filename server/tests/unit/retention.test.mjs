import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { purgeExpired, RETENTION } = require('../../services/retention.js');

const NOW = Date.parse('2026-10-20T00:00:00.000Z');

// Faux Payload espion : count, db.deleteMany et create (journal.purge) enregistrés
function spyPayload({ counts = {}, failDelete = [] } = {}) {
  const calls = [];
  return {
    calls,
    count: async (args) => { calls.push(['count', args]); return { totalDocs: counts[args.collection] ?? 0 }; },
    create: async (args) => { calls.push(['create', args]); return { id: calls.length }; },
    db: {
      deleteMany: async (args) => {
        calls.push(['deleteMany', args]);
        if (failDelete.includes(args.collection)) throw new Error('base indisponible');
      },
    },
  };
}

const silenced = async (fn) => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  try { return { result: await fn(), errors }; } finally { console.error = original; }
};

test('RETENTION — journal d’audit puis historique des builds', () => {
  assert.deepEqual(RETENTION.map((r) => [r.collection, r.env]), [['audit_logs', 'AUDIT_RETENTION_DAYS'], ['builds', 'BUILDS_RETENTION_DAYS']]);
});

test('purgeExpired — date limite par collection (défaut 365 jours)', async () => {
  const payload = spyPayload();
  const out = await purgeExpired(payload, { env: { BUILDS_RETENTION_DAYS: '30' }, now: NOW });
  const counts = payload.calls.filter(([k]) => k === 'count').map(([, a]) => a);
  assert.deepEqual(counts.map((a) => a.collection), ['audit_logs', 'builds']);
  assert.deepEqual(counts[0].where, { createdAt: { less_than: '2025-10-20T00:00:00.000Z' } });
  assert.deepEqual(counts[1].where, { createdAt: { less_than: '2026-09-20T00:00:00.000Z' } });
  assert.ok(counts.every((a) => a.overrideAccess === true));
  assert.deepEqual(out, [{ collection: 'audit_logs', deleted: 0 }, { collection: 'builds', deleted: 0 }]);
});

test('purgeExpired — AUDIT_RETENTION_DAYS=0 : journal jamais purgé', async () => {
  const payload = spyPayload({ counts: { audit_logs: 5 } });
  const out = await purgeExpired(payload, { env: { AUDIT_RETENTION_DAYS: '0' }, now: NOW });
  assert.ok(!payload.calls.some(([, a]) => a.collection === 'audit_logs'));
  assert.deepEqual(out.map((r) => r.collection), ['builds']);
});

test('purgeExpired — rien d’expiré : ni suppression ni entrée journal.purge', async () => {
  const payload = spyPayload();
  await purgeExpired(payload, { env: {}, now: NOW });
  assert.ok(!payload.calls.some(([k]) => k === 'deleteMany' || k === 'create'));
});

test('purgeExpired — 3 entrées expirées : suppression en une requête puis journal.purge', async () => {
  const payload = spyPayload({ counts: { audit_logs: 3 } });
  const out = await purgeExpired(payload, { env: { AUDIT_RETENTION_DAYS: '90' }, now: NOW });
  const kinds = payload.calls.map(([k, a]) => `${k}:${a.collection}`);
  assert.deepEqual(kinds, ['count:audit_logs', 'deleteMany:audit_logs', 'create:audit_logs', 'count:builds']);
  const [, del] = payload.calls[1];
  assert.deepEqual(del.where, { createdAt: { less_than: '2026-07-22T00:00:00.000Z' } });
  const [, entry] = payload.calls[2];
  assert.equal(entry.data.action, 'journal.purge');
  assert.equal(entry.data.actor, 'système');
  assert.equal(entry.data.target, 'audit_logs');
  assert.match(entry.data.details, /entrees=3/);
  assert.match(entry.data.details, /avant=2026-07-22/);
  assert.match(entry.data.details, /retention=90j/);
  assert.equal(entry.overrideAccess, true);
  assert.deepEqual(out[0], { collection: 'audit_logs', deleted: 3 });
});

test('purgeExpired — suppression en échec : pas d’exception, l’autre collection est traitée', async () => {
  const payload = spyPayload({ counts: { audit_logs: 2, builds: 4 }, failDelete: ['audit_logs'] });
  const { result, errors } = await silenced(() => purgeExpired(payload, { env: {}, now: NOW }));
  assert.deepEqual(result, [{ collection: 'builds', deleted: 4 }]);
  assert.ok(payload.calls.some(([k, a]) => k === 'deleteMany' && a.collection === 'builds'));
  // Aucune entrée journal.purge pour la purge échouée
  assert.deepEqual(payload.calls.filter(([k]) => k === 'create').map(([, a]) => a.data.target), ['builds']);
  assert.match(errors[0], /Rétention/);
});

test('purgeExpired — sans Payload : rien', async () => {
  assert.deepEqual(await purgeExpired(null), []);
});
