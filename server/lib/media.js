// Aides médiathèque — fonctions pures, testables sans serveur.
// Les images téléversées sont servies par Payload sous /api/media/file/<nom> (accès
// contrôlé). Le site statique publié, lui, doit être autonome : au build les URLs
// sont réécrites vers /media/<nom> et les fichiers copiés dans dist/media/.

const path = require('path');

const MEDIA_API_PREFIX = '/api/media/file/';
const MEDIA_STATIC_PREFIX = '/media/';

// Réécrit récursivement toutes les URLs API de médias vers leur forme statique.
// Renvoie une copie : l'entrée n'est jamais mutée.
function rewriteMediaUrls(value) {
  if (typeof value === 'string') {
    return value.split(MEDIA_API_PREFIX).join(MEDIA_STATIC_PREFIX);
  }
  if (Array.isArray(value)) {
    return value.map(rewriteMediaUrls);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteMediaUrls(v);
    return out;
  }
  return value;
}

// Collecte les noms de fichiers médias référencés (formes API et statique confondues).
// Chaque nom est réduit à son basename : aucune traversée de chemin possible.
function collectMediaFilenames(value, found = new Set()) {
  if (typeof value === 'string') {
    const re = /\/(?:api\/media\/file|media)\/([^"'\s?#)]+)/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      let name;
      try {
        name = decodeURIComponent(m[1]);
      } catch {
        name = m[1];
      }
      found.add(path.basename(name));
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectMediaFilenames(v, found);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectMediaFilenames(v, found);
  }
  return [...found];
}

module.exports = { rewriteMediaUrls, collectMediaFilenames, MEDIA_API_PREFIX, MEDIA_STATIC_PREFIX };
