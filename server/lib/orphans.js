// Données orphelines : fichiers et dossiers laissés par des sites qui n'existent plus
// (suppression ancienne, crash, import raté). Fonction pure : l'inventaire du disque et la
// liste des sites sont fournis par l'appelant (services/system).
//
// Purgeables : fichiers de données et dossiers (versions, brouillons) au slug valide et
// inconnu, copies du modèle créées par l'outil (marquées) et non enregistrées, fichiers
// temporaires d'écriture abandonnés. Jamais purgés : dossiers publiés sans site (simple
// signalement) et dépôts non créés par l'outil.
const { isValidSlug } = require('./paths');

// Fichiers de données par site (voir core/config et services/submissions)
const DATA_FILE_PATTERNS = [
  /^site_(.+)_pages\.json$/,
  /^site_(.+)_theme\.json$/,
  /^posts_(.+)\.json$/,
  /^stats_(.+)\.json$/,
  /^submissions_(.+)\.json$/,
];
// Fichier temporaire d'une écriture atomique (lib/json-file) : « x.json.<pid>.tmp »
const TMP_DATA_FILE = /^[^/\\]+\.json\.\d+\.tmp$/;
// Fichiers du serveur jamais listés, quel que soit leur nom
const PROTECTED_DATA_FILES = new Set(['sites.json', 'build-logs.txt', 'build-queue.json']);
// Copies de bascule d'une publication (lib/fs-swap) : reprises au démarrage, jamais ici
const SWAP_COPY = /\.(tmp|old)-/;

// Slug d'un fichier de données de site, ou null si le nom ne suit aucun motif connu.
function dataFileSlug(name) {
  for (const re of DATA_FILE_PATTERNS) {
    const m = re.exec(String(name));
    if (m) return m[1];
  }
  return null;
}

// Nom de fichier de données que le nettoyage peut supprimer (revalidation côté serveur).
function isPurgeableDataFileName(name) {
  if (typeof name !== 'string' || PROTECTED_DATA_FILES.has(name) || /[/\\]/.test(name)) return false;
  const slug = dataFileSlug(name);
  return slug !== null ? isValidSlug(slug) : TMP_DATA_FILE.test(name);
}

function findOrphans({
  knownSlugs = new Set(),
  dataFiles = [],
  releaseDirs = [],
  draftDirs = [],
  repoDirs = [],
  registeredRepoNames = new Set(),
  publicDirs = [],
  registeredPublicNames = new Set(),
  now = Date.now(),
  tmpAgeMs = 60 * 60 * 1000,
} = {}) {
  const unknownSlug = (name) => isValidSlug(name) && !knownSlugs.has(name);
  const out = { dataFiles: [], releases: [], drafts: [], repositories: [], kept: { publicDirs: [], repositories: [] } };

  for (const file of dataFiles) {
    if (!isPurgeableDataFileName(file.name)) continue;
    const slug = dataFileSlug(file.name);
    if (slug !== null) {
      if (unknownSlug(slug)) out.dataFiles.push(file);
    } else if (now - (Number(file.mtimeMs) || now) > tmpAgeMs) {
      // Temporaire récent : une écriture peut être en cours
      out.dataFiles.push(file);
    }
  }
  for (const dir of releaseDirs) if (unknownSlug(dir.name)) out.releases.push(dir);
  for (const dir of draftDirs) if (unknownSlug(dir.name)) out.drafts.push(dir);
  for (const dir of repoDirs) {
    if (registeredRepoNames.has(dir.name)) continue;
    if (dir.provisioned && unknownSlug(dir.name)) out.repositories.push(dir);
    else out.kept.repositories.push(dir);
  }
  for (const dir of publicDirs) {
    if (SWAP_COPY.test(dir.name) || registeredPublicNames.has(dir.name)) continue;
    out.kept.publicDirs.push(dir);
  }
  return out;
}

module.exports = { findOrphans, dataFileSlug, isPurgeableDataFileName };
