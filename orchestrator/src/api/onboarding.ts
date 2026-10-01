import { apiFetch } from './client';
import type { AppConfig, OnboardingResult, AiProvider, FeatureFlags, PagesData, Theme, Site } from '../types';

// Configuration du compte : fournisseurs IA disponibles, quota, offre, hébergement.
export function fetchConfig(): Promise<AppConfig> {
  return apiFetch('/api/config');
}

export interface OnboardInput {
  name: string;
  description: string;
  features: FeatureFlags;
  ambiance?: string;
  image?: string;
  inspirationUrl?: string;
  provider: AiProvider;
}

export interface OnboardResponse {
  qualification: OnboardingResult;
  pages: PagesData;
  theme: Theme;
  site: Site;
}

export function onboard(input: OnboardInput): Promise<OnboardResponse> {
  return apiFetch('/api/onboard', { method: 'POST', body: JSON.stringify(input) });
}
