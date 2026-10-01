import { apiFetch } from './client';
import type { PagesData, Theme } from '../types';

// --- Contenu d'un site : pages (CMS) et thème (design) ---

const siteQuery = (siteSlug: string) => `?site=${encodeURIComponent(siteSlug)}`;

export function fetchPages(siteSlug: string): Promise<PagesData> {
  return apiFetch(`/api/site-pages${siteQuery(siteSlug)}`);
}

// Le corps contient les pages de l'éditeur ; seules les pages listées dans `deleted` sont
// supprimées (une page absente du corps est conservée).
export function savePages(siteSlug: string, data: PagesData): Promise<{ success: boolean }> {
  return apiFetch(`/api/site-pages${siteQuery(siteSlug)}`, { method: 'POST', body: JSON.stringify(data) });
}

export function fetchTheme(siteSlug: string): Promise<{ theme: Theme }> {
  return apiFetch(`/api/theme${siteQuery(siteSlug)}`);
}

export function saveTheme(siteSlug: string, theme: Theme): Promise<{ success: boolean }> {
  return apiFetch(`/api/theme${siteQuery(siteSlug)}`, { method: 'POST', body: JSON.stringify({ theme }) });
}
