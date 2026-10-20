// Modèle de l'onglet « Infos légales » : champs (mêmes clés, libellés, longueurs et champs
// obligatoires que server/lib/legal.js — test de parité côté serveur), pages légales
// générées sur le site publié et calculs purs (collisions, pré-remplissage, manques).

import type { LegalInfo, PageDoc } from '../../types';
import { DEFAULT_LOCALE, HOME_SLUG } from '../cms/lib/editorModel';
import { pageAddress } from '../cms/lib/pageSlug';

export type LegalGroup = 'publisher' | 'director' | 'host';

export interface LegalFieldDef {
  key: keyof LegalInfo;
  label: string;
  max: number;
  required: boolean;
  multiline: boolean;
  group: LegalGroup;
  placeholder?: string;
  type?: 'email' | 'tel';
}

export const LEGAL_FIELDS: readonly LegalFieldDef[] = [
  { key: 'companyName', label: "Raison sociale ou nom de l'éditeur", max: 200, required: true, multiline: false, group: 'publisher' },
  { key: 'legalForm', label: 'Forme juridique et capital', max: 200, required: false, multiline: false, group: 'publisher', placeholder: 'Ex. SARL au capital de 5 000 €' },
  { key: 'address', label: 'Adresse du siège', max: 400, required: true, multiline: true, group: 'publisher' },
  { key: 'registration', label: 'Immatriculation (SIREN, RCS ou RM)', max: 200, required: false, multiline: false, group: 'publisher', placeholder: 'Ex. RCS Lyon 123 456 789' },
  { key: 'vatNumber', label: 'N° de TVA intracommunautaire', max: 40, required: false, multiline: false, group: 'publisher', placeholder: 'Ex. FR12345678901' },
  { key: 'phone', label: 'Téléphone', max: 40, required: true, multiline: false, group: 'publisher', type: 'tel' },
  { key: 'email', label: 'Email de contact', max: 200, required: true, multiline: false, group: 'publisher', type: 'email' },
  { key: 'publisherName', label: 'Directeur ou directrice de la publication', max: 200, required: true, multiline: false, group: 'director' },
  { key: 'hostName', label: 'Hébergeur', max: 200, required: true, multiline: false, group: 'host' },
  { key: 'hostAddress', label: "Adresse de l'hébergeur", max: 400, required: true, multiline: true, group: 'host' },
  { key: 'hostPhone', label: "Téléphone de l'hébergeur", max: 40, required: true, multiline: false, group: 'host', type: 'tel' },
];

export const LEGAL_GROUPS: readonly { id: LegalGroup; title: string }[] = [
  { id: 'publisher', title: 'Éditeur du site' },
  { id: 'director', title: 'Directeur ou directrice de la publication' },
  { id: 'host', title: 'Hébergeur' },
];

export const HOST_KEYS: readonly (keyof LegalInfo)[] = ['hostName', 'hostAddress', 'hostPhone'];

export const EMPTY_LEGAL: LegalInfo = {
  companyName: '',
  legalForm: '',
  address: '',
  registration: '',
  vatNumber: '',
  phone: '',
  email: '',
  publisherName: '',
  hostName: '',
  hostAddress: '',
  hostPhone: '',
};

export interface GeneratedLegalPage {
  locale: string;
  kind: 'notice' | 'privacy';
  slug: string;
  label: string;
}

// Pages générées sur le site publié (même liste que client-template/src/lib/legal.mjs).
export const GENERATED_LEGAL_PAGES: readonly GeneratedLegalPage[] = [
  { locale: 'fr', kind: 'notice', slug: 'mentions-legales', label: 'Mentions légales' },
  { locale: 'fr', kind: 'privacy', slug: 'confidentialite', label: 'Politique de confidentialité' },
  { locale: 'en', kind: 'notice', slug: 'legal-notice', label: 'Mentions légales' },
  { locale: 'en', kind: 'privacy', slug: 'privacy-policy', label: 'Politique de confidentialité' },
];

export interface LegalPageCollision {
  page: PageDoc;
  generated: GeneratedLegalPage;
  /** Adresse publique de la page (/mentions-legales/, /en/privacy-policy/) */
  address: string;
}

// Pages du CMS qui occupent l'adresse d'une page légale générée : la page du CMS reste
// publiée à sa place. Une langue n'a de pages légales générées que si elle est servie
// (langue par défaut, ou langue qui a une page d'accueil), comme sur le site publié.
export function legalPageCollisions(pages: readonly PageDoc[]): LegalPageCollision[] {
  const localeOf = (p: PageDoc) => p.locale || DEFAULT_LOCALE;
  const served = new Set([DEFAULT_LOCALE, ...pages.filter((p) => p.slug === HOME_SLUG).map(localeOf)]);
  const collisions: LegalPageCollision[] = [];
  for (const generated of GENERATED_LEGAL_PAGES) {
    if (!served.has(generated.locale)) continue;
    const page = pages.find((p) => localeOf(p) === generated.locale && p.slug === generated.slug);
    if (page) collisions.push({ page, generated, address: pageAddress(page.slug, generated.locale) });
  }
  return collisions;
}

const PREFILL_KEYS = ['address', 'phone', 'email'] as const;

// Reprend l'adresse, le téléphone et l'email du premier bloc « Infos pratiques » (pages
// de la langue par défaut d'abord) dans les champs encore vides : jamais une saisie
// remplacée. Renvoie la même valeur si rien ne change.
export function prefillFromInfo(legal: LegalInfo, pages: readonly PageDoc[]): LegalInfo {
  const ordered = [
    ...pages.filter((p) => (p.locale || DEFAULT_LOCALE) === DEFAULT_LOCALE),
    ...pages.filter((p) => (p.locale || DEFAULT_LOCALE) !== DEFAULT_LOCALE),
  ];
  const info = ordered.flatMap((p) => p.layout || []).find((b) => b && b.blockType === 'info');
  if (!info) return legal;
  let next = legal;
  for (const key of PREFILL_KEYS) {
    const value = typeof info[key] === 'string' ? info[key].trim() : '';
    const max = LEGAL_FIELDS.find((f) => f.key === key)?.max ?? 200;
    if (value && !legal[key].trim()) next = { ...next, [key]: value.slice(0, max) };
  }
  return next;
}

// Champs obligatoires encore vides (un champ hébergeur vide prend la valeur par défaut du
// serveur), dans l'ordre des champs.
export function missingFields(legal: LegalInfo, hostDefaults: Partial<LegalInfo> = {}): (keyof LegalInfo)[] {
  return LEGAL_FIELDS.filter((f) => {
    if (!f.required) return false;
    const value = legal[f.key].trim() || (HOST_KEYS.includes(f.key) ? (hostDefaults[f.key] || '').trim() : '');
    return !value;
  }).map((f) => f.key);
}

// Libellés des champs manquants, dans l'ordre des champs (clés inconnues ignorées).
export function missingLabels(missing: readonly string[]): string[] {
  return LEGAL_FIELDS.filter((f) => missing.includes(f.key)).map((f) => f.label);
}

export function isLegalDirty(a: LegalInfo, b: LegalInfo): boolean {
  return LEGAL_FIELDS.some((f) => (a[f.key] ?? '') !== (b[f.key] ?? ''));
}

// Valeur complète (11 clés) à partir d'une réponse partielle ou ancienne.
export function coerceLegal(value: Partial<LegalInfo> | null | undefined): LegalInfo {
  const out = { ...EMPTY_LEGAL };
  for (const f of LEGAL_FIELDS) {
    const v = value?.[f.key];
    out[f.key] = typeof v === 'string' ? v : '';
  }
  return out;
}
