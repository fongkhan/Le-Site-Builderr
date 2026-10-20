// État du système pour le panneau d'administration (version, disque, dossiers, build,
// sauvegardes, données orphelines) et nettoyage des données orphelines. Aucune réponse ne
// contient de chemin absolu : clés, libellés et noms seulement.
// Requires lourds DANS les fonctions : index.js charge ce module tôt (removePartialBackups).
const fs = require('fs');
const path = require('path');
const config = require('../core/config');
const { isPartialBackupName, backupState } = require('../lib/backup-state');
const { createCachedProbe } = require('../lib/health');
const { measureDir } = require('../lib/dir-size');
const { findOrphans, dataFileSlug, isPurgeableDataFileName } = require('../lib/orphans');

// Dossiers mesurés (racines lues à l'appel : les tests peuvent les rediriger)
const FOLDERS = [
  { key: 'data', label: 'Données (contenus JSON, journaux)', dir: () => config.DATA_DIR },
  { key: 'uploads', label: 'Médiathèque', dir: () => config.UPLOADS_DIR },
  { key: 'public', label: 'Sites publiés (aperçu)', dir: () => config.PUBLIC_HTML_DIR },
  { key: 'releases', label: 'Versions conservées (rollback)', dir: () => config.RELEASES_DIR },
  { key: 'drafts', label: 'Brouillons', dir: () => config.DRAFTS_DIR },
  { key: 'backups', label: 'Sauvegardes', dir: () => config.BACKUPS_DIR },
  { key: 'repositories', label: 'Dépôts de sources', dir: () => config.REPOSITORIES_DIR },
];

// Catégories purgeables et leur racine
const PURGE_ROOTS = {
  dataFiles: () => config.DATA_DIR,
  releases: () => config.RELEASES_DIR,
  drafts: () => config.DRAFTS_DIR,
  repositories: () => config.REPOSITORIES_DIR,
};
const PURGE_CATEGORIES = Object.keys(PURGE_ROOTS);

// Parcours coûteux (jusqu'à 200 000 entrées par dossier) : au plus une mesure par minute.
const FOLDERS_CACHE_MS = 60 * 1000;
const folderProbe = createCachedProbe(async () => {
  const out = [];
  for (const folder of FOLDERS) {
    const { bytes, files, truncated } = await measureDir(folder.dir());
    out.push({ key: folder.key, label: folder.label, bytes, files, truncated });
  }
  return out;
}, FOLDERS_CACHE_MS);

// Espace disque du volume du projet, ou null (plateforme ou volume sans statfs).
function diskInfo() {
  try {
    const st = fs.statfsSync(config.PROJECT_DIR);
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    return null;
  }
}

// Entrées directes d'un dossier (fichiers ou sous-dossiers), [] s'il est absent.
function listEntries(dir, kind) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => (kind === 'file' ? e.isFile() : e.isDirectory()))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Premier segment, sous `root`, des chemins enregistrés qui s'y trouvent (dossier publié
// d'un site « client/site » → « client » : jamais signalé comme orphelin).
function registeredNamesUnder(paths, root) {
  const names = new Set();
  const base = path.resolve(root);
  for (const p of paths) {
    if (!p) continue;
    const rel = path.relative(base, path.resolve(String(p)));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    names.add(rel.split(path.sep)[0]);
  }
  return names;
}

