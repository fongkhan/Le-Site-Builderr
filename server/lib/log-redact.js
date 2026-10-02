// Masquage des chemins serveur dans un texte destiné au journal de build (lisible par
// le client propriétaire du site) : un chemin absolu est remplacé par un repère court.
// Fonctions pures, sans accès disque.
const path = require('path');

// Remplacements utilisables : [chemin, repère], du plus long au plus court (un dossier
// du projet est masqué avant le dossier personnel qui le contient). Une racine vide ou
// réduite à « / » est ignorée : la masquer effacerait tous les séparateurs.
function normalizeReplacements(replacements) {
  return replacements
    .filter(([from]) => typeof from === 'string' && from.replace(/[\\/]+$/, '').length > 1)
    .map(([from, to]) => [from.replace(/[\\/]+$/, ''), to])
    .sort((a, b) => b[0].length - a[0].length);
}

function redactPaths(text, replacements) {
  let out = String(text);
  for (const [from, to] of normalizeReplacements(replacements)) out = out.split(from).join(to);
  return out;
}

// Variante au fil de l'eau : la sortie d'une commande arrive par paquets et un chemin peut
// être coupé entre deux paquets. La fin d'un paquet qui pourrait être le début d'un chemin
// masqué est retenue (texte brut) jusqu'au paquet suivant ou jusqu'à flush() ; le texte
// rendu ne contient que des occurrences complètes, masquées.
function createPathRedactor(replacements) {
  const list = normalizeReplacements(replacements);
  let carry = '';
  // Position de coupure : début du plus long suffixe qui commence un chemin masqué, reculée
  // si elle tombe au milieu d'une occurrence complète (chemins imbriqués).
  const cutIndex = (text) => {
    let held = 0;
    for (const [from] of list) {
      const max = Math.min(from.length - 1, text.length);
      for (let n = max; n > held; n--) {
        if (from.startsWith(text.slice(text.length - n))) { held = n; break; }
      }
    }
    let cut = text.length - held;
    for (let moved = true; moved && cut > 0;) {
      moved = false;
      for (const [from] of list) {
        const start = text.lastIndexOf(from, cut - 1);
        if (start !== -1 && start < cut && start + from.length > cut) { cut = start; moved = true; }
      }
    }
    return cut;
  };
  return {
    push(text) {
      const joined = carry + String(text);
      const cut = cutIndex(joined);
      carry = joined.slice(cut);
      return redactPaths(joined.slice(0, cut), list);
    },
    flush() {
      const rest = redactPaths(carry, list);
      carry = '';
      return rest;
    },
  };
}

// Chemin affichable dans le journal : relatif à la racine du projet quand il s'y trouve,
// sinon son seul dernier segment (jamais de chemin absolu).
function displayPath(target, root) {
  const abs = path.resolve(String(target || ''));
  const rel = path.relative(path.resolve(String(root || '/')), abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  return path.basename(abs);
}

module.exports = { redactPaths, createPathRedactor, displayPath };
