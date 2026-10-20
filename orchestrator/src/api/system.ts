import { apiFetch } from './client';

// --- Panneau Système (admin) : état du serveur et nettoyage des données orphelines ---

export interface SystemFolder {
  key: string;
  label: string;
  bytes: number;
  files: number;
  truncated: boolean;
}

export interface OrphanEntry {
  name: string;
  bytes: number;
}

export type OrphanCategory = 'dataFiles' | 'releases' | 'drafts' | 'repositories';

export interface OrphansInfo {
  dataFiles: OrphanEntry[];
  releases: OrphanEntry[];
  drafts: OrphanEntry[];
  repositories: OrphanEntry[];
  // Signalés seulement : jamais supprimés par le nettoyage
  kept: { publicDirs: { name: string }[]; repositories: { name: string }[] };
  // Faux sans base de données : la liste des sites ne peut pas être vérifiée
  purgeAvailable: boolean;
}

export type BackupState = 'désactivées' | 'aucune' | 'en retard' | 'ok';

export interface SystemInfo {
  app: {
    version: string;
    node: string;
    environment: 'production' | 'développement';
    uptimeS: number;
    startedAt: string;
    hosting: string;
  };
  disk: { totalBytes: number; freeBytes: number } | null;
  folders: SystemFolder[];
  build: {
    inProgress: boolean;
    buildingSite: string | null;
    status: string;
    lastCompleted: string | null;
    queue: string[];
  };
  backups: {
    enabled: boolean;
    intervalHours: number;
    keep: number;
    count: number;
    totalBytes: number;
    latest: { name: string; createdAt: string } | null;
    state: BackupState;
  };
  orphans: OrphansInfo;
}

export interface PurgeResult {
  success: boolean;
  removed: Record<OrphanCategory, string[]>;
  bytes: number;
  failed: number;
}

export function fetchSystemInfo(): Promise<SystemInfo> {
  return apiFetch<SystemInfo>('/api/admin/system');
}

// Catégories (et éventuellement noms) seulement : l'inventaire est recalculé par le serveur.
export function purgeOrphans(body: { categories: OrphanCategory[]; names?: string[] }): Promise<PurgeResult> {
  return apiFetch<PurgeResult>('/api/admin/system/orphans/purge', { method: 'POST', body: JSON.stringify(body) });
}
