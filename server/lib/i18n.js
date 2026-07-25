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

module.exports = {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  normalizeLocale,
  localePath,
  localeRouteParam,
  localesInPages,
};
