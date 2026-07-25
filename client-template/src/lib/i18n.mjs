// Multilingue côté template — MÊME RÈGLE que server/lib/i18n.js (un test unitaire
// vérifie que les deux implémentations restent identiques).
// La langue par défaut est servie à la racine ; les autres sont préfixées (/en/…).

export const LOCALES = ['fr', 'en'];
export const DEFAULT_LOCALE = 'fr';
export const LOCALE_LABELS = { fr: 'Français', en: 'English' };

export function normalizeLocale(locale) {
  return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

export function localePath(locale, slug) {
  const loc = normalizeLocale(locale);
  const prefix = loc === DEFAULT_LOCALE ? '' : `/${loc}`;
  return slug === 'home' ? `${prefix}/` : `${prefix}/${slug}/`;
}

export function localeRouteParam(locale, slug) {
  return localePath(locale, slug).replace(/^\/|\/$/g, '');
}

export function localesInPages(pages) {
  const present = new Set((pages || []).map((p) => normalizeLocale(p && p.locale)));
  return LOCALES.filter((l) => present.has(l));
}
