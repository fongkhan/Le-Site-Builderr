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