// Inventaire des données orphelines (tailles comprises). La liste des sites est complète
// (listAllSites) : jamais celle, bornée, de l'interface.
async function scanOrphans() {
  const sitesStore = require('../sites-store');
  const { isProvisionedRepository } = require('./sites');
  const sites = await sitesStore.listAllSites();
  const dataFiles = listEntries(config.DATA_DIR, 'file').map((name) => {
    try {
      const st = fs.statSync(path.join(config.DATA_DIR, name));
      return { name, bytes: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return { name, bytes: 0, mtimeMs: Date.now() };
    }
  });
  const result = findOrphans({
    knownSlugs: new Set(sites.map((s) => s.slug)),
    dataFiles,
    releaseDirs: listEntries(config.RELEASES_DIR, 'dir').map((name) => ({ name })),
    draftDirs: listEntries(config.DRAFTS_DIR, 'dir').map((name) => ({ name })),
    repoDirs: listEntries(config.REPOSITORIES_DIR, 'dir').map((name) => ({
      name,
      provisioned: isProvisionedRepository(path.join(config.REPOSITORIES_DIR, name)),
    })),
    registeredRepoNames: registeredNamesUnder(sites.map((s) => s.repositoryPath), config.REPOSITORIES_DIR),
    publicDirs: listEntries(config.PUBLIC_HTML_DIR, 'dir').map((name) => ({ name })),
    registeredPublicNames: registeredNamesUnder(sites.map((s) => s.documentRoot), config.PUBLIC_HTML_DIR),
  });
  // Tailles mesurées pour les seuls dossiers purgeables
  const sized = async (category) => {
    const out = [];
    for (const { name } of result[category]) {
      out.push({ name, bytes: (await measureDir(path.join(PURGE_ROOTS[category](), name))).bytes });
    }
    return out;
  };
  return {
    dataFiles: result.dataFiles.map(({ name, bytes }) => ({ name, bytes })),
    releases: await sized('releases'),
    drafts: await sized('drafts'),
    repositories: await sized('repositories'),
    kept: {
      publicDirs: result.kept.publicDirs.map(({ name }) => ({ name })),
      repositories: result.kept.repositories.map(({ name }) => ({ name })),
    },
  };
}

async function collectSystemInfo() {
  const hosting = require('../core/hosting');
  const build = require('./build');
  const backups = require('./backups');
  const { getPayloadInstance } = require('../core/payload');
  const { readAppVersion } = require('../lib/version');

  const status = build.getBuildStatus();
  let backupList;
  try { backupList = backups.listBackups(); } catch { backupList = []; }
  const backupCfg = backups.backupConfig();
  const latest = backupList[0] || null;
  const uptimeS = Math.round(process.uptime());

  return {
    app: {
      version: readAppVersion(config.PROJECT_DIR),
      node: process.version,
      environment: config.IS_PRODUCTION ? 'production' : 'développement',
      uptimeS,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      hosting: hosting.status().driver,
    },
    disk: diskInfo(),
    folders: await folderProbe(),
    build: {
      inProgress: Boolean(status.inProgress),
      buildingSite: status.buildingSite || null,
      status: status.status,
      lastCompleted: status.lastCompleted || null,
      queue: build.getQueue(),
    },
    backups: {
      enabled: backupCfg.enabled,
      intervalHours: backupCfg.intervalHours,
      keep: backupCfg.keep,
      count: backupList.length,
      totalBytes: backupList.reduce((sum, b) => sum + (Number(b.size) || 0), 0),
      latest: latest ? { name: latest.name, createdAt: latest.createdAt } : null,
      state: backupState({ enabled: backupCfg.enabled, intervalHours: backupCfg.intervalHours, latestCreatedAt: latest && latest.createdAt }),
    },
    orphans: { ...(await scanOrphans()), purgeAvailable: Boolean(getPayloadInstance()) },
  };
}

// Nettoyage : l'inventaire est RECALCULÉ ici (jamais un chemin fourni par le client) ;
// `names` restreint aux éléments cochés. Un site en cours de build ou recréé entre-temps
// sous ce slug n'est jamais touché ; chaque suppression reste confinée à sa racine.
async function purgeOrphans({ categories, names } = {}) {
  const build = require('./build');
  const sitesStore = require('../sites-store');
  const { assertStrictlyInside } = require('../lib/paths');
  const wanted = Array.isArray(names) ? new Set(names) : null;
  const scan = await scanOrphans();
  const removed = { dataFiles: [], releases: [], drafts: [], repositories: [] };
  let bytes = 0;
  let failed = 0;

  for (const category of [...new Set(categories)].filter((c) => PURGE_CATEGORIES.includes(c))) {
    const root = PURGE_ROOTS[category]();
    for (const entry of scan[category]) {
      if (wanted && !wanted.has(entry.name)) continue;
      if (category === 'dataFiles' && !isPurgeableDataFileName(entry.name)) continue;
      const slug = category === 'dataFiles' ? dataFileSlug(entry.name) : entry.name;
      if (slug) {
        if (build.isSiteBusy(slug)) continue;
        try {
          if (await sitesStore.getSiteBySlug(slug)) continue; // site recréé depuis l'inventaire
        } catch {
          failed++;
          continue; // base injoignable : on ne conclut pas
        }
      }
      try {
        // Aucun await entre la revérification ci-dessus et la suppression
        const target = assertStrictlyInside(path.join(root, entry.name), root);
        fs.rmSync(target, { recursive: category !== 'dataFiles', force: true });
        removed[category].push(entry.name);
        bytes += Number(entry.bytes) || 0;
      } catch (e) {
        failed++;
        console.error(`🧹 [Nettoyage] ${category}/${entry.name} non supprimé :`, e.message);
      }
    }
  }
  return { removed, bytes, failed };
}

// Démarrage : archives de sauvegarde inachevées (.part) supprimées. Aucune sauvegarde ne
// peut être en cours à ce moment. Renvoie les noms supprimés.
function removePartialBackups() {
  const removed = [];
  for (const name of listEntries(config.BACKUPS_DIR, 'file')) {
    if (!isPartialBackupName(name)) continue;
    try {
      fs.rmSync(path.join(config.BACKUPS_DIR, name), { force: true });
      removed.push(name);
    } catch (e) {
      console.error(`♻️ [Reprise] Sauvegarde inachevée ${name} non supprimée :`, e.message);
    }
  }
  return removed;
}

module.exports = { PURGE_CATEGORIES, collectSystemInfo, scanOrphans, purgeOrphans, removePartialBackups };
