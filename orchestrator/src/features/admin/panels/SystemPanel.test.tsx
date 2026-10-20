import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { SystemInfo } from '../../../api/system';
import { SystemView } from './SystemPanel';

const GIB = 1024 * 1024 * 1024;

function info(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    app: { version: '2.3.0', node: 'v22.12.0', environment: 'production', uptimeS: 11520, startedAt: '2026-10-20T08:00:00.000Z', hosting: 'simulation' },
    disk: { totalBytes: 100 * GIB, freeBytes: 50 * GIB },
    folders: [
      { key: 'data', label: 'Données', bytes: 2048, files: 3, truncated: false },
      { key: 'uploads', label: 'Médiathèque', bytes: 5 * 1024 * 1024, files: 200000, truncated: true },
    ],
    build: { inProgress: false, buildingSite: null, status: 'idle', lastCompleted: null, queue: [] },
    backups: { enabled: false, intervalHours: 24, keep: 14, count: 0, totalBytes: 0, latest: null, state: 'désactivées' },
    orphans: { dataFiles: [], releases: [], drafts: [], repositories: [], kept: { publicDirs: [], repositories: [] }, purgeAvailable: true },
    ...overrides,
  };
}

const twoOrphans = (purgeAvailable: boolean): SystemInfo['orphans'] => ({
  dataFiles: [{ name: 'posts_ancien.json', bytes: 1024 }],
  releases: [{ name: 'ancien', bytes: 1024 }],
  drafts: [],
  repositories: [],
  kept: { publicDirs: [{ name: 'dossier-sans-site' }], repositories: [] },
  purgeAvailable,
});

describe('panneau Système', () => {
  it('état général : version, environnement, durée, dossiers, build, sauvegardes', () => {
    const html = renderToString(<SystemView info={info()} />);
    expect(html).toContain('Système');
    expect(html).toContain('Version 2.3.0 · Node v22.12.0 · Production · Hébergement : simulation locale · En service depuis 3 h 12 min');
    expect(html).toContain('50 % utilisés');
    expect(html).not.toContain('Espace disque faible');
    expect(html).toContain('Données (contenus JSON, journaux)');
    expect(html).toContain('(comptage partiel)');
    expect(html).toContain('Aucun build en cours.');
    expect(html).toContain('File d&#x27;attente vide.');
    expect(html).toContain('Sauvegardes automatiques désactivées');
    expect(html).toContain('Aucune donnée orpheline.');
    expect(html).not.toContain('Nettoyer (');
  });

  it('deux orphelins de 1 Kio : détail par catégorie, dossier conservé signalé, bouton de nettoyage', () => {
    const html = renderToString(<SystemView info={info({ orphans: twoOrphans(true) })} />);
    expect(html).toContain('Nettoyer (2 élément(s), 2 Ko)');
    expect(html).toContain('Fichiers de données de sites supprimés');
    expect(html).toContain('Versions conservées de sites supprimés');
    expect(html).toContain('posts_ancien.json');
    expect(html).toContain('Dossiers publiés sans site (conservés)');
    expect(html).toContain('à vérifier manuellement');
    expect(html).not.toContain('Aucune donnée orpheline');
  });

  it('sans base de données : message explicite et aucun bouton Nettoyer', () => {
    const html = renderToString(<SystemView info={info({ orphans: twoOrphans(false) })} />);
    expect(html).toContain('Nettoyage indisponible sans base de données.');
    expect(html).not.toContain('Nettoyer (');
  });

  it('disque faible, build et file, sauvegarde en retard', () => {
    const html = renderToString(<SystemView info={info({
      disk: { totalBytes: 100 * GIB, freeBytes: 5 * GIB },
      build: { inProgress: true, buildingSite: 'boulangerie', status: 'running', lastCompleted: null, queue: ['a', 'b'] },
      backups: { enabled: true, intervalHours: 24, keep: 14, count: 2, totalBytes: 2048, latest: { name: 'backup-2026-10-01T02-00-00.zip', createdAt: '2026-10-01T02:00:00.000Z' }, state: 'en retard' },
    })} />);
    expect(html).toContain('Espace disque faible');
    expect(html).toContain('95 % utilisés');
    expect(html).toContain('Build en cours : « boulangerie ».');
    expect(html).toContain('File d&#x27;attente : a, b.');
    expect(html).toContain('plus de deux intervalles sans sauvegarde');
  });

  it('disque indisponible', () => {
    expect(renderToString(<SystemView info={info({ disk: null })} />)).toContain('Espace disque : indisponible.');
  });
});
