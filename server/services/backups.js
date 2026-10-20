// Sauvegardes automatiques du contenu (fiches, pages, thèmes, articles et images de tous
// les sites) et restauration d'un site depuis une sauvegarde.
// Modules chargés à l'usage (build, site-import, adm-zip) : index.js charge ce module
// avant sitesStore.init.
const fs = require('fs');
const path = require('path');
const sitesStore = require('../sites-store');
const backup = require('../lib/backup');
const { isPublishableMediaName } = require('../lib/media-policy');
const { getPayloadInstance } = require('../core/payload');
const {
  BACKUPS_DIR,
  UPLOADS_DIR,
  BACKUP_KEEP,
  BACKUP_INTERVAL_HOURS,
  BACKUP_ENABLED,
  BACKUP_MEDIA,
} = require('../core/config');
const { readSitePages, readSitePosts, readSiteTheme, findPayloadSiteId } = require('./content');

let backupInProgress = false;

// Images téléversées d'un site (noms de fichiers publiables présents sur le disque, sans
// doublon). Sans base ou site inconnu de Payload : aucune.
async function siteMediaFiles(slug) {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance) return [];
  const siteId = await findPayloadSiteId(payloadInstance, slug);
  if (!siteId) return [];
  const res = await payloadInstance.find({
    collection: 'media',
    where: { site: { equals: siteId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const names = new Set();
  for (const doc of res.docs || []) {
    const name = typeof doc.filename === 'string' ? path.basename(doc.filename) : '';
    if (name && isPublishableMediaName(name) && fs.existsSync(path.join(UPLOADS_DIR, name))) names.add(name);
  }
  return [...names];
}

// Crée une archive zip de tout le contenu et applique la rétention. Renvoie le nom de
// fichier, ou null si une sauvegarde est déjà en cours.
async function createBackupArchive() {
  if (backupInProgress) return null;
  backupInProgress = true;
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const archiver = require('archiver');
    // Jamais le nom d'une archive existante (deux sauvegardes dans la même seconde)
    const filename = backup.nextFreeBackupName(new Date(), (n) => fs.existsSync(path.join(BACKUPS_DIR, n)));
    const dest = path.join(BACKUPS_DIR, filename);
    const sites = await sitesStore.listSites();

    // Écriture dans un fichier temporaire renommé à la fin : jamais d'archive tronquée
    // listée comme sauvegarde valide.
    const partial = `${dest}.part`;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(partial);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      // Fichier disparu entre la liste et la lecture (image supprimée…) : ignoré
      archive.on('warning', (w) => console.error('💾 [Sauvegardes] Fichier ignoré :', w.message));
      archive.pipe(output);
      const manifest = { format: 2, createdAt: new Date().toISOString(), sites: sites.map((s) => s.slug), media: BACKUP_MEDIA };
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      // Un dossier par site : pages, articles, thème (Payload d'abord), fiche, images.
      (async () => {
        for (const s of sites) {
          const base = `sites/${s.slug}`;
          try { archive.append(JSON.stringify(await readSitePages(s.slug), null, 2), { name: `${base}/pages.json` }); } catch { /* ignore */ }
          try { archive.append(JSON.stringify(await readSitePosts(s.slug), null, 2), { name: `${base}/posts.json` }); } catch { /* ignore */ }
          try { archive.append(JSON.stringify(await readSiteTheme(s.slug), null, 2), { name: `${base}/theme.json` }); } catch { /* slug hérité invalide : thème ignoré */ }
          archive.append(JSON.stringify(s, null, 2), { name: `${base}/site.json` });
          if (BACKUP_MEDIA) {
            try {
              for (const name of await siteMediaFiles(s.slug)) {
                archive.file(path.join(UPLOADS_DIR, name), { name: backup.backupMediaEntryName(s.slug, name) });
              }
            } catch (e) {
              console.error(`💾 [Sauvegardes] Images de ${s.slug} non sauvegardées :`, e.message);
            }
          }
        }
        archive.finalize();
      })().catch(reject);
    }).catch((err) => {
      try { fs.rmSync(partial, { force: true }); } catch { /* ignore */ }
      throw err;
    });
    fs.renameSync(partial, dest);

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
  return { enabled: BACKUP_ENABLED, intervalHours: BACKUP_INTERVAL_HOURS, keep: BACKUP_KEEP, media: BACKUP_MEDIA };
}

// Chemin d'une sauvegarde à télécharger (nom strictement validé — anti-traversée),
// ou null si le nom est invalide.
function backupFilePath(name) {
  return backup.isValidBackupName(name) ? path.join(BACKUPS_DIR, name) : null;
}

// Marge de la vérification périodique : une archive est datée de la fin de son écriture.
const BACKUP_DUE_TOLERANCE_MS = 10 * 60 * 1000;

// Sauvegardes planifiées (désactivées par défaut : BACKUP_ENABLED=true).
// Best-effort : un échec est loggé mais ne perturbe jamais le service. Une vérification
// périodique (au plus horaire) lance une sauvegarde quand la dernière date d'au moins un
// intervalle, y compris au démarrage : un serveur redémarré plus souvent que
// l'intervalle sauvegarde quand même, et une sauvegarde manuelle repousse la suivante.
function scheduleBackups() {
  if (!BACKUP_ENABLED) return;
  const intervalMs = backup.backupIntervalMs(BACKUP_INTERVAL_HOURS);
  console.log(`💾 [Sauvegardes] Planifiées toutes les ${intervalMs / 3600000} h (rétention ${BACKUP_KEEP}).`);
  const runIfDue = () => {
    let latest = null;
    try { latest = listBackups()[0] || null; } catch { latest = null; }
    if (!backup.isBackupDue(latest && latest.createdAt, Date.now(), intervalMs, BACKUP_DUE_TOLERANCE_MS)) return;
    createBackupArchive()
      .then((name) => name && console.log(`💾 [Sauvegardes] Créée : ${name}`))
      .catch((e) => console.error('💾 [Sauvegardes] Échec :', e.message));
  };
  setTimeout(runIfDue, 30 * 1000).unref?.(); // laisse le boot se terminer
  // Jamais l'intervalle lui-même : au-delà de ~24,8 jours, Node le ramènerait à 1 ms
  const timer = setInterval(runIfDue, backup.backupCheckDelayMs(intervalMs));
  if (timer.unref) timer.unref(); // ne bloque pas l'arrêt du process
}

// --- Restauration ---

// Erreur de restauration au statut HTTP explicite (message destiné à l'interface).
class RestoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RestoreError';
    this.status = status;
  }
}

