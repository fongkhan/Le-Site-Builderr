// Données structurées schema.org (JSON-LD) : sérialisation sûre et entités partagées.
//
// Un seul LocalBusiness par page, identifié par un @id stable (<siteUrl>/#business) : les
// blocs ne l'émettent plus eux-mêmes (deux blocs Info, ou Info + Témoignages, en
// produisaient plusieurs, contradictoires). Les avis clients saisis par le site lui-même
// (aggregateRating / review « auto-déclarés ») ne sont PAS émis : Google les déclare
// inéligibles aux étoiles et peut sanctionner le site (action manuelle).

import { safeHttpUrl } from './url';

/**
 * JSON.stringify sûr pour <script type="application/ld+json"> : « < », « > » et « & »
 * sont échappés en séquences \uXXXX — un texte saisi contenant « </script> » ne peut pas fermer
 * la balise. Le résultat reste du JSON valide, identique une fois parsé.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** @id stable du commerce (même valeur sur toutes les pages du site), ou '' sans URL publique. */
export function businessId(siteUrl: string): string {
  return siteUrl ? `${siteUrl.replace(/\/+$/, '')}/#business` : '';
}

export interface InfoData {
  address?: string;
  phone?: string;
  email?: string;
  hours?: string;
  googleBusinessUrl?: string;
}

/**
 * LocalBusiness (nom, adresse, téléphone, horaires) à partir du bloc « Infos pratiques ».
 * null si les données sont insuffisantes (pas de nom de site ni de coordonnées).
 */
export function localBusinessLd(siteName: string, siteUrl: string, info: InfoData | undefined): Record<string, unknown> | null {
  if (!info || !siteName || !(info.address || info.phone || info.email)) return null;
  const id = businessId(siteUrl);
  const googleUrl = safeHttpUrl(info.googleBusinessUrl, { relative: false });
  const hours = (info.hours || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    ...(id ? { '@id': id } : {}),
    name: siteName,
    ...(siteUrl ? { url: siteUrl } : {}),
    ...(info.address ? { address: info.address } : {}),
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(info.email ? { email: info.email } : {}),
    ...(hours.length ? { openingHours: hours } : {}),
    ...(googleUrl ? { sameAs: [googleUrl] } : {}),
  };
}

export interface FaqItem {
  question?: string;
  answer?: string;
}

/** FAQPage unique regroupant toutes les questions de la page, ou null s'il n'y en a pas. */
export function faqPageLd(items: FaqItem[]): Record<string, unknown> | null {
  const entities = items
    .filter((i) => i && i.question && i.answer)
    .map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    }));
  if (entities.length === 0) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: entities };
}
