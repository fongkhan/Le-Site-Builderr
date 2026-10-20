// Arrêt propre du serveur (SIGINT/SIGTERM) : plus aucune nouvelle connexion, requêtes en
// cours menées à terme, build en cours interrompu puis remis en tête de file (repris au
// redémarrage), tâches de fond (historique des builds, emails, journal d'audit, statut des
// sites) attendues, le tout dans la limite de SHUTDOWN_GRACE_MS. Un second signal (au-delà
// de la fenêtre des signaux relayés) force l'arrêt.
//
// Aucun require lourd à l'import : ce module est chargé avant tout le reste (gestionnaires
// de processus, Express). Le pool Postgres n'est pas fermé : pg-pool end() attend la
// restitution de tous les clients et @payloadcms/db-postgres en garde un sans le rendre
// (payload.destroy() ne ferme pas non plus le pool) ; la sortie du process ferme les sockets.

let shuttingDown = false;
// Tâches de fond attendues : registre partagé sur globalThis (même clé que
// lib/audit-events, dont les hooks Payload bundlés par Next sont une autre instance).
const BACKGROUND_KEY = Symbol.for('meta-builder.background');
const background = globalThis[BACKGROUND_KEY] || (globalThis[BACKGROUND_KEY] = new Set());
let attachedServer = null;
let active = 0;

function isShuttingDown() {
  return shuttingDown;
}

// Idempotent : marque l'arrêt en cours (nouvelles opérations refusées, Connection: close).
function beginDrain() {
  shuttingDown = true;
}

// Tâche de fond (historique, notification, statut de site…) attendue par l'arrêt propre ;
// les écritures du journal d'audit s'y inscrivent d'elles-mêmes. Renvoie la promesse
// telle quelle : l'appelant garde la main sur ses erreurs.
function trackBackground(promise) {
  const tracked = Promise.resolve(promise);
  background.add(tracked);
  tracked.finally(() => background.delete(tracked)).catch(() => { /* erreur gérée par l'appelant */ });
  return promise;
}

function pendingBackground() {
  return background.size;
}

// Requêtes en cours de chaque connexion : un seul écouteur « close » par socket, même
// pour des dizaines de requêtes pipelinées sur la même connexion.
const pendingBySocket = new WeakMap();

// Compte les requêtes HTTP en cours du serveur : terminées à la fermeture de la réponse
// ou de la connexion (la réponse d'une requête pipelinée dont la connexion se ferme
// n'émet jamais « close »).
function attachServer(server) {
  attachedServer = server;
  server.on('request', (req, res) => {
    active++;
    const socket = req.socket;
    let open = true;
    const done = () => {
      if (!open) return;
      open = false;
      active--;
      if (socket) pendingBySocket.get(socket)?.delete(done);
    };
    res.once('close', done);
    if (!socket) return;
    let pending = pendingBySocket.get(socket);
    if (!pending) {
      pending = new Set();
      pendingBySocket.set(socket, pending);
      socket.once('close', () => { for (const end of [...pending]) end(); });
    }
    pending.add(done);
  });
  return server;
}

function activeRequests() {
  return active;
}

// « 1500 » → « 1,5 » (secondes, affichage français).
const seconds = (ms) => String(Math.round(ms / 100) / 10).replace('.', ',');

// Fabrique (dépendances injectables pour les tests). getBuild renvoie le service de build
// ({ beginShutdown, isBusy, requeueCurrentForRestart, persistQueue }) ou null.
function createShutdown({
  getServer = () => attachedServer,
  activeRequests: countRequests = activeRequests,
  getBuild = () => null,
  pendingBackground: countBackground = pendingBackground,
  graceMs = 3000,
  forceAfterMs = 1000,
  pollMs = 100,
  exit = (code) => process.exit(code),
  log = console,
  now = Date.now,
} = {}) {
  let startedAt = null;
  let exited = false;
  let build = null;

  const exitOnce = (code) => {
    if (exited) return;
    exited = true;
    exit(code);
  };
  const safe = (fn, fallback) => {
    try { return fn(); } catch { return fallback; }
  };

  function finish() {
    try { if (build) build.persistQueue(); } catch { /* file déjà sauvegardée à chaque changement */ }
    log.log('✅ [Arrêt] Arrêt propre terminé.');
    exitOnce(0);
  }

  function handleSignal(signal) {
    if (exited) return;
    // (1) Arrêt déjà commencé : un signal relayé (Ctrl+C puis SIGTERM du lanceur) est
    // ignoré ; un second signal volontaire force l'arrêt.
    if (startedAt !== null) {
      if (now() - startedAt < forceAfterMs) {
        log.log(`🛑 [Arrêt] ${signal} reçu (signal relayé ignoré).`);
        return;
      }
      log.error('⛔ [Arrêt] Second signal : arrêt forcé.');
      exitOnce(1);
      return;
    }

    // (2) Drainage : plus de nouvelle connexion, build en cours interrompu et remis en file
    startedAt = now();
    beginDrain();
    log.log(`🛑 [Arrêt] ${signal} reçu : arrêt propre (requêtes en cours terminées, ${seconds(graceMs)} s au plus).`);
    const server = safe(getServer, null);
    try { if (server) server.close(); } catch { /* serveur déjà fermé */ }
    build = safe(getBuild, null);
    try {
      if (build && build.beginShutdown()) log.log('🛑 [Arrêt] Build en cours interrompu : il reprendra au redémarrage.');
    } catch (err) {
      log.error('⚠️ [Arrêt] Interruption du build impossible :', err && err.message);
    }

    const tick = () => {
      if (exited) return;
      const requests = safe(countRequests, 0);
      const busy = Boolean(build && safe(() => build.isBusy(), false));
      const pending = safe(countBackground, 0);
      if (requests === 0 && !busy && pending === 0) return finish();
      // (3) Délai dépassé : publication remise en file, connexions restantes coupées
      if (now() - startedAt >= graceMs) {
        log.warn(`⚠️ [Arrêt] Délai dépassé : ${requests} requête(s) en cours${busy ? ', publication en cours : reprise au redémarrage' : ''}.`);
        if (busy) {
          try { build.requeueCurrentForRestart(); } catch { /* best-effort */ }
        }
        try { if (server && typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch { /* best-effort */ }
        return finish();
      }
      setTimeout(tick, pollMs);
    };
    tick();
  }

  return { handleSignal };
}

// Service de build seulement s'il est déjà chargé (index.js le charge au démarrage) : sans
// lui, aucun build ne peut tourner, et le charger ici retarderait l'arrêt d'une seconde.
function loadedBuildService() {
  try {
    const id = require.resolve('../services/build');
    return require.cache[id] ? require(id) : null;
  } catch {
    return null;
  }
}

let defaultShutdown = null;

// Point d'entrée des gestionnaires de signaux (core/process-handlers).
function handleSignal(signal) {
  if (!defaultShutdown) {
    let graceMs = 3000;
    try { graceMs = require('./config').SHUTDOWN_GRACE_MS; } catch { /* défaut */ }
    defaultShutdown = createShutdown({ getBuild: loadedBuildService, graceMs });
  }
  defaultShutdown.handleSignal(signal);
}

module.exports = {
  isShuttingDown,
  beginDrain,
  trackBackground,
  pendingBackground,
  attachServer,
  activeRequests,
  createShutdown,
  handleSignal,
};
