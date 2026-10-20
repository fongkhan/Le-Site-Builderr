// Adresse (slug) d'une nouvelle page. Même translittération que le serveur
// (server/lib/paths.js, generateSlug) : accents retirés (NFD), ligatures œ/æ/ß développées.
// Le serveur n'accepte que ^[A-Za-z0-9][A-Za-z0-9_-]*$ (200 caractères au plus).

import { DEFAULT_LOCALE, HOME_SLUG } from './editorModel';

/** Adresses déjà utilisées par le site généré (blog, médias, préfixes de langue, page d'erreur) */
export const RESERVED_PAGE_SLUGS: readonly string[] = ['blog', 'media', 'en', 'fr', '404'];

const MAX_SLUG_LENGTH = 80;
const FALLBACK_SLUG = 'page';

export function slugifyPageTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
}

export function isReservedPageSlug(slug: string): boolean {
  return RESERVED_PAGE_SLUGS.includes(slug);
}

export interface DerivedPageSlug {
  slug: string;
  /** Message à afficher si l'adresse ne peut pas être utilisée */
  error: string | null;
}

// Slug d'une nouvelle page, dédupliqué DANS SA LANGUE (« home » peut exister en fr et en en).
// Un titre sans lettre latine (« !!! », alphabet non latin) donne « page », « page-2 »…
export function derivePageSlug(title: string, locale: string, existing: readonly { slug: string; locale?: string }[]): DerivedPageSlug {
  const base = slugifyPageTitle(title) || FALLBACK_SLUG;
  if (isReservedPageSlug(base)) {
    return { slug: base, error: `L'adresse « /${base}/ » est réservée par le site : choisissez un autre titre.` };
  }
  const taken = new Set(existing.filter((p) => (p.locale || DEFAULT_LOCALE) === locale).map((p) => p.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return { slug, error: null };
}

// Adresse publique d'une page : /contact/, /en/contact/, / pour l'accueil.
export function pageAddress(slug: string, locale: string = DEFAULT_LOCALE): string {
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return `${prefix}/${slug === HOME_SLUG ? '' : `${slug}/`}`;
}