// adm-zip charge l'archive entière en mémoire : bornes de taille.
const RESTORE_MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const RESTORE_MAX_JSON_BYTES = 20 * 1024 * 1024;

// Ouvre (et charge en mémoire) une sauvegarde par son nom strictement validé.
function openBackupArchive(name) {
  const file = backupFilePath(name);
  if (!file) throw new RestoreError(400, 'Nom de sauvegarde invalide.');
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new RestoreError(404, 'Sauvegarde introuvable.');
  }
  if (!st.isFile()) throw new RestoreError(404, 'Sauvegarde introuvable.');
  if (st.size > RESTORE_MAX_ARCHIVE_BYTES) {
    throw new RestoreError(413, "Sauvegarde trop volumineuse pour être restaurée depuis l'interface (plus de 1 Go).");
  }
  const AdmZip = require('adm-zip');
  try {
    return new AdmZip(fs.readFileSync(file));
  } catch {
    throw new RestoreError(400, 'Sauvegarde illisible : archive zip invalide.');
  }
}

// Texte d'une entrée JSON de l'archive ; null si absente, dossier ou trop volumineuse.
function readEntryText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  if (!entry || entry.isDirectory) return null;
  if (Number(entry.header && entry.header.size) > RESTORE_MAX_JSON_BYTES) return null;
  try {
    return zip.readAsText(entry);
  } catch {
    return null;
  }
}

const entryNamesOf = (zip) => zip.getEntries().map((e) => e.entryName);

// Contenu d'une sauvegarde : un résumé par site (pages, articles et images restaurables,
// thème valide, site encore existant).
async function describeBackup(name) {
  const zip = openBackupArchive(name);
  const entryNames = entryNamesOf(zip);
  const manifest = backup.parseBackupManifest(readEntryText(zip, 'manifest.json'));
  const { parseSiteContent } = require('./site-import');
  const existing = new Set((await sitesStore.listSites()).map((s) => s.slug));
  const sites = backup.listBackupSites(entryNames).map((slug) => {
    const read = (file) => readEntryText(zip, `sites/${slug}/${file}`);
    const content = parseSiteContent(read);
    const meta = backup.parseBackupSiteMeta(read('site.json'));
    return {
      slug,
      name: meta.name || slug,
      pages: content.pages ? content.pages.docs.length : 0,
      posts: content.posts ? content.posts.length : 0,
      media: backup.backupMediaEntries(entryNames, slug).length,
      theme: Boolean(content.theme),
      exists: existing.has(slug),
    };
  });
  return { name, createdAt: manifest.createdAt, format: manifest.format, sites };
}

