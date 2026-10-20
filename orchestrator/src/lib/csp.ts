// Politique de sécurité du contenu (CSP) de l'orchestrateur compilé : posée en <meta>
// dans dist/index.html au build (plugin orchestratorCsp de vite.config.ts).
//
// Tout est servi par la même origine (SPA, /api, /media) ; aucune ressource tierce
// (polices auto-hébergées). Exceptions justifiées :
// - style-src 'unsafe-inline' : styles en ligne de React (attribut style) ;
// - font-src data: : Vite insère en data: les petits fichiers woff2 (Plus Jakarta Sans) ;
// - img-src https: http: : images des aperçus du CMS (URL saisies, Unsplash) ;
//   data: blob: : aperçu local d'un fichier choisi (image d'inspiration de l'onboarding).
// frame-ancestors est ignoré dans une balise <meta> : à poser en en-tête par l'hébergeur.
export const ORCHESTRATOR_CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export const ORCHESTRATOR_CSP = ORCHESTRATOR_CSP_DIRECTIVES.join('; ');
