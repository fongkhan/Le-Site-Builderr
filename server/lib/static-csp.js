// Content-Security-Policy des fichiers des sites servis par l'orchestrateur (/preview,
// /draft). Fonction pure : testable sans serveur.
//
// - SVG, XML, XSL : formats interprétables par le navigateur qui peuvent porter du
//   script ; servis dans un bac à sable sans script ni ressource externe ;
// - HTML : pages du site (scripts et styles du template autorisés) ; ni plugin (object),
//   ni <base> vers un autre domaine, ni affichage dans le cadre d'un autre site ;
// - autres fichiers (CSS, JS, images…) : aucune politique (null).

const SANDBOXED_EXT = /\.(svgz?|xml|xsl)$/i;
const HTML_EXT = /\.html?$/i;

const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const HTML_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

function staticCspFor(filePath) {
  if (typeof filePath !== 'string') return null;
  if (SANDBOXED_EXT.test(filePath)) return SANDBOX_CSP;
  if (HTML_EXT.test(filePath)) return HTML_CSP;
  return null;
}

module.exports = { staticCspFor, SANDBOX_CSP, HTML_CSP };
