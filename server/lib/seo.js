// Génération de sitemap.xml et robots.txt pour les sites publiés.
// Fonctions pures (chaînes en entrée/sortie) : testables sans DB ni serveur.

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// URLs canoniques : la page « home » vit à la racine, les autres sous /<slug>/
// (Astro SSG génère un répertoire par page).
function pageUrl(domain, slug) {
  const base = `https://${domain}`;
  return slug === 'home' ? `${base}/` : `${base}/${slug}/`;
}

function generateSitemap(domain, slugs, lastmod = new Date().toISOString().slice(0, 10)) {
  const urls = slugs
    .map((slug) => `  <url>\n    <loc>${escapeXml(pageUrl(domain, slug))}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function generateRobots(domain) {
  return `User-agent: *\nAllow: /\n\nSitemap: https://${domain}/sitemap.xml\n`;
}

module.exports = { generateSitemap, generateRobots, pageUrl };
