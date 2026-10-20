import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shutdown = require('../../core/shutdown.js');

// Arrêt propre (core/shutdown) avec des dépendances factices : serveur, service de build,
// horloge réelle mais délais courts. `exit` est enregistré au lieu de quitter.
function harness({ requests = () => 0, buildBusy = () => false, beginShutdownResult = false, graceMs = 1000, forceAfterMs = 1000, server = 'default', pending } = {}) {
  const calls = [];
  const logs = [];
  let exitResolve;
  const exited = new Promise((resolve) => { exitResolve = resolve; });
  const fakeServer = server === 'default'
    ? { close: () => calls.push('close'), closeAllConnections: () => calls.push('closeAllConnections') }
    : server;
  const build = {
    beginShutdown: () => { calls.push('beginShutdown'); return beginShutdownResult; },
    isBusy: () => buildBusy(),
    requeueCurrentForRestart: () => { calls.push('requeueCurrentForRestart'); return true; },
    persistQueue: () => calls.push('persistQueue'),
  };
  const log = {
    log: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push(a.join(' ')),
    error: (...a) => logs.push(a.join(' ')),
  };
  const exits = [];
  const instance = shutdown.createShutdown({
    getServer: () => fakeServer,
    activeRequests: requests,
    getBuild: () => build,
    ...(pending ? { pendingBackground: pending } : {}),
    graceMs,
    forceAfterMs,
    pollMs: 10,
    exit: (code) => { exits.push(code); calls.push(`exit(${code})`); exitResolve(code); },
    log,
  });
  return { instance, calls, logs, exits, exited };
}

test('arrêt au repos : close → beginShutdown → persistQueue → exit(0), une seule fois', async () => {
  const h = harness();
  h.instance.handleSignal('SIGTERM');
  assert.equal(await h.exited, 0);
  assert.deepEqual(h.calls, ['close', 'beginShutdown', 'persistQueue', 'exit(0)']);
  assert.ok(shutdown.isShuttingDown(), 'arrêt signalé aux autres modules');
  assert.ok(h.logs.some((l) => l.includes('SIGTERM reçu : arrêt propre')));
  assert.ok(h.logs.some((l) => l.includes('Arrêt propre terminé')));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(h.exits, [0], 'exit appelé une seule fois');
});

test('requête en cours : la sortie attend sa fin', async () => {
  let active = 1;
  setTimeout(() => { active = 0; }, 50);
  const started = Date.now();
  const h = harness({ requests: () => active });
  h.instance.handleSignal('SIGINT');
  assert.equal(await h.exited, 0);
  assert.ok(Date.now() - started >= 45, 'sortie après la fin de la requête');
  assert.ok(!h.calls.includes('closeAllConnections'));
});

test('build toujours occupé au-delà du délai : remis en file, connexions coupées, exit(0)', async () => {
  const h = harness({ buildBusy: () => true, beginShutdownResult: true, graceMs: 100 });
  h.instance.handleSignal('SIGTERM');
  assert.equal(await h.exited, 0);
  assert.ok(h.calls.includes('requeueCurrentForRestart'));
  assert.ok(h.calls.includes('closeAllConnections'));
  assert.ok(h.logs.some((l) => l.includes('Build en cours interrompu')));
  assert.ok(h.logs.some((l) => l.includes('Délai dépassé') && l.includes('publication en cours')));
  // La file est sauvegardée juste avant la sortie
  assert.deepEqual(h.calls.slice(-2), ['persistQueue', 'exit(0)']);
});

test('second signal : ignoré dans la fenêtre des signaux relayés, arrêt forcé au-delà', async () => {
  let active = 1;
  const h = harness({ requests: () => active, graceMs: 5000, forceAfterMs: 100 });
  h.instance.handleSignal('SIGINT');
  h.instance.handleSignal('SIGTERM'); // relayé par tsx ou le lanceur
  assert.deepEqual(h.exits, []);
  assert.ok(h.logs.some((l) => l.includes('signal relayé ignoré')));
  await new Promise((r) => setTimeout(r, 150));
  h.instance.handleSignal('SIGINT');
  assert.equal(await h.exited, 1);
  assert.ok(h.logs.some((l) => l.includes('Second signal : arrêt forcé')));
  active = 0;
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(h.exits, [1], 'aucune seconde sortie');
});

test('aucun serveur attaché (signal pendant le démarrage) : exit(0) sans exception', async () => {
  const h = harness({ server: null });
  h.instance.handleSignal('SIGTERM');
  assert.equal(await h.exited, 0);
  assert.ok(!h.calls.includes('close'));
});

test('tâche de fond suivie (historique, email) : la sortie attend la promesse', async () => {
  let done = false;
  const task = new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 60));
  assert.equal(shutdown.trackBackground(task), task, 'promesse renvoyée telle quelle');
  assert.equal(shutdown.pendingBackground(), 1);
  const h = harness({ pending: shutdown.pendingBackground });
  h.instance.handleSignal('SIGTERM');
  assert.equal(await h.exited, 0);
  assert.ok(done, 'tâche terminée avant la sortie');
  assert.equal(shutdown.pendingBackground(), 0);
});

test('tâche de fond en échec : retirée du suivi, erreur laissée à l’appelant', async () => {
  const failing = Promise.reject(new Error('échec'));
  const returned = shutdown.trackBackground(failing);
  await assert.rejects(returned, /échec/);
  await new Promise((r) => setImmediate(r));
  assert.equal(shutdown.pendingBackground(), 0);
});

test('attachServer : compte les requêtes jusqu’à la fermeture de la réponse', () => {
  const { EventEmitter } = require('node:events');
  const server = new EventEmitter();
  shutdown.attachServer(server);
  const before = shutdown.activeRequests();
  const res = new EventEmitter();
  server.emit('request', {}, res);
  assert.equal(shutdown.activeRequests(), before + 1);
  res.emit('close');
  res.emit('close');
  assert.equal(shutdown.activeRequests(), before);
});
