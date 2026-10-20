// Contenu légal du site au build : informations légales (PUBLIC_LEGAL_JSON injecté par
// l'orchestrateur, ou clé « legal » de la fixture), pages légales à générer par langue et
// formulaires présents (texte de la politique de confidentialité). Lu une seule fois par
// build, comme le contenu des pages (lib/content.ts).
//
// Une page du CMS à la même adresse qu'une page légale (ex. « mentions-legales ») reste
// prioritaire : la page légale correspondante n'est pas générée (signalé dans le journal).

import fs from 'node:fs';
import { getSiteContent } from './content';
import { localeRouteParam } from './i18n.mjs';
import { parseLegalInfo, legalRoutes as computeLegalRoutes, missingLegalFields } from './legal.mjs';
import { lt } from './legal-texts.mjs';

export interface LegalInfo {
  companyName: string;
  legalForm: string;
  address: string;
  registration: string;
  vatNumber: string;
  phone: string;
  email: string;
  publisherName: string;
  hostName: string;
  hostAddress: string;
  hostPhone: string;
  /** Durée de conservation des messages des formulaires (mois). */
  retentionMonths: number;
  /** Statistiques de visite anonymes (beacon du site publié). */
  visitStats: boolean;
  analyticsProvider: '' | 'ga4' | 'matomo';
  analyticsHost: string;
}

export interface LegalRoute {
  locale: string;
  kind: 'notice' | 'privacy';
  slug: string;
  /** Segments de route Astro (« mentions-legales », « en/legal-notice »). */
  route: string;
  /** Faux : une page du CMS occupe déjà l'adresse (elle est conservée). */
  generated: boolean;
}

export interface LegalContent {
  legal: LegalInfo;
  /** Vide en build hors ligne (aucune page ni lien légal). */
  legalRoutes: LegalRoute[];
  formKinds: { contact: boolean; appointment: boolean };
}

const KIND_LABELS: Record<string, string> = { notice: 'Mentions légales', privacy: 'Politique de confidentialité' };

// Source des informations légales : fixture (TEMPLATE_FIXTURE, clé racine « legal »),
// sinon variable injectée par l'orchestrateur.
function rawLegal(): unknown {
  const fixturePath = process.env.TEMPLATE_FIXTURE || '';
  if (fixturePath) {
    try {
      const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
      if (data && typeof data === 'object' && 'legal' in data) return data.legal;
    } catch {
      // Fixture illisible : lib/content.ts fait déjà échouer le build
    }
  }
  return process.env.PUBLIC_LEGAL_JSON || '';
}

async function loadLegalContent(): Promise<LegalContent> {
  const legal = parseLegalInfo(rawLegal()) as LegalInfo;
  const { pages, locales, offline } = await getSiteContent();

  const formKinds = { contact: false, appointment: false };
  for (const page of pages) {
    for (const block of page.layout) {
      if (block.blockType === 'contact') formKinds.contact = true;
      if (block.blockType === 'appointment') formKinds.appointment = true;
    }
  }

  if (offline) return { legal, legalRoutes: [], formKinds };

  const taken = new Set(pages.map((p) => localeRouteParam(p.locale, p.slug)));
  const routes = computeLegalRoutes(locales, taken) as LegalRoute[];
  for (const r of routes.filter((route) => !route.generated)) {
    console.warn(`[contenu] Page CMS /${r.route}/ conservée : elle remplace la page « ${KIND_LABELS[r.kind]} » générée.`);
  }
  const missing = missingLegalFields(legal);
  if (missing.length > 0) {
    const labels = missing.map((key: string) => lt('fr', `field_${key}`)).join(', ');
    console.warn(`[légal] Mentions légales incomplètes (${labels}) : complétez l'onglet « Infos légales » de l'orchestrateur puis republiez.`);
  }
  return { legal, legalRoutes: routes, formKinds };
}

let legalPromise: Promise<LegalContent> | null = null;

/** Contenu légal du site, calculé une seule fois par build. */
export function getLegalContent(): Promise<LegalContent> {
  if (!legalPromise) legalPromise = loadLegalContent();
  return legalPromise;
}
