// --- GESTION DES ERREURS AU NIVEAU PROCESSUS ---
const { IS_PRODUCTION } = require('./config');

// Les erreurs de connexion BDD sont catchées localement (initPayload, requêtes) et ne
// remontent pas ici. Un rejet non-géré est journalisé sans tuer le process (souvent une
// promesse orpheline sans impact sur les requêtes en cours).
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process] Rejet de promesse non-géré :', (reason && reason.stack) || (reason && reason.message) || reason);
});

// Une exception non-capturée laisse le process dans un état indéterminé. En PRODUCTION
// (build Next figé) on journalise puis on sort (le superviseur — PM2/systemd/o2switch —
// relance un process propre). En DEV, on tolère : Next recompile à chaud et peut lever
// des erreurs webpack transitoires pendant le warmup qui ne doivent pas tuer le serveur.
process.on('uncaughtException', (err) => {
  if (IS_PRODUCTION) {
    console.error('💥 [Process] Exception non-capturée — arrêt du process :', (err && err.stack) || err);
    process.exit(1);
  }
  console.error('⚠️ [Process] Exception non-capturée (tolérée en dev) :', (err && err.stack) || err);
});

// Arrêt du serveur (Ctrl+C, docker stop, systemctl stop…) : le build en cours tourne
// dans son propre groupe de processus (setsid) et ne reçoit donc PAS le signal du
// terminal. On l'interrompt (abortCurrent) puis on sort ; à la sortie, quelle qu'en soit
// la cause (signal, process.exit après une exception), tout arbre de commande encore
// vivant est tué de façon synchrone : aucun npm/astro orphelin n'écrit dans le dist
// pendant le build du serveur suivant.
const { killActiveSync } = require('../lib/run-command');

process.on('exit', () => {
  killActiveSync('SIGKILL');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 [Process] ${signal} reçu : arrêt du serveur.`);
  try {
    // Chargé à la demande : ce module est requis avant tout le reste au démarrage
    if (require('../services/build').abortCurrent()) console.log('🛑 [Process] Build en cours interrompu.');
  } catch (err) {
    console.error('⚠️ [Process] Interruption du build impossible :', err && err.message);
  }
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));
