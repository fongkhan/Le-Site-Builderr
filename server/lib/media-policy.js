// Politique de publication des médias — fonctions pures, testables sans serveur.
// Seules les images matricielles sont publiées sur un site : un SVG (ou tout fichier
// interprétable par le navigateur : XML, HTML…) peut embarquer du script exécuté sur le
// domaine du site. Liste BLANCHE appliquée à la DERNIÈRE extension (« a.png.svg » refusé).

const PUBLISHABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

function isPublishableMediaName(name) {
  if (typeof name !== 'string' || !name) return false;
  // Jamais de séparateur de chemin : seul un nom de fichier simple est publiable
  if (/[\\/]/.test(name) || name.includes('\0')) return false;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;
  return PUBLISHABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

module.exports = { isPublishableMediaName, PUBLISHABLE_EXTENSIONS };
