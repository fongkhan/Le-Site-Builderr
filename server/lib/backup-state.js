// État des sauvegardes affiché dans le panneau Système (fonctions pures). Les archives et
// leur rétention restent dans lib/backup.js et services/backups.js.
const { isValidBackupName } = require('./backup');

// Archive en cours d'écriture (« backup-….zip.part ») : laissée par un arrêt brutal si le
// serveur s'est arrêté pendant une sauvegarde. Le nom complet est revalidé (anti-traversée).
function isPartialBackupName(name) {
  return typeof name === 'string' && name.endsWith('.part') && isValidBackupName(name.slice(0, -5));
}

// 'désactivées' (pas de planification), 'aucune' (planifiées mais aucune archive),
// 'en retard' (dernière archive plus vieille que deux intervalles) ou 'ok'.
function backupState({ enabled, intervalHours, latestCreatedAt, now = Date.now() } = {}) {
  if (!enabled) return 'désactivées';
  const latest = latestCreatedAt ? Date.parse(latestCreatedAt) : NaN;
  if (!Number.isFinite(latest)) return 'aucune';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const intervalMs = Math.max(1, Number(intervalHours) || 24) * 60 * 60 * 1000;
  return nowMs - latest > 2 * intervalMs ? 'en retard' : 'ok';
}

module.exports = { isPartialBackupName, backupState };
