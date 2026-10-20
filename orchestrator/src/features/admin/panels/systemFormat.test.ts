import { describe, expect, it } from 'vitest';
import { diskSummary, formatUptime, orphanSummary } from './systemFormat';

const GIB = 1024 * 1024 * 1024;

describe('panneau Système — mise en forme', () => {
  it('formatUptime : secondes, minutes, heures, jours', () => {
    expect(formatUptime(45)).toBe('45 s');
    expect(formatUptime(720)).toBe('12 min');
    expect(formatUptime(11520)).toBe('3 h 12 min');
    expect(formatUptime(187200)).toBe('2 j 4 h');
    expect(formatUptime(7200)).toBe('2 h');
    expect(formatUptime(-5)).toBe('0 s');
  });

  it('diskSummary : pourcentage utilisé et alerte de disque faible', () => {
    expect(diskSummary({ totalBytes: 100 * GIB, freeBytes: 5 * GIB })).toEqual({ usedPct: 95, low: true });
    expect(diskSummary({ totalBytes: 100 * GIB, freeBytes: 50 * GIB })).toEqual({ usedPct: 50, low: false });
    // Moins de 1 Gio libre, même avec plus de 10 % libres
    expect(diskSummary({ totalBytes: 4 * GIB, freeBytes: 0.5 * GIB })?.low).toBe(true);
    expect(diskSummary(null)).toBeNull();
    expect(diskSummary({ totalBytes: 0, freeBytes: 0 })).toBeNull();
  });

  it('orphanSummary : catégories purgeables seulement, jamais les dossiers conservés', () => {
    const summary = orphanSummary({
      dataFiles: [{ name: 'posts_x.json', bytes: 100 }],
      releases: [{ name: 'x', bytes: 1000 }],
      drafts: [],
      repositories: [{ name: 'y', bytes: 24 }],
      kept: { publicDirs: [{ name: 'ancien' }], repositories: [{ name: 'importe' }] },
      purgeAvailable: true,
    });
    expect(summary).toEqual({ count: 3, bytes: 1124 });
  });
});
