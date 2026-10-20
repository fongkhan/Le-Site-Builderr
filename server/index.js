// Point d'entrée du serveur Meta-Builder : Express (API de l'orchestrateur, build,
// endpoints publics des sites) + Next/Payload CMS (admin, REST, authentification).
// « --production » (npm run start:prod) : mode production sur toutes les plateformes,
// avant tout chargement de module (config, Next et Payload lisent NODE_ENV à l'import).
if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';
require('dotenv').config();
require('./core/next-env-patch'); // avant next et payload
require('./core/process-handlers');
require('./core/hosting'); // driver d'hébergement validé dès le boot (échec explicite)

const next = require('next');
const auth = require('./auth');
const sitesStore = require('./sites-store');
const config = require('./core/config');
const { getPayloadInstance, initPayload } = require('./core/payload');
const { seedDefaultData } = require('./services/content');
const build = require('./services/build');
const { scheduleBackups } = require('./services/backups');
const { createApp } = require('./express-app');
const shutdown = require('./core/shutdown');

if (auth.DEV_NO_AUTH) {
  if (config.IS_PRODUCTION) {
    console.error('❌ [Sécurité] DEV_NO_AUTH=true est interdit en production (toutes les requêtes seraient admin). Arrêt.');
    process.exit(1);
  }
  console.warn('⚠️⚠️⚠️  [Sécurité] DEV_NO_AUTH=true : TOUTES les requêtes sont traitées comme un admin. À ne JAMAIS utiliser en production. ⚠️⚠️⚠️');
}

// Production sans build Next (npm run build) : arrêt explicite (avant tout effet
// de bord du démarrage) plutôt qu'une erreur de Next
if (config.IS_PRODUCTION) {
  const missingBuild = require('./lib/prod-build').missingBuildMessage(__dirname);
  if (missingBuild) {
    console.error(missingBuild);
    process.exit(1);
  }
}

// L'instance Payload n'existe qu'après le boot : les modules reçoivent un getter.
auth.init(getPayloadInstance);
config.ensureRuntimeDirs();
// Sauvegarde interrompue par un arrêt brutal (.part) : aucune ne peut être en cours au démarrage
for (const n of require('./services/system').removePartialBackups()) console.warn('♻️ [Reprise] sauvegarde interrompue supprimée : ' + n);
sitesStore.init({ getPayload: getPayloadInstance, sitesFile: config.SITES_FILE });
seedDefaultData();
build.resetOnBoot();

const nextApp = next({ dev: !config.IS_PRODUCTION, dir: __dirname });
const app = createApp({ nextHandler: nextApp.getRequestHandler() });

nextApp.prepare()
  .then(async () => {
    await initPayload();
    // Signal reçu pendant le démarrage : ne pas ouvrir le port
    if (shutdown.isShuttingDown()) return;
    const server = app.listen(config.PORT, () => {
      console.log(`Serveur Meta-Builder démarré sur http://localhost:${config.PORT}`);
      // File de builds conservée à l'arrêt : relancée une fois le canal interne
      // (127.0.0.1:PORT, lu par le build Astro) joignable
      build.restoreQueue().catch((e) => console.error('♻️ [Reprise] File de builds non restaurée :', e.message));
    });
    shutdown.attachServer(server);
    server.on('error', (err) => {
      console.error(`❌ [Serveur] Écoute impossible sur le port ${config.PORT} :`, err.message);
      process.exit(1);
    });
    scheduleBackups();
    require('./services/retention').scheduleRetention();
  })
  .catch((err) => {
    // Sans Next, ni l'admin ni l'authentification ne fonctionnent : inutile de survivre.
    console.error('❌ [Serveur] Démarrage impossible :', (err && err.stack) || err);
    process.exit(1);
  });
