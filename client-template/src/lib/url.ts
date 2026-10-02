// URLs du site généré : chemin de base et filtrage des URLs saisies par le client.
//
// Chemin de base : le même build est servi à la racine d'un domaine (« / », production
// cPanel) ou sous un sous-chemin de l'orchestrateur (« /preview/<slug> » en publication
// simulée, « /draft/<slug> » pour un brouillon). Astro le reçoit via SITE_BASE_PATH
// (astro.config.mjs) et l'expose dans import.meta.env.BASE_URL : TOUT lien interne doit
// passer par withBase() pour fonctionner dans les trois cas.
//
// URLs saisies par le client (réseaux sociaux, images, fiche Google…) : jamais rendues
// telles quelles dans un href/src — un « javascript: » y serait une XSS stockée.

// Préfixe de base sans slash final (« » à la racine, « /preview/demo » sinon).
const BASE_PREFIX = String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

// Liens déjà absolus ou ancres de la page courante : jamais préfixés.
const UNPREFIXED = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Préfixe un chemin interne du site (« /blog/ », « /en/ », « /favicon.svg ») par le chemin de base. */
export function withBase(path: string): string {
  const p = String(path || '/');
  if (UNPREFIXED.test(p)) return p;
  return `${BASE_PREFIX}${p.startsWith('/') ? p : `/${p}`}`;
}

/** Retire le chemin de base d'un chemin servi (« /preview/demo/en/ » → « /en/ »). */
export function stripBase(pathname: string): string {
  const p = String(pathname || '/');
  if (!BASE_PREFIX) return p;
  if (p === BASE_PREFIX) return '/';
  return p.startsWith(`${BASE_PREFIX}/`) ? p.slice(BASE_PREFIX.length) : p;
}

export interface SafeUrlOptions {
  /** Autorise « mailto: » (lien email). */
  mailto?: boolean;
  /** Autorise « tel: » (lien téléphone). */
  tel?: boolean;
  /** Autorise un chemin relatif à la racine (« /media/x.jpg », médias du site). Vrai par défaut. */
  relative?: boolean;
}

// Domaine nu saisi sans schéma (« www.facebook.com/ma-page ») : complété en https.
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#]|$)/i;

/**
 * URL sûre pour un attribut href/src, ou '' si elle doit être ignorée.
 * Schémas acceptés : http(s) (+ mailto/tel sur option) ; chemins « /… » du site.
 * Tout le reste (javascript:, data:, vbscript:, « //hôte », « /\hôte »…) est rejeté.
 */
export function safeHttpUrl(value: unknown, options: SafeUrlOptions = {}): string {
  const { mailto = false, tel = false, relative = true } = options;
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  // Caractères de contrôle (tabulation, retour ligne…) : ignorés par les navigateurs
  // dans un schéma (« java\tscript: »), donc refusés d'emblée.
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) return '';

  if (raw.startsWith('/')) {
    // « //hôte » et « /\hôte » sont des URLs vers un autre domaine, pas des chemins.
    if (!relative || raw.startsWith('//') || raw.startsWith('/\\')) return '';
    return raw;
  }

  const candidate = BARE_DOMAIN.test(raw) ? `https://${raw}` : raw;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  const allowed = ['http:', 'https:'];
  if (mailto) allowed.push('mailto:');
  if (tel) allowed.push('tel:');
  if (!allowed.includes(parsed.protocol)) return '';
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) return '';
  return parsed.href;
}

/**
 * Valeur CSS « url("…") » pour une image saisie par le client (fond du Hero…), ou ''
 * si l'URL est refusée. L'URL est filtrée (safeHttpUrl) puis placée dans une chaîne
 * CSS échappée : impossible d'en sortir pour injecter d'autres déclarations.
 */
export function cssUrl(value: unknown): string {
  const url = safeHttpUrl(value);
  if (!url) return '';
  const escaped = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
  return `url("${escaped}")`;
}

/**
 * URL absolue publique (Open Graph, JSON-LD, hreflang) à partir d'un chemin du site
 * (avec ou sans chemin de base) ou d'une URL déjà absolue. '' si impossible (pas d'URL
 * publique connue, cas d'un brouillon ou d'un build local).
 */
export function absoluteUrl(pathOrUrl: string, siteUrl: string): string {
  const safe = safeHttpUrl(pathOrUrl);
  if (!safe) return '';
  if (!safe.startsWith('/')) return safe;
  if (!siteUrl) return '';
  // Le site public est servi à la racine de son domaine : on retire le chemin de base
  // d'aperçu (« /preview/<slug> ») éventuellement présent dans le chemin.
  return siteUrl.replace(/\/+$/, '') + stripBase(safe);
}

/** Adresse email plausible (sinon affichée sans lien). */
export function safeMailto(email: unknown): string {
  if (typeof email !== 'string') return '';
  const e = email.trim();
  return /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]+$/.test(e) ? `mailto:${e}` : '';
}

/** Lien « tel: » limité aux chiffres et au « + » initial (sinon affiché sans lien). */
export function safeTel(phone: unknown): string {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /\d{3,}/.test(digits) ? `tel:${digits}` : '';
}
