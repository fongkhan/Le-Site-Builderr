// Parité sitemap / pages générées : le sitemap que le serveur écrit à la publication
// (server/lib/i18n.js publishedRoutes + server/lib/seo.js generateSitemap, fonctions
// pures) liste exactement les pages que le template a générées à partir du même contenu.
// La fixture est relue ici (TEMPLATE_FIXTURE n'est pas transmis au script en CI) ; comme
// le canal interne, seuls les articles publiés comptent.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publishedRoutes } = require('../../../server/lib/i18n.js');
const { generateSitemap } = require('../../../server/lib/seo.js');

const DOMAIN = 'fixture.example';

// Pages générées hors sitemap par choix : page d'erreur, et pages légales générées par le
// template (mentions légales, politique de confidentialité), liées en bas de chaque page
// mais jamais listées dans le sitemap. La page CMS fr/mentions-legales, prioritaire, y figure.
const TECHNICAL_PAGES = new Set([
  '404.html',
  'confidentialite/index.html',
  'en/legal-notice/index.html',
  'en/privacy-policy/index.html',
]);

// '/' → index.html ; '/a/b/' → a/b/index.html
const fileOfUrlPath = (urlPath) => `${urlPath.replace(/^\/+|\/+$/g, '')}/index.html`.replace(/^\//, '');

export default async function ({ dist, htmlFiles, check }) {
  const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/site.json', import.meta.url), 'utf-8'));
  const pages = (fixture.pages && fixture.pages.docs) || [];
  const posts = ((fixture.posts && fixture.posts.docs) || []).filter((p) => !p.status || p.status === 'published');
  const routes = publishedRoutes(pages, posts);

  // 1. Aucune route en double
  const seen = new Set();
  for (const route of routes) {
    check(!seen.has(route), `route en double dans le sitemap : ${route}`);
    seen.add(route);
  }

  // 2. Chaque URL du sitemap a sa page générée
  const prefix = `https://${DOMAIN}`;
  const sitemapFiles = new Set();
  for (const [, loc] of generateSitemap(DOMAIN, routes).matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const urlPath = loc.startsWith(prefix) ? loc.slice(prefix.length) : loc;
    const file = fileOfUrlPath(urlPath);
    sitemapFiles.add(file);
    check(fs.existsSync(path.join(dist, ...file.split('/'))), `URL du sitemap sans page générée : ${urlPath}`);
  }

  // 3. Chaque page générée figure dans le sitemap (hors pages techniques ; la page du blog
  //    existe aussi sans article publié, mais n'est alors pas listée)
  for (const full of htmlFiles) {
    const rel = path.relative(dist, full).split(path.sep).join('/');
    const listed = sitemapFiles.has(rel)
      || TECHNICAL_PAGES.has(rel)
      || (rel === 'blog/index.html' && !routes.includes('blog'));
    check(listed, `page générée absente du sitemap : ${rel}`);
  }
}
