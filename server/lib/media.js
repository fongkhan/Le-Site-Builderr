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

// Nom d'un média dans une URL /api/media/file/<nom> ou /media/<nom>. La forme canonique
// (encodeMediaName) n'a ni ( ) ni ' en clair ; l'ancienne forme (encodeURIComponent, celle
// de doc.url de Payload) les garde : une paire de parenthèses (« photo%20(1).png ») et une
// apostrophe suivie d'une lettre, d'un chiffre, de % ou _ (« l'atelier.png ») font partie
// du nom. Une parenthèse fermante seule ou une apostrophe finale restent des délimiteurs
// (lien Markdown, attribut HTML, url('…')).
const MEDIA_NAME_SOURCE = String.raw`(?:[^"'\s?#()]|\([^"'\s?#()/]*\)|\(|'(?=[\p{L}\p{N}%_]))+`;
const MEDIA_URL_SOURCE = String.raw`\/(api\/media\/file|media)\/(${MEDIA_NAME_SOURCE})`;
const mediaUrlRegex = () => new RegExp(MEDIA_URL_SOURCE, 'gu');

const decodeName = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// Applique fn à chaque chaîne d'une valeur (objets et tableaux parcourus récursivement).
function forEachString(value, fn) {
  if (typeof value === 'string') fn(value);
  else if (Array.isArray(value)) for (const v of value) forEachString(v, fn);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) forEachString(v, fn);
}

// Collecte les noms de fichiers médias référencés (formes API et statique confondues).
// Chaque nom est réduit à son basename : aucune traversée de chemin possible.
function collectMediaFilenames(value, found = new Set()) {
  forEachString(value, (s) => {
    for (const m of s.matchAll(mediaUrlRegex())) found.add(path.basename(decodeName(m[2])));
  });
  return [...found];
}

// Noms de `names` (médiathèque du site) cités par `value`. Complète collectMediaFilenames
// par une lecture gourmande (jusqu'au prochain guillemet, blanc, ?, #, < ou >) coupée à
// chaque ' ou ) : un nom connu est reconnu quelle que soit la forme enregistrée, même avec
// une parenthèse fermante seule (« smiley%20:).png »). Faux positif possible (prudent).
// Travail linéaire (contenu saisi par le client) : coupes limitées à la longueur encodée
// maximale du plus long nom connu (9 caractères par caractère), 16 au plus par URL.
const MAX_CUTS = 16;
function citedMediaNames(value, names) {
  const known = new Set(names || []);
  const cited = new Set(collectMediaFilenames(value).filter((n) => known.has(n)));
  if (cited.size === known.size) return cited;
  let maxLength = 0;
  for (const n of known) maxLength = Math.max(maxLength, String(n).length * 9);
  forEachString(value, (s) => {
    for (const m of s.matchAll(/\/(?:api\/media\/file|media)\/([^"\s?#<>]+)/g)) {
      const raw = m[1];
      const limit = Math.min(raw.length, maxLength);
      for (let i = 1, cuts = 0; i <= limit && cuts < MAX_CUTS; i++) {
        if (i < raw.length && raw[i] !== "'" && raw[i] !== ')') continue;
        cuts++;
        const name = path.basename(decodeName(raw.slice(0, i)));
        if (known.has(name)) cited.add(name);
      }
    }
  });
  return cited;
}

// Nom de fichier encodé pour une URL de média : forme canonique. encodeURIComponent laisse
// ! ' ( ) * en clair, et ' ou ) servent aussi de délimiteurs aux extracteurs ci-dessus.
function encodeMediaName(name) {
  return encodeURIComponent(name).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Renomme les fichiers médias cités (formes /api/media/file/<nom> et /media/<nom>, noms
// encodés compris) selon `map` ({ ancien: nouveau } ou Map) : utilisé par la duplication
// d'un site, dont les images sont copiées sous de nouveaux noms. Un nom absent de la table
// est laissé tel quel ; le nouveau nom est encodé par encodeMediaName (relu en entier par
// collectMediaFilenames). Renvoie une copie : l'entrée n'est jamais mutée.
function remapMediaFilenames(value, map) {
  const lookup = map instanceof Map ? map : new Map(Object.entries(map || {}));
  if (lookup.size === 0) return value;
  const walk = (v) => {
    if (typeof v === 'string') {
      return v.replace(mediaUrlRegex(), (match, prefix, raw) => {
        const target = lookup.get(decodeName(raw));
        return typeof target === 'string' && target ? `/${prefix}/${encodeMediaName(target)}` : match;
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

// Forme canonique des URL /api/media/file/<nom> d'un contenu (pages, articles) : nom
// décodé puis réencodé par encodeMediaName, comme la médiathèque, le téléversement et le
// logo. Seules les URL relatives sont touchées, jamais ce chemin dans l'URL d'un autre
// domaine. Renvoie une copie : l'entrée n'est jamais mutée.
function canonicalMediaUrls(value) {
  if (typeof value === 'string') {
    if (!value.includes(MEDIA_API_PREFIX)) return value;
    return value.replace(mediaUrlRegex(), (match, prefix, raw, offset, whole) => {
      if (prefix !== 'api/media/file' || (offset > 0 && /[\p{L}\p{N}._~%:@/-]/u.test(whole[offset - 1]))) return match;
      try {
        return MEDIA_API_PREFIX + encodeMediaName(decodeURIComponent(raw));
      } catch {
        return match;
      }
    });
  }
  if (Array.isArray(value)) return value.map(canonicalMediaUrls);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = canonicalMediaUrls(v);
    return out;
  }
  return value;
}

module.exports = {
  rewriteMediaUrls,
  mediaPrefixFor,
  collectMediaFilenames,
  citedMediaNames,
  encodeMediaName,
  remapMediaFilenames,
  canonicalMediaUrls,
  MEDIA_API_PREFIX,
  MEDIA_STATIC_PREFIX,
};
