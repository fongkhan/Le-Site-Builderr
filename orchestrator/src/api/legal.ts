import { apiFetch, sitePath } from './client';
import type { LegalInfo } from '../types';

// Informations légales d'un site (onglet « Infos légales ») : saisie, hébergeur par
// défaut du serveur (LEGAL_HOST_*), champs obligatoires encore vides et durée de
// conservation des messages des formulaires.
export interface LegalResponse {
  legal: LegalInfo;
  hostDefaults: Pick<LegalInfo, 'hostName' | 'hostAddress' | 'hostPhone'>;
  missing: (keyof LegalInfo)[];
  retentionMonths: number;
}

export function fetchLegal(siteSlug: string): Promise<LegalResponse> {
  return apiFetch(sitePath(siteSlug, 'legal'));
}

// Objet complet : un champ absent est vidé côté serveur.
export function saveLegal(siteSlug: string, legal: LegalInfo): Promise<LegalResponse & { success: boolean }> {
  return apiFetch(sitePath(siteSlug, 'legal'), { method: 'PUT', body: JSON.stringify(legal) });
}

// Champs obligatoires manquants, partagés entre la page « Infos légales » et l'onglet de
// SiteLayout (badge « ! »).
type MissingListener = (siteSlug: string, missing: (keyof LegalInfo)[]) => void;
const missingListeners = new Set<MissingListener>();

export function onLegalMissingChange(listener: MissingListener): () => void {
  missingListeners.add(listener);
  return () => {
    missingListeners.delete(listener);
  };
}

export function publishLegalMissing(siteSlug: string, missing: (keyof LegalInfo)[]): void {
  for (const listener of missingListeners) listener(siteSlug, missing);
}
