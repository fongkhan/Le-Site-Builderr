// Mise en forme du panneau Système (fonctions pures, testées sans rendu).
import type { OrphanCategory, OrphansInfo, SystemInfo } from '../../../api/system';

const GIB = 1024 * 1024 * 1024;

// Durée de fonctionnement : « 45 s », « 12 min », « 3 h 12 min », « 2 j 4 h ».
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} j ${hours % 24} h` : `${days} j`;
}

// Occupation du disque ; « faible » sous 1 Gio ou 10 % libres. null si indisponible.
export function diskSummary(disk: SystemInfo['disk']): { usedPct: number; low: boolean } | null {
  if (!disk || !(disk.totalBytes > 0)) return null;
  const free = Math.max(0, Math.min(disk.freeBytes, disk.totalBytes));
  return {
    usedPct: Math.round(((disk.totalBytes - free) / disk.totalBytes) * 100),
    low: free < GIB || free / disk.totalBytes < 0.1,
  };
}

export const ORPHAN_CATEGORIES: OrphanCategory[] = ['dataFiles', 'releases', 'drafts', 'repositories'];

// Éléments purgeables (les dossiers conservés ne comptent jamais).
export function orphanSummary(orphans: OrphansInfo): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const category of ORPHAN_CATEGORIES) {
    for (const entry of orphans[category] || []) {
      count += 1;
      bytes += Number(entry.bytes) || 0;
    }
  }
  return { count, bytes };
}

export const FOLDER_LABELS: Record<string, string> = {
  data: 'Données (contenus JSON, journaux)',
  uploads: 'Médiathèque',
  public: 'Sites publiés (aperçu)',
  releases: 'Versions conservées (rollback)',
  drafts: 'Brouillons',
  backups: 'Sauvegardes',
  repositories: 'Dépôts de sources',
};

export const ORPHAN_LABELS: Record<OrphanCategory, string> = {
  dataFiles: 'Fichiers de données de sites supprimés',
  releases: 'Versions conservées de sites supprimés',
  drafts: 'Brouillons de sites supprimés',
  repositories: 'Copies du modèle de sites supprimés',
};
