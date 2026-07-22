// Helpers purs pour les sauvegardes automatiques (nom de fichier, rétention, validation).
// L'archivage lui-même (I/O zip) vit dans index.js ; ces fonctions sont testables seules.

// Nom d'archive horodaté, triable lexicographiquement = chronologiquement.
// `date` est injectée pour la testabilité. Ex. backup-2026-07-22T11-30-00.zip
function backupFilename(date) {
  const iso = date.toISOString().slice(0, 19).replace(/:/g, '-');
  return `backup-${iso}.zip`;
}

// Valide un nom d'archive avant toute opération fichier (anti-traversée de chemin).
function isValidBackupName(name) {
  return typeof name === 'string' && /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/.test(name);
}

// Parmi `names` (noms d'archives), renvoie ceux à SUPPRIMER pour ne garder que les
// `keep` plus récents. Les noms non conformes sont ignorés (jamais supprimés).
function selectBackupsToDelete(names, keep) {
  const valid = (names || []).filter(isValidBackupName).sort(); // ordre chronologique
  const k = Math.max(0, Number(keep) || 0);
  return k === 0 ? valid.slice() : valid.slice(0, Math.max(0, valid.length - k));
}

module.exports = { backupFilename, isValidBackupName, selectBackupsToDelete };
