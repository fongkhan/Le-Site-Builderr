// Helpers purs pour le multilingue : langues supportées et construction des chemins.
// La langue par défaut est servie à la racine ; les autres sont préfixées (/en/…).
// Testables sans serveur ; la même règle est appliquée côté template Astro.

const LOCALES = ['fr', 'en'];
const DEFAULT_LOCALE = 'fr';

const LOCALE_LABELS = { fr: 'Français', en: 'English' };

function normalizeLocale(locale) {
  return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

// Chemin public d'une page. `home` est la page d'accueil de sa langue.
// fr+home → '/', fr+contact → '/contact/', en+home → '/en/', en+contact → '/en/contact/'
function localePath(locale, slug) {
  const loc = normalizeLocale(locale);
  const prefix = loc === DEFAULT_LOCALE ? '' : `/${loc}`;
  return slug === 'home' ? `${prefix}/` : `${prefix}/${slug}/`;
}

// Segments de route Astro (sans slash initial/final) : '' pour l'accueil par défaut.
// Utilisé par getStaticPaths de la route attrape-tout.
function localeRouteParam(locale, slug) {
  return localePath(locale, slug).replace(/^\/|\/$/g, '');
}

// Langues réellement présentes dans un ensemble de pages, dans l'ordre de LOCALES.
function localesInPages(pages) {
  const present = new Set((pages || []).map((p) => normalizeLocale(p && p.locale)));
  return LOCALES.filter((l) => present.has(l));
}

// Adresses réservées pour une page de la langue par défaut (servie à la racine) :
// « blog » est la route du blog et chaque code de langue préfixe ses pages (/en/…).
// Une page CMS à cette adresse serait masquée : ni générée, ni listée dans le sitemap.
const RESERVED_ROOT_SLUGS = new Set(['blog', ...LOCALES.filter((l) => l !== DEFAULT_LOCALE)]);

function isRoutablePage(locale, slug) {
  return !(normalizeLocale(locale) === DEFAULT_LOCALE && RESERVED_ROOT_SLUGS.has(slug));
}

// Adresse de page ou d'article générée par le template (même expression que SLUG_RE dans
// client-template/src/lib/content.ts) : un segment simple, jamais de « / » ni d'espace.
const ROUTE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Routes réellement générées par le template, dans le format du sitemap (« home » pour
// l'accueil par défaut) : mêmes filtres que le build Astro (adresse valide, non réservée,
// première occurrence d'une route ; articles avec titre, sans doublon). Le contenu créé
// hors du CMS (admin ou REST Payload) n'est pas validé à l'écriture.
function publishedRoutes(pages, posts) {
  const routes = [];
  const seen = new Set();
  for (const p of pages || []) {
    if (!p || typeof p.slug !== 'string' || !ROUTE_SLUG_RE.test(p.slug) || !isRoutablePage(p.locale, p.slug)) continue;
    const route = localeRouteParam(p.locale, p.slug) || 'home';
    if (seen.has(route)) continue;
    seen.add(route);
    routes.push(route);
  }
  const postSlugs = new Set();
  for (const p of posts || []) {
    if (p && typeof p.slug === 'string' && ROUTE_SLUG_RE.test(p.slug) && p.title) postSlugs.add(p.slug);
  }
  if (postSlugs.size > 0) routes.push('blog', ...[...postSlugs].map((s) => `blog/${s}`));
  return routes;
}

module.exports = {
  ROUTE_SLUG_RE,
  publishedRoutes,
  RESERVED_ROOT_SLUGS,
  isRoutablePage,
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  normalizeLocale,
  localePath,
  localeRouteParam,
  localesInPages,
};
