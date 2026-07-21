import { apiFetch } from './client';
import type { Site, ScannedSite, FileEntry, PagesData, Theme, BuildStatus, RebuildResponse, AppConfig, OnboardingResult, AiProvider, FeatureFlags } from '../types';

export function fetchSites(): Promise<Site[]> {
  return apiFetch<Site[]>('/api/sites');
}

// Propriétaires par slug de site (admin only) : { slug: [emails] }
export function fetchSiteOwners(): Promise<Record<string, string[]>> {
  return apiFetch<Record<string, string[]>>('/api/sites/owners');
}

// Hébergement (admin only) : driver actif (simulation | cpanel) et test de connexion
export interface HostingStatus {
  driver: 'simulation' | 'cpanel';
  description: string;
  host?: string;
  user?: string;
  rootDomain?: string;
}

export function fetchHostingStatus(): Promise<HostingStatus> {
  return apiFetch<HostingStatus>('/api/hosting/status');
}

export function testHostingConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  return apiFetch('/api/hosting/test', { method: 'POST' });
}

// Versions de déploiement (admin only) : liste + retour arrière
export interface Release {
  id: string;
  date: string;
}

export function fetchReleases(slug: string): Promise<Release[]> {
  return apiFetch<Release[]>(`/api/sites/${slug}/releases`);
}

export function rollbackRelease(slug: string, release: string): Promise<{ success: boolean; release: string }> {
  return apiFetch(`/api/sites/${slug}/rollback`, { method: 'POST', body: JSON.stringify({ release }) });
}

// Historique des builds d'un site (admin ou propriétaire)
export interface BuildHistoryEntry {
  status: 'success' | 'error';
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
}

export function fetchBuildHistory(slug: string): Promise<BuildHistoryEntry[]> {
  return apiFetch<BuildHistoryEntry[]>(`/api/sites/${slug}/builds`);
}

// Journal d'audit (admin only) : 50 dernières actions sensibles
export interface AuditEntry {
  action: string;
  actor: string | null;
  target: string | null;
  details: string | null;
  createdAt: string;
}

export function fetchAuditLog(): Promise<AuditEntry[]> {
  return apiFetch<AuditEntry[]>('/api/audit');
}

// Import d'une archive d'export de site (zip brut en corps de requête)
export async function importSiteArchive(file: File): Promise<{ success: boolean; site: Site; extractedFiles: number }> {
  const res = await fetch('/api/sites/import-archive', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Erreur HTTP ${res.status}`);
  }
  return data;
}

export function createSite(input: { name: string; domain?: string; stack?: string; documentRoot?: string; repositoryPath?: string }): Promise<{ success: boolean; site: Site }> {
  return apiFetch('/api/sites', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSite(slug: string, input: Partial<Site>): Promise<{ success: boolean; site: Site }> {
  return apiFetch(`/api/sites/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSite(slug: string, deleteFiles: boolean): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/sites/${encodeURIComponent(slug)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
}

export function scanSites(scanPath: string): Promise<ScannedSite[]> {
  return apiFetch('/api/sites/scan', { method: 'POST', body: JSON.stringify({ scanPath }) });
}

export function importSite(input: ScannedSite): Promise<{ success: boolean; site: Site }> {
  return apiFetch('/api/sites/import', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchSiteFiles(slug: string, type: 'documentRoot' | 'repository'): Promise<FileEntry[]> {
  return apiFetch(`/api/sites/${encodeURIComponent(slug)}/files?type=${type}`);
}

export function fetchSiteFileContent(slug: string, filePath: string, type: 'documentRoot' | 'repository'): Promise<{ content: string }> {
  return apiFetch(`/api/sites/${encodeURIComponent(slug)}/files/view?path=${encodeURIComponent(filePath)}&type=${type}`);
}

export function fetchPages(siteSlug: string): Promise<PagesData> {
  return apiFetch(`/api/site-pages?site=${encodeURIComponent(siteSlug)}`);
}

export function savePages(siteSlug: string, data: PagesData): Promise<{ success: boolean }> {
  return apiFetch(`/api/site-pages?site=${encodeURIComponent(siteSlug)}`, { method: 'POST', body: JSON.stringify(data) });
}

export function fetchTheme(siteSlug: string): Promise<{ theme: Theme }> {
  return apiFetch(`/api/theme?site=${encodeURIComponent(siteSlug)}`);
}

export function saveTheme(siteSlug: string, theme: Theme): Promise<{ success: boolean }> {
  return apiFetch(`/api/theme?site=${encodeURIComponent(siteSlug)}`, { method: 'POST', body: JSON.stringify({ theme }) });
}

export function fetchBuildStatus(): Promise<BuildStatus> {
  return apiFetch('/api/build-status');
}

export function triggerRebuild(siteSlug: string): Promise<RebuildResponse> {
  return apiFetch(`/webhook/rebuild?site=${encodeURIComponent(siteSlug)}`, { method: 'POST' });
}

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
