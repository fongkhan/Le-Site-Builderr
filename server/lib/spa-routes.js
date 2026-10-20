// Interface de l'orchestrateur servie par le serveur en production : quels chemins
// reçoivent la page de l'application (index.html, routage côté navigateur) ?
// Jamais les espaces du serveur (API, admin Payload, Next, webhooks, aperçus,
// brouillons, canal interne) ni un chemin de fichier (extension dans le dernier
// segment : /server/.env, /x.php, /favicon.svg) : ceux-là gardent leur propre 404.
const RESERVED_PREFIXES = ['/api', '/admin', '/_next', '/webhook', '/preview', '/draft', '/internal'];

function isOrchestratorPagePath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return false;
  // Segment entier : /admin et /admin/login sont réservés, /admin-panel ne l'est pas
  if (RESERVED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'))) return false;
  const last = p.slice(p.lastIndexOf('/') + 1);
  return !/\.[^.]+$/.test(last);
}

module.exports = { isOrchestratorPagePath, RESERVED_PREFIXES };
