// Politique de publication des médias — fonctions pures, testables sans serveur.
// Seules les images matricielles sont publiées sur un site : un SVG (ou tout fichier
// interprétable par le navigateur : XML, HTML…) peut embarquer du script exécuté sur le
// domaine du site. Liste BLANCHE appliquée à la DERNIÈRE extension (« a.png.svg » refusé).

// AVIF : matriciel et sans risque (déjà publié avant la restriction des formats) ;
// jfif/jpe : variantes d'extension JPEG que Payload conserve telles quelles.
const PUBLISHABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'gif', 'avif']);

// Taille maximale d'un fichier téléversé (Mo, défaut 8) : source unique pour Payload
// (payload.config.ts) et pour l'orchestrateur (/api/config → mediaMaxMb).
const DEFAULT_MEDIA_MAX_MB = 8;
function mediaMaxMb(value = process.env.MEDIA_MAX_MB) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MEDIA_MAX_MB;
}

function isPublishableMediaName(name) {
  if (typeof name !== 'string' || !name) return false;
  // Jamais de séparateur de chemin : seul un nom de fichier simple est publiable
  if (/[\\/]/.test(name) || name.includes('\0')) return false;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;
  return PUBLISHABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

module.exports = { isPublishableMediaName, PUBLISHABLE_EXTENSIONS, mediaMaxMb, DEFAULT_MEDIA_MAX_MB };