let restoreInProgress = false;

// Restaure un site depuis une sauvegarde.
// - copy : nouveau site en brouillon (« <slug>-restauration », ou le slug d'origine si le
//   site a été supprimé depuis et que l'adresse est libre) ; rien d'existant n'est modifié.
// - replace : contenu du site existant remplacé, sous le créneau de build et après une
//   sauvegarde de sécurité de tous les sites.
async function restoreSiteFromBackup({ name, slug, mode }) {
  if (restoreInProgress) throw new RestoreError(409, 'Une restauration est déjà en cours : réessayez dans un instant.');
  restoreInProgress = true;
  try {
    // Archive lue et chargée en mémoire AVANT toute sauvegarde de sécurité : la rétention
    // peut supprimer l'archive restaurée si c'est la plus ancienne.
    const zip = openBackupArchive(name);
    const entryNames = entryNamesOf(zip);
    if (!backup.listBackupSites(entryNames).includes(slug)) {
      throw new RestoreError(404, "Ce site n'est pas dans cette sauvegarde.");
    }
    const { parseSiteContent, createSiteFromContent, replaceSiteContent } = require('./site-import');
    const content = parseSiteContent((file) => readEntryText(zip, `sites/${slug}/${file}`));
    const meta = backup.parseBackupSiteMeta(readEntryText(zip, `sites/${slug}/site.json`));
    const mediaFiles = backup.backupMediaEntries(entryNames, slug).map(({ entryName, filename }) => {
      const entry = zip.getEntry(entryName);
      return { filename, size: Number(entry.header.size) || 0, read: () => entry.getData() };
    });
    const existing = await sitesStore.getSiteBySlug(slug);

    if (mode === 'copy') {
      // Site supprimé depuis : recréé sous son slug d'origine s'il est libre. Sauvegarde
      // sans images (format 1) : celles citées sont reprises du site d'origine s'il existe.
      const baseSlug = existing ? `${slug.slice(0, 180).replace(/-+$/, '')}-restauration` : slug;
      const siteName = existing ? `${(meta.name || slug).slice(0, 185)} (restauration)` : (meta.name || slug);
      const result = await createSiteFromContent({
        baseSlug,
        name: siteName,
        stack: meta.stack,
        content,
        mediaFiles,
        mediaSourceSlug: existing ? slug : null,
      });
      return {
        mode,
        site: result.site,
        pages: content.pages ? content.pages.docs.length : 0,
        posts: content.posts ? content.posts.length : 0,
        theme: Boolean(content.theme),
        media: result.media,
        skipped: content.skipped,
      };
    }

    if (!existing) throw new RestoreError(404, "Ce site n'existe plus : restaurez-le en copie.");
    const build = require('./build');
    // Aucun build ni brouillon pendant le remplacement (il lirait un contenu à moitié écrit).
    // Le slug est transmis pour que la réservation désigne ce site quand le créneau le gère.
    if (!build.tryReserve(slug)) throw new RestoreError(409, 'Un build est en cours : réessayez quand il sera terminé.');
    let safetyBackup = null;
    try {
      safetyBackup = await createBackupArchive();
      if (!safetyBackup) throw new RestoreError(409, 'Une sauvegarde est déjà en cours : réessayez dans un instant.');
      const r = await replaceSiteContent(slug, content, { mediaFiles });
      return { mode, site: existing, safetyBackup, ...r, skipped: content.skipped };
    } catch (e) {
      if (safetyBackup && !(e instanceof RestoreError)) {
        const err = new RestoreError(500, `Restauration interrompue : le contenu de « ${existing.name} » peut être partiellement restauré. Sauvegarde de sécurité : ${safetyBackup}.`);
        err.cause = e;
        err.safetyBackup = safetyBackup;
        throw err;
      }
      throw e;
    } finally {
      build.release();
    }
  } finally {
    restoreInProgress = false;
  }
}

module.exports = {
  createBackupArchive,
  listBackups,
  backupConfig,
  backupFilePath,
  scheduleBackups,
  RestoreError,
  // Validation de la demande (lib/backup), réexportée pour la route
  parseRestoreRequest: backup.parseRestoreRequest,
  describeBackup,
  restoreSiteFromBackup,
};
