// Rétention : purge quotidienne des entrées anciennes du journal d'audit, de
// l'historique des builds et des messages reçus par les formulaires des sites. Durées en
// jours : AUDIT_RETENTION_DAYS, BUILDS_RETENTION_DAYS (365 par défaut, 0 = jamais
// purgé) ; messages : 12 mois, durée annoncée par la politique de confidentialité des
// sites publiés (non réglable). Chaque purge effective en base est elle-même tracée
// (journal.purge).
const { getPayloadInstance } = require('../core/payload');
const { parseRetentionDays, retentionCutoff, writeAudit } = require('../lib/audit-events');
const { SUBMISSION_RETENTION } = require('../lib/submissions');
const { purgeExpiredSubmissionFiles } = require('./submissions');

const RETENTION = [
  { collection: 'audit_logs', env: 'AUDIT_RETENTION_DAYS' },
  { collection: 'builds', env: 'BUILDS_RETENTION_DAYS' },
  { collection: 'submissions', days: SUBMISSION_RETENTION.retentionDays },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Supprime, collection par collection, les entrées créées avant la date limite. Une
// collection en échec n'empêche pas les suivantes. Renvoie [{ collection, deleted }].
async function purgeExpired(payload, { env = process.env, now = Date.now() } = {}) {
  if (!payload) return [];
  const results = [];
  for (const { collection, env: name, days: fixedDays } of RETENTION) {
    const days = name ? parseRetentionDays(env[name]) : fixedDays;
    const cutoff = retentionCutoff(days, now);
    if (!cutoff) continue;
    try {
      const where = { createdAt: { less_than: cutoff } };
      const { totalDocs } = await payload.count({ collection, where, overrideAccess: true });
      if (totalDocs > 0) {
        // Une seule requête SQL, sans contrôle d'accès (audit_logs n'est pas supprimable
        // par l'API)
        await payload.db.deleteMany({ collection, where });
        await writeAudit(payload, {
          action: 'journal.purge',
          actor: 'système',
          target: collection,
          details: `entrees=${totalDocs} ; avant=${cutoff.slice(0, 10)} ; retention=${days}j`,
        });
      }
      results.push({ collection, deleted: totalDocs });
    } catch (e) {
      console.error(`🧹 [Rétention] Purge de ${collection} impossible :`, (e && e.message) || e);
    }
  }
  return results;
}

// Purge complète : base (si disponible), puis fichiers de repli des messages (mode sans
// base, ou fichiers restés d'un fonctionnement sans base). Renvoie [{ collection, deleted }].
async function runRetention(payload, { now = Date.now(), dataDir } = {}) {
  const results = await purgeExpired(payload, { now });
  try {
    const deleted = purgeExpiredSubmissionFiles({ dir: dataDir, now });
    if (deleted > 0) results.push({ collection: 'submissions (fichiers)', deleted });
  } catch (e) {
    console.error('🧹 [Rétention] Purge des fichiers de messages impossible :', (e && e.message) || e);
  }
  return results;
}

const retentionLabel = (days) => (days === 0 ? 'conservation illimitée' : `${days} jours`);

// Purge une minute après le démarrage, puis toutes les 24 h (minuteurs sans effet sur
// l'arrêt du process), avec ou sans base de données.
function scheduleRetention() {
  const run = () => runRetention(getPayloadInstance())
    .then((results) => {
      for (const r of results) {
        if (r.deleted > 0) console.log(`🧹 [Rétention] ${r.deleted} entrée(s) supprimée(s) de ${r.collection}.`);
      }
    })
    .catch((e) => console.error('🧹 [Rétention] Échec :', (e && e.message) || e));
  const first = setTimeout(run, 60 * 1000);
  if (first.unref) first.unref();
  const timer = setInterval(run, DAY_MS);
  if (timer.unref) timer.unref();
  console.log(`🧹 [Rétention] Journal d'audit : ${retentionLabel(parseRetentionDays(process.env.AUDIT_RETENTION_DAYS))} ; historique des builds : ${retentionLabel(parseRetentionDays(process.env.BUILDS_RETENTION_DAYS))} ; messages des formulaires : ${retentionLabel(SUBMISSION_RETENTION.retentionDays)}.`);
}

module.exports = { RETENTION, purgeExpired, runRetention, scheduleRetention };
