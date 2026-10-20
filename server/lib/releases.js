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

// Suffixe d'une release en cours de copie : jamais listée ni restaurable (RELEASE_ID ne
// l'accepte pas), supprimée au boot si un crash l'a interrompue.
const PARTIAL_SUFFIX = '.partial';

// Copie le build dans une nouvelle release et renvoie son identifiant. Copie complète
// dans `<id>.partial` puis renommage : une release interrompue n'est jamais prise pour
// valide au rollback ni comptée dans la rétention.
function saveRelease(baseDir, slug, distDir, now = Date.now()) {
  const releaseId = String(now);
  const dest = releaseDirFor(baseDir, slug, releaseId);
  const partial = dest + PARTIAL_SUFFIX;
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(partial, { recursive: true });
  try {
    fs.cpSync(distDir, partial, { recursive: true, force: true });
    fs.renameSync(partial, dest);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
  return releaseId;
}

// Reprise au boot : supprime les releases partielles (`<slug>/<id>.partial`) laissées par
// un crash pendant la copie. Renvoie les chemins relatifs supprimés.
function removePartialReleases(baseDir) {
  const removed = [];
  let slugs;
  try {
    slugs = fs.readdirSync(baseDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return removed; // aucune release encore
  }
  for (const slugEntry of slugs) {
    const dir = path.join(baseDir, slugEntry.name);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.endsWith(PARTIAL_SUFFIX)) {
        fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
        removed.push(`${slugEntry.name}/${e.name}`);
      }
    }
  }
  return removed;
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
  // keep invalide (undefined, NaN…) → on conserve au moins la release courante
  const excess = listReleases(baseDir, slug).slice(Math.max(1, Number.parseInt(keep, 10) || 1));
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

module.exports = { saveRelease, listReleases, pruneReleases, resolveRelease, removePartialReleases, RELEASE_ID };
