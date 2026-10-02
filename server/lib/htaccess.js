// .htaccess des sites publiés sur l'hébergement Apache (mode cPanel, site à la racine de
// son domaine). Fonction pure : testable sans serveur.
//
// - page d'erreur : la 404.html générée par le template (adresse absolue, valable
//   uniquement quand le site est servi à la racine « / ») ;
// - pas de listing de dossier ;
// - cache : ressources Astro (/_astro/, noms hachés) et polices immuables un an, HTML
//   revalidé rapidement pour qu'une publication soit visible tout de suite ;
// - compression et expiration par défaut.
// Chaque directive de module est sous <IfModule> : un module absent chez l'hébergeur ne
// provoque jamais d'erreur 500. Aucune réécriture d'URL (pas de RewriteEngine).

// Route du template réservée à la page d'erreur (jamais listée dans le sitemap).
const ERROR_PAGE_ROUTE = '404';

function generateHtaccess() {
  return [
    '# Généré automatiquement à chaque publication : ne pas modifier à la main.',
    '',
    `ErrorDocument 404 /${ERROR_PAGE_ROUTE}.html`,
    'Options -Indexes',
    '',
    '<IfModule mod_headers.c>',
    '  <If "%{REQUEST_URI} =~ m#^/_astro/#">',
    '    Header set Cache-Control "public, max-age=31536000, immutable"',
    '  </If>',
    '  <FilesMatch "\\.woff2$">',
    '    Header set Cache-Control "public, max-age=31536000, immutable"',
    '  </FilesMatch>',
    '  <FilesMatch "\\.html$">',
    '    Header set Cache-Control "public, max-age=300, must-revalidate"',
    '  </FilesMatch>',
    '</IfModule>',
    '',
    '<IfModule mod_deflate.c>',
    '  AddOutputFilterByType DEFLATE text/html text/plain text/css text/xml application/xml application/javascript text/javascript application/json application/ld+json image/svg+xml',
    '</IfModule>',
    '',
    '<IfModule mod_expires.c>',
    '  ExpiresActive On',
    '  ExpiresDefault "access plus 1 hour"',
    '  ExpiresByType text/html "access plus 5 minutes"',
    '  ExpiresByType image/jpeg "access plus 1 month"',
    '  ExpiresByType image/png "access plus 1 month"',
    '  ExpiresByType image/webp "access plus 1 month"',
    '  ExpiresByType image/svg+xml "access plus 1 month"',
    '  ExpiresByType font/woff2 "access plus 1 year"',
    '</IfModule>',
    '',
  ].join('\n');
}

module.exports = { generateHtaccess, ERROR_PAGE_ROUTE };
