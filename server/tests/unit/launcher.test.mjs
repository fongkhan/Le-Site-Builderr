import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
// Lanceur de la stack (start.js à la racine) : importé sans exécuter main()
const { createStopper, readShutdownGraceMs } = require('../../../start.js');

// Faux enfant : kill() est enregistré ; exit() simule la sortie (code posé avant l'événement,
// comme ChildProcess).
function fakeChild(name) {
  const proc = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.signals = [];
  proc.kill = (signal) => { proc.signals.push(signal); return true; };
  proc.exit = (code = 0) => { proc.exitCode = code; proc.emit('exit', code, null); };
  return { name, proc };
}

function setup(children, timeoutMs = 1000) {
  const exits = [];
  const logs = [];
  const log = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  const stopper = createStopper({ children, timeoutMs, log, exit: (code) => exits.push(code) });
  return { stopper, exits, logs };
}

test('arrêt : SIGTERM à chaque enfant, sortie 0 une fois tous sortis', () => {
  const server = fakeChild('Le serveur');
  const client = fakeChild("L'orchestrateur");
  const { stopper, exits, logs } = setup([server, client]);
  assert.equal(stopper.stopping, false);
  stopper.stop('SIGINT');
  assert.equal(stopper.stopping, true);
  assert.deepEqual(server.proc.signals, ['SIGTERM']);
  assert.deepEqual(client.proc.signals, ['SIGTERM']);
  assert.ok(logs.some((l) => l.includes('FERMETURE DE LA STACK')));
  client.proc.exit(0);
  assert.deepEqual(exits, [], 'le serveur ne s’est pas encore arrêté');
  server.proc.exit(0);
  assert.deepEqual(exits, [0]);
});

test('enfant qui ne s’arrête pas : SIGKILL au bout du délai, sortie 1', async () => {
  const server = fakeChild('Le serveur');
  const client = fakeChild("L'orchestrateur");
  const { stopper, exits, logs } = setup([server, client], 50);
  stopper.stop('SIGTERM');
  client.proc.exit(0);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(server.proc.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(client.proc.signals, ['SIGTERM'], 'enfant déjà sorti jamais tué');
  assert.deepEqual(exits, [1]);
  assert.ok(logs.some((l) => l.includes('Le serveur') && l.includes('arrêt forcé')));
  server.proc.exit(null);
  assert.deepEqual(exits, [1], 'aucune seconde sortie');
});

test('second appel (Ctrl+C répété) : SIGTERM relayé aux vivants, sans sortir', () => {
  const server = fakeChild('Le serveur');
  const client = fakeChild("L'orchestrateur");
  const { stopper, exits } = setup([server, client]);
  stopper.stop('SIGINT');
  client.proc.exit(0);
  stopper.stop('SIGINT');
  assert.deepEqual(server.proc.signals, ['SIGTERM', 'SIGTERM']);
  assert.deepEqual(client.proc.signals, ['SIGTERM']);
  assert.deepEqual(exits, []);
  server.proc.exit(0);
  assert.deepEqual(exits, [0]);
});

test('enfant déjà sorti avant l’arrêt : jamais signalé ; tous sortis → sortie immédiate', () => {
  const server = fakeChild('Le serveur');
  const client = fakeChild("L'orchestrateur");
  client.proc.exit(1);
  server.proc.signalCode = 'SIGKILL';
  const { stopper, exits } = setup([server, client]);
  stopper.stop('SIGTERM');
  assert.deepEqual(server.proc.signals, []);
  assert.deepEqual(client.proc.signals, []);
  assert.deepEqual(exits, [0]);
});

test('readShutdownGraceMs — environnement, puis .env, puis 15 s', () => {
  assert.equal(readShutdownGraceMs('PORT=4000\nSHUTDOWN_GRACE_MS=20000\n', {}), 20000);
  assert.equal(readShutdownGraceMs('# SHUTDOWN_GRACE_MS=20000\n', {}), 15000, 'ligne commentée ignorée');
  assert.equal(readShutdownGraceMs('SHUTDOWN_GRACE_MS=abc\n', {}), 15000);
  assert.equal(readShutdownGraceMs('SHUTDOWN_GRACE_MS=20000\n', { SHUTDOWN_GRACE_MS: '8000' }), 8000);
  assert.equal(readShutdownGraceMs('', {}), 15000);
});
