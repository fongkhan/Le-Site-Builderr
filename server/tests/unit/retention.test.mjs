import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { purgeExpired, runRetention, RETENTION } = require('../../services/retention.js');
const { purgeExpiredSubmissionFiles } = require('../../services/submissions.js');

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

test('RETENTION — journal d’audit, historique des builds, messages des formulaires (12 mois, non réglable)', () => {
  assert.deepEqual(RETENTION.map((r) => [r.collection, r.env, r.days]), [
    ['audit_logs', 'AUDIT_RETENTION_DAYS', undefined],
    ['builds', 'BUILDS_RETENTION_DAYS', undefined],
    ['submissions', undefined, 365],
  ]);
});

test('purgeExpired — date limite par collection (défaut 365 jours)', async () => {
  const payload = spyPayload();
  const out = await purgeExpired(payload, { env: { BUILDS_RETENTION_DAYS: '30' }, now: NOW });
  const counts = payload.calls.filter(([k]) => k === 'count').map(([, a]) => a);
  assert.deepEqual(counts.map((a) => a.collection), ['audit_logs', 'builds', 'submissions']);
  assert.deepEqual(counts[0].where, { createdAt: { less_than: '2025-10-20T00:00:00.000Z' } });
  assert.deepEqual(counts[1].where, { createdAt: { less_than: '2026-09-20T00:00:00.000Z' } });
  assert.deepEqual(counts[2].where, { createdAt: { less_than: '2025-10-20T00:00:00.000Z' } });
  assert.ok(counts.every((a) => a.overrideAccess === true));
  assert.deepEqual(out, [{ collection: 'audit_logs', deleted: 0 }, { collection: 'builds', deleted: 0 }, { collection: 'submissions', deleted: 0 }]);
});

test('purgeExpired — AUDIT_RETENTION_DAYS=0 : journal jamais purgé', async () => {
  const payload = spyPayload({ counts: { audit_logs: 5 } });
  const out = await purgeExpired(payload, { env: { AUDIT_RETENTION_DAYS: '0' }, now: NOW });
  assert.ok(!payload.calls.some(([, a]) => a.collection === 'audit_logs'));
  assert.deepEqual(out.map((r) => r.collection), ['builds', 'submissions']);
});

// Message reçu le 01/10/2025, aucun autre depuis, boîte jamais ouverte : la purge
// quotidienne le supprime quand même (sans listSubmissions ni nouveau message).
test('purgeExpired — messages des formulaires de plus de 12 mois supprimés en base, même autres purges désactivées', async () => {
  const payload = spyPayload({ counts: { submissions: 1 } });
  const out = await purgeExpired(payload, { env: { AUDIT_RETENTION_DAYS: '0', BUILDS_RETENTION_DAYS: '0' }, now: NOW });
  const kinds = payload.calls.map(([k, a]) => `${k}:${a.collection}`);
  assert.deepEqual(kinds, ['count:submissions', 'deleteMany:submissions', 'create:audit_logs']);
  assert.deepEqual(payload.calls[1][1].where, { createdAt: { less_than: '2025-10-20T00:00:00.000Z' } });
  assert.equal(payload.calls[2][1].data.target, 'submissions');
  assert.match(payload.calls[2][1].data.details, /retention=365j/);
  assert.deepEqual(out, [{ collection: 'submissions', deleted: 1 }]);
});

// --- Repli JSON (mode sans base) : DATA_DIR/submissions_<slug>.json ---

const DAY = 24 * 60 * 60 * 1000;
const msg = (id, days) => ({ id, kind: 'contact', name: 'N', email: 'n@exemple.fr', message: 'M', read: false, createdAt: new Date(NOW - days * DAY).toISOString() });
const readList = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function dataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

test('purgeExpiredSubmissionFiles — messages de plus de 12 mois retirés de chaque site, autres fichiers intacts', () => {
  const dir = dataDir({
    'submissions_site-a.json': [msg('r', 2), msg('v', 400)],
    'submissions_site-b.json': [msg('v1', 366), msg('v2', 500)],
    'submissions_site-c.json': [msg('r1', 10), msg('r2', 364)],
    'submissions_..json': [msg('x', 400)],
    'stats_site-a.json': { '2020-01-01': 3 },
  });
  try {
    const before = fs.statSync(path.join(dir, 'submissions_site-c.json')).mtimeMs;
    assert.equal(purgeExpiredSubmissionFiles({ dir, now: NOW }), 3);
    assert.deepEqual(readList(path.join(dir, 'submissions_site-a.json')).map((m) => m.id), ['r']);
    assert.deepEqual(readList(path.join(dir, 'submissions_site-b.json')), []);
    assert.deepEqual(readList(path.join(dir, 'submissions_site-c.json')).map((m) => m.id), ['r1', 'r2']);
    assert.equal(fs.statSync(path.join(dir, 'submissions_site-c.json')).mtimeMs, before, 'fichier sans message périmé réécrit');
    assert.deepEqual(readList(path.join(dir, 'submissions_..json')).map((m) => m.id), ['x'], 'slug invalide : fichier ignoré');
    assert.deepEqual(readList(path.join(dir, 'stats_site-a.json')), { '2020-01-01': 3 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpiredSubmissionFiles — fichier illisible signalé, jamais écrasé ; dossier absent : rien', async () => {
  const dir = dataDir({ 'submissions_casse.json': '{ pas du json', 'submissions_ok.json': [msg('v', 400)] });
  try {
    const { result, errors } = await silenced(() => purgeExpiredSubmissionFiles({ dir, now: NOW }));
    assert.equal(result, 1);
    assert.equal(fs.readFileSync(path.join(dir, 'submissions_casse.json'), 'utf8'), '{ pas du json');
    assert.match(errors.join('\n'), /submissions_casse\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(purgeExpiredSubmissionFiles({ dir: path.join(os.tmpdir(), 'retention-absent-xyz'), now: NOW }), 0);
});

test('runRetention — sans base : fichiers de repli des messages purgés quand même', async () => {
  const dir = dataDir({ 'submissions_site-a.json': [msg('r', 1), msg('v', 370)] });
  try {
    assert.deepEqual(await runRetention(null, { now: NOW, dataDir: dir }), [{ collection: 'submissions (fichiers)', deleted: 1 }]);
    assert.deepEqual(readList(path.join(dir, 'submissions_site-a.json')).map((m) => m.id), ['r']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  assert.deepEqual(kinds, ['count:audit_logs', 'deleteMany:audit_logs', 'create:audit_logs', 'count:builds', 'count:submissions']);
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
  assert.deepEqual(result, [{ collection: 'builds', deleted: 4 }, { collection: 'submissions', deleted: 0 }]);
  assert.ok(payload.calls.some(([k, a]) => k === 'deleteMany' && a.collection === 'builds'));
  // Aucune entrée journal.purge pour la purge échouée
  assert.deepEqual(payload.calls.filter(([k]) => k === 'create').map(([, a]) => a.data.target), ['builds']);
  assert.match(errors[0], /Rétention/);
});

test('purgeExpired — sans Payload : rien', async () => {
  assert.deepEqual(await purgeExpired(null), []);
});
