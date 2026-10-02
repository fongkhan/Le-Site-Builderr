import { apiFetch, sitePath } from './client';
import type { Site, ScannedSite, FileEntry } from '../types';

// --- Sites : liste, création, modification, suppression, import, fichiers ---

export function fetchSites(): Promise<Site[]> {
  return apiFetch<Site[]>('/api/sites');
}

// Propriétaires par slug de site (admin only) : { slug: [emails] }
export function fetchSiteOwners(): Promise<Record<string, string[]>> {
  return apiFetch<Record<string, string[]>>('/api/sites/owners');
}

export function createSite(input: { name: string; domain?: string; stack?: string; documentRoot?: string; repositoryPath?: string }): Promise<{ success: boolean; site: Site }> {
  return apiFetch('/api/sites', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSite(slug: string, input: Partial<Site>): Promise<{ success: boolean; site: Site }> {
  return apiFetch(sitePath(slug), { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSite(slug: string, deleteFiles: boolean): Promise<{ success: boolean; message: string }> {
  return apiFetch(`${sitePath(slug)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
}

// Duplication d'un site (admin) : crée un jumeau sous un nouveau slug
export function duplicateSite(slug: string): Promise<{ success: boolean; site: Site }> {
  return apiFetch(sitePath(slug, 'duplicate'), { method: 'POST' });
}

export function exportSiteUrl(slug: string): string {
  return sitePath(slug, 'export');
}

export function scanSites(scanPath: string): Promise<ScannedSite[]> {
  return apiFetch('/api/sites/scan', { method: 'POST', body: JSON.stringify({ scanPath }) });
}

export function importSite(input: ScannedSite): Promise<{ success: boolean; site: Site }> {
  return apiFetch('/api/sites/import', { method: 'POST', body: JSON.stringify(input) });
}

// Import d'une archive d'export de site (zip brut en corps de requête)
export function importSiteArchive(file: File): Promise<{ success: boolean; site: Site; extractedFiles: number }> {
  return apiFetch('/api/sites/import-archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
}

export function fetchSiteFiles(slug: string, type: 'documentRoot' | 'repository'): Promise<FileEntry[]> {
  return apiFetch(`${sitePath(slug, 'files')}?type=${type}`);
}

export function fetchSiteFileContent(slug: string, filePath: string, type: 'documentRoot' | 'repository'): Promise<{ content: string }> {
  return apiFetch(`${sitePath(slug, 'files', 'view')}?path=${encodeURIComponent(filePath)}&type=${type}`);
}
