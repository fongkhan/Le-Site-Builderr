import { apiFetch } from './client';

// --- Administration : hébergement, journal d'audit, vue d'ensemble, sauvegardes ---

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

// Journal d'audit (admin only) : actions sensibles, plus récentes d'abord, par pages.
// Filtres : action (préfixes séparés par des virgules), cible exacte (site ou email).
export interface AuditEntry {
  id: string | number;
  action: string;
  actor: string | null;
  target: string | null;
  details: string | null;
  createdAt: string;
}

export interface AuditPage {
  docs: AuditEntry[];
  totalDocs: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  limit: number;
  // Durée de conservation en jours (0 = illimitée)
  retentionDays: number;
}

export function fetchAuditLog(params: { action?: string; target?: string; page?: number; limit?: number } = {}): Promise<AuditPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
  }
  return apiFetch<AuditPage>(`/api/audit?${query.toString()}`);
}

// Vue d'ensemble multi-sites (admin) : totaux + ligne par site (statut, domaine, visites)
export interface OverviewRow {
  slug: string;
  name: string;
  domain: string;
  status: string;
  sslStatus: string;
  domainStatus: string;
  customDomain: string;
  visitsTotal: number;
  visits30: number;
  series: number[];
}
export interface AdminOverview {
  totals: { sites: number; active: number; visits30: number; customDomains: number };
  sites: OverviewRow[];
}
export function fetchAdminOverview(): Promise<AdminOverview> {
  return apiFetch<AdminOverview>('/api/admin/overview');
}

// Sauvegardes automatiques (admin)
export interface BackupEntry { name: string; size: number; createdAt: string }
export interface BackupsInfo {
  config: { enabled: boolean; intervalHours: number; keep: number };
  backups: BackupEntry[];
}
export function fetchBackups(): Promise<BackupsInfo> {
  return apiFetch<BackupsInfo>('/api/admin/backups');
}
export function createBackup(): Promise<{ success: boolean; filename: string }> {
  return apiFetch('/api/admin/backups', { method: 'POST' });
}
export function backupDownloadUrl(name: string): string {
  return `/api/admin/backups/download?name=${encodeURIComponent(name)}`;
}
