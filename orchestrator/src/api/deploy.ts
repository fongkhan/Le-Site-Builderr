import { apiFetch, sitePath } from './client';
import type { BuildStatus, RebuildResponse } from '../types';

// --- Déploiement : état du build, (re)build, brouillon, versions et historique ---

export function fetchBuildStatus(): Promise<BuildStatus> {
  return apiFetch('/api/build-status');
}

export function triggerRebuild(siteSlug: string): Promise<RebuildResponse> {
  return apiFetch(`/webhook/rebuild?site=${encodeURIComponent(siteSlug)}`, { method: 'POST' });
}

// Prévisualisation brouillon : compile le contenu courant sans rien publier
export function buildPreview(slug: string): Promise<{ success: boolean; url: string }> {
  return apiFetch(sitePath(slug, 'preview-build'), { method: 'POST' });
}

// Versions de déploiement (admin only) : liste + retour arrière
export interface Release {
  id: string;
  date: string;
}

export function fetchReleases(slug: string): Promise<Release[]> {
  return apiFetch<Release[]>(sitePath(slug, 'releases'));
}

export function rollbackRelease(slug: string, release: string): Promise<{ success: boolean; release: string }> {
  return apiFetch(sitePath(slug, 'rollback'), { method: 'POST', body: JSON.stringify({ release }) });
}

// Historique des builds d'un site (admin ou propriétaire)
export interface BuildHistoryEntry {
  status: 'success' | 'error';
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
}

export function fetchBuildHistory(slug: string): Promise<BuildHistoryEntry[]> {
  return apiFetch<BuildHistoryEntry[]>(sitePath(slug, 'builds'));
}

// Statistiques de visites (admin ou propriétaire) : total + série jour par jour
export interface SiteStats {
  total: number;
  days: { date: string; count: number }[];
}

export function fetchSiteStats(slug: string, days = 30): Promise<SiteStats> {
  return apiFetch<SiteStats>(`${sitePath(slug, 'stats')}?days=${days}`);
}
