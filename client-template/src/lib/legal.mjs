// Mentions légales et politique de confidentialité générées : lecture des informations
// légales transmises au build (PUBLIC_LEGAL_JSON, ou clé « legal » de la fixture),
// adresses des pages par langue et contenu des sections. ESM pur (testé depuis le
// serveur) : n'importe que ./i18n.mjs. Mêmes clés, longueurs et champs obligatoires que
// server/lib/legal.js (test de parité).
import { DEFAULT_LOCALE, LOCALES, normalizeLocale, localePath, localeRouteParam } from './i18n.mjs';

export const LEGAL_FIELDS = [
  { key: 'companyName', max: 200, required: true },
  { key: 'legalForm', max: 200, required: false },
  { key: 'address', max: 400, required: true, multiline: true },
  { key: 'registration', max: 200, required: false },
  { key: 'vatNumber', max: 40, required: false },
  { key: 'phone', max: 40, required: true },
  { key: 'email', max: 200, required: true },
  { key: 'publisherName', max: 200, required: true },
  { key: 'hostName', max: 200, required: true },
  { key: 'hostAddress', max: 400, required: true, multiline: true },
  { key: 'hostPhone', max: 40, required: true },
];

// Adresse des pages générées, par langue (segment simple, jamais réservé).
export const LEGAL_SLUGS = {
  fr: { notice: 'mentions-legales', privacy: 'confidentialite' },
  en: { notice: 'legal-notice', privacy: 'privacy-policy' },
};

export const LEGAL_KINDS = ['notice', 'privacy'];
const ANALYTICS_PROVIDERS = ['', 'ga4', 'matomo'];
const DEFAULT_RETENTION_MONTHS = 12;

// Texte borné : retours chariot unifiés, tabulations en espaces, caractères de contrôle
// retirés ; retour à la ligne gardé seulement pour un champ multiligne.
function cleanText(value, max, multiline = false) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  return (multiline ? text : text.replace(/\n/g, ' ')).trim().slice(0, max).trim();
}

/**
 * Informations légales nettoyées (chaîne JSON ou objet ; JSON invalide → valeurs par
 * défaut). Le texte reste du texte : l'échappement est fait au rendu par Astro.
 */
export function parseLegalInfo(raw) {
  let src = raw;
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw);
    } catch {
      src = null;
    }
  }
  if (!src || typeof src !== 'object' || Array.isArray(src)) src = {};
  const info = {};
  for (const field of LEGAL_FIELDS) info[field.key] = cleanText(src[field.key], field.max, field.multiline);
  const months = Number(src.retentionMonths);
  info.retentionMonths = Number.isFinite(months) && months > 0 ? Math.min(120, Math.max(1, Math.round(months))) : DEFAULT_RETENTION_MONTHS;
  info.visitStats = src.visitStats === true;
  info.analyticsProvider = ANALYTICS_PROVIDERS.includes(src.analyticsProvider) ? src.analyticsProvider : '';
  info.analyticsHost = info.analyticsProvider === 'matomo' ? cleanText(src.analyticsHost, 253) : '';
  return info;
}

/** Champs obligatoires vides, dans l'ordre de LEGAL_FIELDS. */
export function missingLegalFields(info) {
  const src = info && typeof info === 'object' ? info : {};
  return LEGAL_FIELDS.filter((f) => f.required && !(typeof src[f.key] === 'string' && src[f.key].trim())).map((f) => f.key);
}

/**
 * Pages légales de chaque langue servie : langue par défaut toujours, plus les langues
 * de `locales` (celles qui ont une page d'accueil), dans l'ordre de LOCALES. `generated`
 * est faux quand une page du CMS occupe déjà l'adresse : la page du CMS est conservée.
 */
export function legalRoutes(locales, takenRoutes = new Set()) {
  const wanted = new Set([DEFAULT_LOCALE, ...(Array.isArray(locales) ? locales : [])]);
  const routes = [];
  for (const locale of LOCALES.filter((l) => wanted.has(l))) {
    for (const kind of LEGAL_KINDS) {
      const slug = LEGAL_SLUGS[locale][kind];
      const route = localeRouteParam(locale, slug);
      routes.push({ locale, kind, slug, route, generated: !takenRoutes.has(route) });
    }
  }
  return routes;
}

/**
 * Chemin (SANS chemin de base) de la page légale `kind` pour une page en `locale` : celle
 * de sa langue, sinon celle de la langue par défaut ; '' si aucune.
 */
export function legalHref(routes, locale, kind) {
  const list = Array.isArray(routes) ? routes : [];
  const loc = normalizeLocale(locale);
  const found = list.find((r) => r.locale === loc && r.kind === kind) || list.find((r) => r.locale === DEFAULT_LOCALE && r.kind === kind);
  return found ? localePath(found.locale, found.slug) : '';
}

const NOTICE_SECTIONS = [
  { section: 'publisher', keys: ['companyName', 'legalForm', 'address', 'registration', 'vatNumber', 'phone', 'email'] },
  { section: 'director', keys: ['publisherName'] },
  { section: 'host', keys: ['hostName', 'hostAddress', 'hostPhone'] },
];
const REQUIRED = new Set(LEGAL_FIELDS.filter((f) => f.required).map((f) => f.key));

/**
 * Sections des mentions légales : lignes renseignées ; un champ obligatoire vide est
 * signalé (`missing`) en brouillon et omis sur le site publié (raison sociale vide :
 * nom du site). Section vide retirée.
 */
export function noticeSections(info, { draft = false, siteName = '' } = {}) {
  const src = info && typeof info === 'object' ? info : {};
  const sections = [];
  for (const { section, keys } of NOTICE_SECTIONS) {
    const rows = [];
    for (const key of keys) {
      let value = typeof src[key] === 'string' ? src[key].trim() : '';
      if (!value && key === 'companyName' && !draft) value = String(siteName || '').trim();
      if (value) rows.push({ key, value, missing: false });
      else if (draft && REQUIRED.has(key)) rows.push({ key, value: '', missing: true });
    }
    if (rows.length > 0) sections.push({ section, rows });
  }
  return sections;
}

/**
 * Sections de la politique de confidentialité, selon ce que fait réellement le site :
 * formulaires présents, statistiques de visite, mesure d'audience (sinon : aucun cookie).
 */
export function privacySections(info, { formKinds = {} } = {}) {
  const src = info && typeof info === 'object' ? info : {};
  const sections = ['controller'];
  if (formKinds.contact || formKinds.appointment) sections.push('forms');
  if (src.visitStats === true) sections.push('stats');
  sections.push(src.analyticsProvider ? 'analytics' : 'cookies');
  sections.push('rights');
  if (typeof src.hostName === 'string' && src.hostName.trim()) sections.push('hosting');
  return sections;
}
