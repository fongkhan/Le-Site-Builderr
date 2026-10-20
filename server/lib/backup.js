// Helpers purs pour les sauvegardes automatiques (nom de fichier, rétention, validation,
// planification, lecture d'une archive). L'archivage lui-même (I/O zip) vit dans
// services/backups.js ; ces fonctions sont testables seules.
const { isValidSlug } = require('./paths');
const { isPublishableMediaName } = require('./media-policy');

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

// --- Planification ---

// Intervalle entre deux sauvegardes (ms), 1 h minimum, 24 h si la valeur est invalide.
// Sert aux comparaisons seulement : jamais passé tel quel à un minuteur.
function backupIntervalMs(hours) {
  return Math.max(1, Number.isFinite(+hours) ? +hours : 24) * 3600000;
}

// Délai entre deux vérifications « sauvegarde due ? ». Un minuteur au-delà de 2^31−1 ms
// (~24,8 jours) retombe à 1 ms dans Node : la vérification reste donc horaire au plus,
// quel que soit l'intervalle configuré.
const BACKUP_CHECK_MS = 3600000;
function backupCheckDelayMs(intervalMs) {
  return Number.isFinite(intervalMs) && intervalMs > 0 ? Math.min(intervalMs, BACKUP_CHECK_MS) : BACKUP_CHECK_MS;
}

// Une sauvegarde est due s'il n'en existe aucune (ou de date illisible) ou si la dernière
// date d'au moins un intervalle. `toleranceMs` absorbe la durée d'écriture de l'archive
// (sa date est celle de la fin d'écriture) : sans elle, chaque sauvegarde glisserait d'une
// vérification par cycle.
function isBackupDue(lastCreatedAt, nowMs, intervalMs, toleranceMs = 0) {
  const last = Date.parse(lastCreatedAt || '');
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= intervalMs - Math.max(0, Number(toleranceMs) || 0);
}

// Premier nom libre à partir de `date`, seconde par seconde : deux sauvegardes créées dans
// la même seconde (sauvegarde de sécurité juste après une sauvegarde manuelle…) ne
// s'écrasent jamais. Au-delà de 60 essais, le dernier nom est renvoyé.
function nextFreeBackupName(date, exists) {
  const start = date.getTime();
  let name = backupFilename(date);
  for (let i = 0; i < 60; i++) {
    name = backupFilename(new Date(start + i * 1000));
    if (!exists(name)) return name;
  }
  return name;
}

// --- Contenu d'une archive ---

const SITE_ENTRY = /^sites\/([^/]+)\/(?:pages|posts|theme|site)\.json$/;

// Slugs des sites présents dans une archive (entrées sites/<slug>/<fichier>.json), uniques
// et triés. Un slug non canonique (« ../x », majuscules…) est ignoré.
function listBackupSites(entryNames) {
  const slugs = new Set();
  for (const name of entryNames || []) {
    if (typeof name !== 'string') continue;
    const m = SITE_ENTRY.exec(name);
    if (m && isValidSlug(m[1])) slugs.add(m[1]);
  }
  return [...slugs].sort();
}

// Entrée d'archive d'une image téléversée d'un site.
function backupMediaEntryName(slug, filename) {
  return `sites/${slug}/media/${filename}`;
}

// Images d'un site dans une archive : [{ entryName, filename }]. Seuls les noms de
// fichiers simples et publiables (images matricielles) sont retenus : jamais de
// sous-dossier, de chemin, de SVG ni de fichier sans extension.
function backupMediaEntries(entryNames, slug) {
  if (!isValidSlug(slug)) return [];
  const prefix = `sites/${slug}/media/`;
  const seen = new Set();
  const out = [];
  for (const entryName of entryNames || []) {
    if (typeof entryName !== 'string' || !entryName.startsWith(prefix)) continue;
    const filename = entryName.slice(prefix.length);
    if (!isPublishableMediaName(filename) || seen.has(filename)) continue;
    seen.add(filename);
    out.push({ entryName, filename });
  }
  return out;
}

// Objet JSON (jamais un tableau ni une valeur simple), ou null.
function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// manifest.json → { format, createdAt }. Les archives antérieures (sans « format ») sont
// au format 1 (sans images).
function parseBackupManifest(text) {
  const m = parseJsonObject(text);
  if (!m) return { format: 1, createdAt: null };
  return {
    format: Number.isInteger(m.format) ? m.format : 1,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : null,
  };
}

// site.json → { name, stack } uniquement : chemins serveur, domaines, jeton de domaine et
// mesure d'audience de la fiche sauvegardée ne sont jamais réutilisés.
function parseBackupSiteMeta(text) {
  const m = parseJsonObject(text);
  const asText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { name: asText(m && m.name, 200), stack: asText(m && m.stack, 100) };
}

// Corps de POST /api/admin/backups/restore → { name, slug, mode } ou { error }.
const RESTORE_MODES = ['copy', 'replace'];
function parseRestoreRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!isValidBackupName(b.name)) return { error: 'Nom de sauvegarde invalide.' };
  if (!isValidSlug(b.slug)) return { error: 'Site invalide.' };
  const mode = b.mode === undefined || b.mode === null || b.mode === '' ? 'copy' : b.mode;
  if (!RESTORE_MODES.includes(mode)) return { error: 'Mode de restauration inconnu (copy ou replace).' };
  return { name: b.name, slug: b.slug, mode };
}

module.exports = {
  backupFilename,
  isValidBackupName,
  selectBackupsToDelete,
  backupIntervalMs,
  BACKUP_CHECK_MS,
  backupCheckDelayMs,
  isBackupDue,
  nextFreeBackupName,
  listBackupSites,
  backupMediaEntryName,
  backupMediaEntries,
  parseBackupManifest,
  parseBackupSiteMeta,
  RESTORE_MODES,
  parseRestoreRequest,
};
