import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Écritures non attendues par les requêtes (journal d'audit, statut de site) : l'arrêt
// propre (core/shutdown) doit les attendre avant de quitter, y compris celles lancées par
// la copie de lib/audit-events bundlée par Next (hooks Payload, autre instance de module).
const shutdown = require('../../core/shutdown.js');
const auditEventsPath = require.resolve('../../lib/audit-events.js');

// Faux Payload dont chaque écriture dure `ms` ; `rows` reçoit les entrées écrites.
function slowPayload(ms, rows = []) {
  return {
    rows,
    async create({ data }) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      rows.push(data);
      return data;
    },
  };
}

// Autre instance du module (comme le bundle de Next) : cache de require contourné.
function freshAuditEvents() {
  const saved = require.cache[auditEventsPath];
  delete require.cache[auditEventsPath];
  try {
    return require(auditEventsPath);
  } finally {
    require.cache[auditEventsPath] = saved;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test('writeAudit : écriture en cours comptée par pendingBackground jusqu’à sa fin', async () => {
  const ev = require(auditEventsPath);
  const payload = slowPayload(40);
  const done = ev.writeAudit(payload, { action: 'test.audit', target: 'x' });
  assert.equal(shutdown.pendingBackground(), 1);
  assert.equal(await done, true);
  await settle();
  assert.equal(shutdown.pendingBackground(), 0);
  assert.equal(payload.rows.length, 1);
});

test('auditInBackground (hooks Payload, autre instance du module) : tâche comptée dès l’appel', async () => {
  const bundled = freshAuditEvents();
  assert.notEqual(bundled, require(auditEventsPath), 'instance distincte');
  const payload = slowPayload(40);
  bundled.auditInBackground(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20)); // libellés des sites
    await bundled.writeAudit(payload, { action: 'utilisateur.modification', target: 'y' });
  });
  assert.equal(shutdown.pendingBackground(), 1, 'inscrite pendant le hook, avant tout await');
  await settle();
  assert.equal(shutdown.pendingBackground(), 0);
  assert.equal(payload.rows.length, 1);
});

test('logAudit (routes Express) : SIGTERM juste après la réponse → sortie après l’écriture', async () => {
  const rows = [];
  const payload = slowPayload(60, rows);
  // core/payload remplacé : l'instance Payload partagée est le faux Payload lent
  const payloadPath = require.resolve('../../core/payload.js');
  require.cache[payloadPath] = { id: payloadPath, filename: payloadPath, loaded: true, exports: { getPayloadInstance: () => payload } };
  const { logAudit } = require('../../core/audit.js');
  logAudit({ user: { email: 'admin@exemple.fr' } }, 'site.suppression', 'rv-audit-1');

  let exitedWithRows = null;
  const exited = new Promise((resolve) => {
    shutdown.createShutdown({
      getServer: () => null,
      activeRequests: () => 0, // réponse déjà envoyée
      getBuild: () => null,
      graceMs: 2000,
      pollMs: 5,
      exit: (code) => { exitedWithRows = rows.length; resolve(code); },
      log: { log() {}, warn() {}, error() {} },
    }).handleSignal('SIGTERM');
  });
  assert.equal(await exited, 0);
  assert.equal(exitedWithRows, 1, 'entrée d’audit écrite avant la sortie');
  assert.equal(rows[0].action, 'site.suppression');
});

test('updateSiteStatus : écriture du statut attendue par l’arrêt propre', async () => {
  const sitesStore = require('../../sites-store.js');
  const original = sitesStore.updateSiteStatus;
  let written = false;
  sitesStore.updateSiteStatus = () => new Promise((resolve) => setTimeout(() => { written = true; resolve({}); }, 40));
  try {
    require('../../services/sites.js').updateSiteStatus('rv-audit-2', 'active');
    assert.equal(shutdown.pendingBackground(), 1);
    await settle();
    assert.equal(written, true);
    assert.equal(shutdown.pendingBackground(), 0);
  } finally {
    sitesStore.updateSiteStatus = original;
  }
});
