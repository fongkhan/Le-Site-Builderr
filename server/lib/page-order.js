// Ordre des pages dans le menu — fonction pure, importable sans booter le serveur.
// navOrder est écrit par le CMS (position dans la liste envoyée) ; une page créée hors du
// CMS (admin Payload, REST) n'en a pas et passe en fin de menu. Égalités et trous tolérés.

const hasOrder = (v) => typeof v === 'number' && Number.isFinite(v);

function compareText(a, b) {
  const x = a === undefined || a === null ? '' : String(a);
  const y = b === undefined || b === null ? '' : String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function comparePages(a, b) {
  const oa = hasOrder(a.navOrder);
  const ob = hasOrder(b.navOrder);
  if (oa && ob && a.navOrder !== b.navOrder) return a.navOrder - b.navOrder;
  if (oa !== ob) return oa ? -1 : 1; // sans ordre : en dernier
  // Égalité : date de création, puis identifiant (numérique si possible)
  const byDate = compareText(a.createdAt, b.createdAt);
  if (byDate !== 0) return byDate;
  if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
  return compareText(a.id, b.id);
}

// Copie triée : navOrder croissant (absent en dernier), puis createdAt, puis id. Le tri
// est stable : des pages sans aucun de ces champs (fichier JSON) gardent leur ordre.
function sortPages(docs) {
  return [...(Array.isArray(docs) ? docs : [])].sort(comparePages);
}

module.exports = { sortPages };
