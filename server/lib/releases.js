// Gestion des versions de déploiement (releases) : à chaque déploiement réussi, une
// copie horodatée du build est conservée sous <baseDir>/<slug>/<timestamp>/ pour
// permettre un retour arrière (rollback) en un clic. Fonctions pures vis-à-vis du
// serveur : importables et testables sans DB ni boot.

const fs = require('fs');
const path = require('path');

// Un identifiant de release est un timestamp en millisecondes (trié = chronologique).
const RELEASE_ID = /^\d{10,17}$/;

function releaseDirFor(baseDir, slug, releaseId) {
  return path.join(baseDir, slug, String(releaseId));
}

// Copie le build dans une nouvelle release et renvoie son identifiant.
function saveRelease(baseDir, slug, distDir, now = Date.now()) {
  const releaseId = String(now);
  const dest = releaseDirFor(baseDir, slug, releaseId);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(distDir, dest, { recursive: true, force: true });
  return releaseId;
}

// Liste les releases d'un site, plus récentes d'abord.
function listReleases(baseDir, slug) {
  const dir = path.join(baseDir, slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && RELEASE_ID.test(e.name))
    .map((e) => ({ id: e.name, date: new Date(Number(e.name)).toISOString() }))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

// Supprime les releases au-delà des `keep` plus récentes. Renvoie les ids supprimés.
function pruneReleases(baseDir, slug, keep) {
  const excess = listReleases(baseDir, slug).slice(Math.max(1, keep));
  for (const r of excess) {
    fs.rmSync(releaseDirFor(baseDir, slug, r.id), { recursive: true, force: true });
  }
  return excess.map((r) => r.id);
}

// Valide un identifiant fourni par le client et renvoie le chemin de la release,
// ou null si l'identifiant est invalide ou la release absente. Aucun chemin fourni
// par le client n'est utilisé directement : tout est reconstruit depuis baseDir/slug.
function resolveRelease(baseDir, slug, releaseId) {
  if (typeof releaseId !== 'string' || !RELEASE_ID.test(releaseId)) return null;
  const dir = releaseDirFor(baseDir, slug, releaseId);
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

module.exports = { saveRelease, listReleases, pruneReleases, resolveRelease, RELEASE_ID };
