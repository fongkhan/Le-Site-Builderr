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

// Arrêt du serveur (Ctrl+C, docker stop, systemctl stop…) : arrêt propre (core/shutdown)
// — plus de nouvelle connexion, requêtes en cours terminées, build en cours interrompu et
// remis en file pour le redémarrage. Le build tourne dans son propre groupe de processus
// (setsid) : le signal du terminal ne l'atteint pas, l'arrêt propre l'interrompt. À la
// sortie, quelle qu'en soit la cause (fin de l'arrêt propre, arrêt forcé, process.exit
// après une exception), tout arbre de commande encore vivant est tué de façon synchrone :
// aucun npm/astro orphelin n'écrit dans le dist pendant le build du serveur suivant.
const { killActiveSync } = require('../lib/run-command');

process.on('exit', () => {
  killActiveSync('SIGKILL');
});

// Chargé à la demande : ce module est requis avant tout le reste au démarrage. Les
// écouteurs ne sont jamais retirés : un second signal pendant l'arrêt reste géré (et un
// éventuel lanceur relais, comme la CLI tsx, voit le signal pris en charge).
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => require('./shutdown').handleSignal(s));
