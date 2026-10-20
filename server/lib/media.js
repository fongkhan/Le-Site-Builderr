// Aides médiathèque — fonctions pures, testables sans serveur.
// Les images téléversées sont servies par Payload sous /api/media/file/<nom> (accès
// contrôlé). Le site statique publié, lui, doit être autonome : au build les URLs
// sont réécrites vers /media/<nom> et les fichiers copiés dans dist/media/.

const path = require('path');

const MEDIA_API_PREFIX = '/api/media/file/';
const MEDIA_STATIC_PREFIX = '/media/';

// Réécrit récursivement toutes les URLs API de médias vers leur forme statique.
// staticPrefix : préfixe de publication (« /media/ » à la racine d'un domaine,
// « /preview/<slug>/media/ » pour un aperçu servi sous un sous-chemin).
// Renvoie une copie : l'entrée n'est jamais mutée.
function rewriteMediaUrls(value, staticPrefix = MEDIA_STATIC_PREFIX) {
  if (typeof value === 'string') {
    return value.split(MEDIA_API_PREFIX).join(staticPrefix);
  }
  if (Array.isArray(value)) {
    return value.map((v) => rewriteMediaUrls(v, staticPrefix));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteMediaUrls(v, staticPrefix);
    return out;
  }
  return value;
}

// Préfixe des médias statiques pour un chemin de base de site (« / », « /preview/x »).
function mediaPrefixFor(basePath) {
  const base = String(basePath || '/').replace(/\/+$/, '');
  return `${base}${MEDIA_STATIC_PREFIX}`;
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

// Renomme les fichiers médias cités (formes /api/media/file/<nom> et /media/<nom>, noms
// encodés compris) selon `map` ({ ancien: nouveau } ou Map) : utilisé par la duplication
// d'un site, dont les images sont copiées sous de nouveaux noms. Un nom absent de la table
// est laissé tel quel. Renvoie une copie : l'entrée n'est jamais mutée.
function remapMediaFilenames(value, map) {
  const lookup = map instanceof Map ? map : new Map(Object.entries(map || {}));
  if (lookup.size === 0) return value;
  const walk = (v) => {
    if (typeof v === 'string') {
      return v.replace(/\/(api\/media\/file|media)\/([^"'\s?#)]+)/g, (match, prefix, raw) => {
        let name;
        try {
          name = decodeURIComponent(raw);
        } catch {
          name = raw;
        }
        const target = lookup.get(name);
        return typeof target === 'string' && target ? `/${prefix}/${encodeURIComponent(target)}` : match;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, item] of Object.entries(v)) out[k] = walk(item);
      return out;
    }
    return v;
  };
  return walk(value);
}

module.exports = { rewriteMediaUrls, mediaPrefixFor, collectMediaFilenames, remapMediaFilenames, MEDIA_API_PREFIX, MEDIA_STATIC_PREFIX };
