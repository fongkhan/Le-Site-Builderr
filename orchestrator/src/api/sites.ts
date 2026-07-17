import { apiFetch } from './client';
import type { Site, ScannedSite, FileEntry, PagesData, Theme, BuildStatus, RebuildResponse, AppConfig, OnboardingResult, AiProvider, FeatureFlags } from '../types';

export function fetchSites(): Promise<Site[]> {
  return apiFetch<Site[]>('/api/sites');
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
