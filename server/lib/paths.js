// Helpers purs (sans I/O ni dépendance au serveur) : slug et confinement de chemins.
// Importables tels quels par les tests unitaires (node --test), sans booter Payload/Express.

const path = require('path');

// Transforme un nom en slug URL-safe ET le valide. Renvoie null si le résultat
// est vide ou non conforme (ex. nom sans caractère alphanumérique : "!!!", "🎉").
// Un slug vide provoquait documentRoot = dossier partagé → wipe de tous les sites.
function generateSlug(name) {
  if (typeof name !== 'string') return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

// Vérifie que `p` reste confiné dans `base` (égal à base, ou strictement dessous).
// Le suffixe path.sep évite le faux positif "/base-evil".startsWith("/base").
// Lève une erreur si le chemin s'échappe de la base autorisée.
function assertSafePath(p, base) {
  const resolved = path.resolve(p);
  const resolvedBase = path.resolve(base);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Chemin non autorisé : "${p}" doit rester sous "${base}".`);
  }
  return resolved;
}

module.exports = { generateSlug, assertSafePath };
