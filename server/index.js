// Point d'entrée du serveur Meta-Builder : Express (API de l'orchestrateur, build,
// endpoints publics des sites) + Next/Payload CMS (admin, REST, authentification).
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

if (auth.DEV_NO_AUTH) {
  console.warn('⚠️⚠️⚠️  [Sécurité] DEV_NO_AUTH=true : TOUTES les requêtes sont traitées comme un admin. À ne JAMAIS utiliser en production. ⚠️⚠️⚠️');
}

// L'instance Payload n'existe qu'après le boot : les modules reçoivent un getter.
auth.init(getPayloadInstance);
config.ensureRuntimeDirs();
sitesStore.init({ getPayload: getPayloadInstance, sitesFile: config.SITES_FILE });
seedDefaultData();
build.resetOnBoot();

const nextApp = next({ dev: !config.IS_PRODUCTION, dir: __dirname });
const app = createApp({ nextHandler: nextApp.getRequestHandler() });

nextApp.prepare().then(async () => {
  await initPayload();
  app.listen(config.PORT, () => {
    console.log(`Serveur Meta-Builder démarré sur http://localhost:${config.PORT}`);
  });
  scheduleBackups();
});
