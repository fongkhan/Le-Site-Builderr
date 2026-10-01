// Sauvegardes automatiques du contenu (pages/thème/articles de tous les sites).
const fs = require('fs');
const path = require('path');
const sitesStore = require('../sites-store');
const backup = require('../lib/backup');
const { BACKUPS_DIR, BACKUP_KEEP, BACKUP_INTERVAL_HOURS, BACKUP_ENABLED, getSiteThemeFile } = require('../core/config');
const { readSitePages, readSitePosts } = require('./content');

let backupInProgress = false;

// Crée une archive zip de tout le contenu et applique la rétention. Renvoie le nom de
// fichier, ou null si une sauvegarde est déjà en cours.
async function createBackupArchive() {
  if (backupInProgress) return null;
  backupInProgress = true;
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const archiver = require('archiver');
    const filename = backup.backupFilename(new Date());
    const dest = path.join(BACKUPS_DIR, filename);
    const sites = await sitesStore.listSites();

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify({ createdAt: new Date().toISOString(), sites: sites.map((s) => s.slug) }, null, 2), { name: 'manifest.json' });
      // Un dossier par site : pages, thème, articles.
      (async () => {
        for (const s of sites) {
          const base = `sites/${s.slug}`;
          try { archive.append(JSON.stringify(await readSitePages(s.slug), null, 2), { name: `${base}/pages.json` }); } catch { /* ignore */ }
          try { archive.append(JSON.stringify(await readSitePosts(s.slug), null, 2), { name: `${base}/posts.json` }); } catch { /* ignore */ }
          const themeFile = getSiteThemeFile(s.slug);
          if (fs.existsSync(themeFile)) archive.file(themeFile, { name: `${base}/theme.json` });
        }
        archive.finalize();
      })().catch(reject);
    });

    // Rétention : ne garder que les BACKUP_KEEP plus récentes.
    let names = [];
    try { names = fs.readdirSync(BACKUPS_DIR); } catch { names = []; }
    for (const old of backup.selectBackupsToDelete(names, BACKUP_KEEP)) {
      try { fs.rmSync(path.join(BACKUPS_DIR, old), { force: true }); } catch { /* ignore */ }
    }
    return filename;
  } finally {
    backupInProgress = false;
  }
}

// Sauvegardes existantes, plus récentes d'abord.
function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter(backup.isValidBackupName)
    .map((name) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function backupConfig() {
  return { enabled: BACKUP_ENABLED, intervalHours: BACKUP_INTERVAL_HOURS, keep: BACKUP_KEEP };
}

// Chemin d'une sauvegarde à télécharger (nom strictement validé — anti-traversée),
// ou null si le nom est invalide.
function backupFilePath(name) {
  return backup.isValidBackupName(name) ? path.join(BACKUPS_DIR, name) : null;
}

// Sauvegardes planifiées (désactivées par défaut : BACKUP_ENABLED=true).
// Best-effort : un échec est loggé mais ne perturbe jamais le service.
function scheduleBackups() {
  if (!BACKUP_ENABLED) return;
  const intervalMs = Math.max(1, BACKUP_INTERVAL_HOURS) * 60 * 60 * 1000;
  console.log(`💾 [Sauvegardes] Planifiées toutes les ${BACKUP_INTERVAL_HOURS} h (rétention ${BACKUP_KEEP}).`);
  const timer = setInterval(() => {
    createBackupArchive()
      .then((name) => name && console.log(`💾 [Sauvegardes] Créée : ${name}`))
      .catch((e) => console.error('💾 [Sauvegardes] Échec :', e.message));
  }, intervalMs);
  if (timer.unref) timer.unref(); // ne bloque pas l'arrêt du process
}

module.exports = { createBackupArchive, listBackups, backupConfig, backupFilePath, scheduleBackups };
