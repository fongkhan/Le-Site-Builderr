// Page 404 d'un site servi par l'orchestrateur (/preview, /draft) : fichiers « 404.html »
// candidats pour un chemin demandé, du dossier le plus profond au plus court (la 404 d'une
// langue, /en/404.html, avant celle du site). Fonction pure : aucun accès disque.
const { isSwapDirRequest } = require('./fs-swap');

// Chemin hostile ou illisible (traversée, séparateur Windows, octet nul, copie de bascule)
// → aucun candidat. Les chemins renvoyés sont relatifs à la racine servie, séparés par « / ».
function notFoundCandidates(reqPath, maxDepth = 8) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(reqPath || ''));
  } catch {
    return [];
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return [];
  if (isSwapDirRequest(reqPath)) return [];
  const out = [];
  for (let i = Math.min(segments.length, maxDepth); i >= 1; i--) {
    out.push(`${segments.slice(0, i).join('/')}/404.html`);
  }
  return out;
}

module.exports = { notFoundCandidates };
