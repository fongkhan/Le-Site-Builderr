// Santé du serveur pour la supervision (sonde, HEALTHCHECK Docker, reverse-proxy, CI).
// Publics et sans authentification : la réponse ne contient ni secret, ni version, ni
// chemin, ni message d'erreur — seulement des états.
const fs = require('fs');
const path = require('path');
const { createRouter, makeLimiter } = require('../core/http');
const { getPayloadInstance } = require('../core/payload');
const { DATA_DIR, PUBLIC_HTML_DIR, UPLOADS_DIR } = require('../core/config');
const { summarizeChecks } = require('../lib/health');
const build = require('../services/build');

const DB_TIMEOUT_MS = 2000;

const router = createRouter();

// Vivacité : le process répond (aucune dépendance).
router.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', uptimeS: Math.round(process.uptime()) });
});

// Base de données : instance Payload présente et `select 1` borné dans le temps (une
// base injoignable ne bloque jamais la sonde).
async function checkDatabase() {
  const payload = getPayloadInstance();
  const db = payload && payload.db;
  if (!db) return 'down';
  let timer;
  try {
    const query = db.drizzle && typeof db.drizzle.execute === 'function'
      ? db.drizzle.execute('select 1')
      : db.pool.query('select 1');
    await Promise.race([
      query,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), DB_TIMEOUT_MS); }),
    ]);
    return 'ok';
  } catch (err) {
    console.error('❌ [Santé] Base de données injoignable :', err.message);
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

// Disque : dossiers de données, de production et de la médiathèque accessibles en
// écriture. Un dossier pas encore créé (uploads avant le premier envoi) est jugé sur son
// parent, qui devra l'accueillir.
function checkStorage() {
  try {
    for (const dir of [DATA_DIR, PUBLIC_HTML_DIR, UPLOADS_DIR]) {
      const target = fs.existsSync(dir) ? dir : path.dirname(dir);
      fs.accessSync(target, fs.constants.W_OK);
    }
    return 'ok';
  } catch (err) {
    console.error('❌ [Santé] Stockage inaccessible en écriture :', err.message);
    return 'down';
  }
}

// Disponibilité : 200 (ok/degraded) ou 503 (down). Limiteur léger : la requête SQL et
// les accès disque ne doivent pas servir de levier de charge.
router.get('/api/health/ready', makeLimiter(120, 'Trop de requêtes.'), async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    storage: checkStorage(),
    build: { inProgress: Boolean(build.getBuildStatus().inProgress), queueLength: build.getQueue().length },
  };
  const { status, httpStatus } = summarizeChecks(checks);
  res.set('Cache-Control', 'no-store');
  res.status(httpStatus).json({ status, checks });
});

module.exports = router;
