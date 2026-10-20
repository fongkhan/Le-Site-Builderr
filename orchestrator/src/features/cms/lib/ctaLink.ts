import type { Block, PageDoc } from '../../../types';
import { GENERATED_LEGAL_PAGES } from '../../legal/legalModel';
import { DEFAULT_LOCALE, HOME_SLUG, pageLocale } from './editorModel';
import { isReservedPageSlug, pageAddress } from './pageSlug';

// Lien des boutons d'action (bannière, formules, produits) : champ ctaLink.
// Mêmes règles que le template (client-template/src/lib/links.mjs) :
// - vide → Automatique : formulaire de contact ou de rendez-vous (de la page, sinon d'une
//   autre page de la même langue) ; sans formulaire, pas de bouton ;
// - « #id » (lettre puis lettres, chiffres, _ ou -, 64 au plus) → formulaire de la page ;
// - « /chemin/ » → page générée (segments [A-Za-z0-9_-], « / » final ajouté) ;
// - http(s):// (domaine nu complété en https), ouvert dans un nouvel onglet ;
// - « tel:… » (au moins 3 chiffres) et « mailto:adresse ».
// Le template ignore tout le reste (le bouton revient au mode Automatique) : l'éditeur
// avertit, sans bloquer la saisie.

export type LinkMode = 'auto' | 'anchor' | 'page' | 'web' | 'tel' | 'email';

export interface LinkTarget {
  label: string;
  href: string;
}

export interface LinkTargets {
  /** Pages générées du site (adresses normalisées), plus l'index du blog et les pages légales générées */
  pages: LinkTarget[];
  /** Formulaires de la page courante (#contact, #rendez-vous) */
  anchors: LinkTarget[];
  /** Mode Automatique utilisable : une page de la même langue a un formulaire */
  autoHasForm: boolean;
}

export interface LinkHint {
  text: string;
  warning: boolean;
}

const MAX_URL_LENGTH = 2048;
const ANCHOR_RE = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PAGE_PATH_RE = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;
const BLOG_ARTICLE_RE = /^\/blog\/[A-Za-z0-9_-]+\/$/;
// Domaine nu saisi sans schéma (« www.planity.com/atelier ») : complété en https.
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#]|$)/i;
const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]+$/;

const FORM_ANCHORS: Record<string, LinkTarget> = {
  contact: { label: 'Formulaire de contact', href: '#contact' },
  appointment: { label: 'Formulaire de rendez-vous', href: '#rendez-vous' },
};
const BLOG_TARGET: LinkTarget = { label: 'Actualités (/blog/)', href: '/blog/' };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const hasControlChar = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export function linkMode(value: string | null | undefined): LinkMode {
  const raw = text(value);
  if (!raw) return 'auto';
  if (raw.startsWith('#')) return 'anchor';
  if (raw.startsWith('/')) return 'page';
  if (/^tel:/i.test(raw)) return 'tel';
  if (/^mailto:/i.test(raw)) return 'email';
  return 'web';
}

export function isValidAnchor(value: string | null | undefined): boolean {
  return ANCHOR_RE.test(text(value));
}

/** « /cours » → « /cours/ » ; null si ce n'est pas un chemin de page valide */
export function normalizePagePath(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!PAGE_PATH_RE.test(raw)) return null;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function isValidWebUrl(value: string | null | undefined): boolean {
  const raw = text(value);
  if (!raw || raw.length > MAX_URL_LENGTH || hasControlChar(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(BARE_DOMAIN.test(raw) ? `https://${raw}` : raw);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '' && !parsed.username && !parsed.password;
}

/** « tel:… » : chiffres et « + » initial, au moins 3 chiffres */
export function isValidTel(value: string | null | undefined): boolean {
  const raw = text(value);
  if (!/^tel:/i.test(raw)) return false;
  const digits = raw.slice(4).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /\d{3,}/.test(digits);
}

/** « mailto:adresse » avec une adresse plausible */
export function isValidEmail(value: string | null | undefined): boolean {
  const raw = text(value);
  return /^mailto:/i.test(raw) && EMAIL_RE.test(raw.slice(7).trim());
}

type LinkablePage = Pick<PageDoc, 'title' | 'slug' | 'locale'> & { layout: readonly Pick<Block, 'blockType'>[] };

const isFormBlock = (blockType: string) => Object.hasOwn(FORM_ANCHORS, blockType);
const hasForm = (page: LinkablePage) => page.layout.some((b) => isFormBlock(b.blockType));
// Page réellement générée : les adresses réservées de la langue par défaut sont ignorées au build
const isGenerated = (page: LinkablePage) => !(pageLocale(page) === DEFAULT_LOCALE && isReservedPageSlug(page.slug));

// Cibles proposées pour les boutons de la page courante : pages générées (adresses
// dédupliquées, pages réservées exclues comme au build), index du blog, pages légales
// générées, formulaires de la page, et disponibilité du mode Automatique dans la langue de
// la page.
export function linkTargetsFor(pages: readonly LinkablePage[], current: LinkablePage): LinkTargets {
  const seen = new Set<string>();
  const pageTargets: LinkTarget[] = [];
  const addTarget = (label: string, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    pageTargets.push({ label: `${label} (${href})`, href });
  };
  for (const page of pages) {
    if (isGenerated(page)) addTarget(page.title || page.slug, pageAddress(page.slug, pageLocale(page)));
  }
  if (!seen.has(BLOG_TARGET.href)) {
    seen.add(BLOG_TARGET.href);
    pageTargets.push(BLOG_TARGET);
  }

  // Pages légales générées au build (mentions légales, confidentialité) : langue par
  // défaut et langues qui ont une page d'accueil, celles de la langue de la page en tête.
  // Une page du CMS à la même adresse la remplace (déjà proposée sous son titre).
  const locale = pageLocale(current);
  const served = new Set([DEFAULT_LOCALE, ...pages.filter((p) => p.slug === HOME_SLUG).map(pageLocale)]);
  const legalPages = GENERATED_LEGAL_PAGES.filter((g) => served.has(g.locale));
  for (const legal of [...legalPages.filter((g) => g.locale === locale), ...legalPages.filter((g) => g.locale !== locale)]) {
    addTarget(legal.label, pageAddress(legal.slug, legal.locale));
  }

  // Ancres des formulaires de la page, comme au build : #contact, puis #contact-2…
  const counts: Record<string, number> = {};
  const anchors: LinkTarget[] = [];
  for (const block of current.layout) {
    if (!isFormBlock(block.blockType)) continue;
    const base = FORM_ANCHORS[block.blockType];
    const n = (counts[block.blockType] = (counts[block.blockType] || 0) + 1);
    anchors.push(n === 1 ? base : { label: `${base.label} (${n})`, href: `${base.href}-${n}` });
  }
  const autoHasForm = pages.some((p) => pageLocale(p) === locale && isGenerated(p) && hasForm(p));
  return { pages: pageTargets, anchors, autoHasForm };
}

// Indication affichée sous le sélecteur de lien (avertissement si le lien sera ignoré).
// Sans cibles : contrôle de syntaxe seulement.
export function linkHint(value: string | null | undefined, targets?: LinkTargets): LinkHint | null {
  const suffix = targets && !targets.autoHasForm ? 'le bouton ne sera pas affiché.' : 'le bouton mène au formulaire du site.';
  const warn = (message: string): LinkHint => ({ text: message, warning: true });
  const unknown = warn(`Ce lien ne correspond à aucune page ni à aucun formulaire de la page : ${suffix}`);
  switch (linkMode(value)) {
    case 'auto':
      if (targets && !targets.autoHasForm) {
        return warn('Aucun formulaire de contact ou de rendez-vous dans cette langue : le bouton ne sera pas affiché. Choisissez une page ou un lien.');
      }
      return { text: "Le bouton mène au formulaire de contact ou de rendez-vous du site (rendez-vous si son texte l'évoque).", warning: false };
    case 'anchor': {
      const anchor = text(value);
      const known = isValidAnchor(anchor) && (!targets || targets.anchors.some((a) => a.href === anchor));
      return known ? null : unknown;
    }
    case 'page': {
      const path = normalizePagePath(value);
      if (path === null) return unknown;
      if (BLOG_ARTICLE_RE.test(path)) return { text: "Lien vers un article du blog : il fonctionne tant que l'article est publié.", warning: false };
      return !targets || targets.pages.some((p) => p.href === path) ? null : unknown;
    }
    case 'web':
      return isValidWebUrl(value)
        ? { text: "Le lien s'ouvre dans un nouvel onglet.", warning: false }
        : warn(`Adresse web invalide (ex. https://www.exemple.fr/reservation) : ${suffix}`);
    case 'tel':
      return isValidTel(value) ? null : warn(`Numéro de téléphone incomplet : ${suffix}`);
    case 'email':
      return isValidEmail(value) ? null : warn(`Adresse email invalide : ${suffix}`);
  }
}
