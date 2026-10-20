import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Service de sauvegarde en mode sans base : planification, noms d'archives, contenu et
// restauration (copie, remplacement). Sauvegardes, racines de publication et magasin de
// sites isolés dans un dossier temporaire, remplacés AVANT le chargement des services.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-service-'));
const config = require('../../core/config.js');
// Fichiers de données des sites de test : dossier data/ réel, créé d'emblée et jamais
// supprimé (d'autres fichiers de test, lancés en parallèle, peuvent l'utiliser)
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.BACKUPS_DIR = path.join(tmp, 'backups');
config.BACKUP_ENABLED = true;
config.BACKUP_INTERVAL_HOURS = 720; // 30 jours : au-delà de la borne des minuteurs Node
config.BACKUP_KEEP = 50;
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.REPOSITORIES_DIR = path.join(tmp, 'repositories');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.UPLOADS_DIR = path.join(tmp, 'uploads');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const AdmZip = require('adm-zip');
const { getSitePagesFile, getSiteThemeFile, getSitePostsFile } = config;
const { DEFAULT_THEME } = require('../../services/defaults.js');
const backups = require('../../services/backups.js');
const build = require('../../services/build.js');
const { purgeSiteData } = require('../../services/sites.js');

const RUN = `${process.pid}-${Date.now()}`;
const SLUG = `zz-unit-sauvegarde-${RUN}`;
const COPY_SLUG = `${SLUG}-restauration`;
const GONE_SLUG = `zz-unit-publie-${RUN}`;
after(() => {
  for (const slug of [SLUG, COPY_SLUG, GONE_SLUG, `${GONE_SLUG}-2`]) {
    for (const file of [getSitePagesFile(slug), getSiteThemeFile(slug), getSitePostsFile(slug)]) fs.rmSync(file, { force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MAX_TIMER_MS = 2147483647;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (slug, title) => ({ title, slug, layout: [{ blockType: 'hero', title }] });
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const THEME = { ...DEFAULT_THEME.theme, colors: { ...DEFAULT_THEME.theme.colors, primary: '#0A0B0C' } };
// Archive de référence (créée par le 2e test, restaurée par les suivants)
let archiveName = null;

async function waitFor(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await sleep(50);
  }
  assert.fail(`délai dépassé : ${label}`);
}

test('scheduleBackups — vérification horaire (jamais un minuteur > 2^31−1 ms), sauvegarde seulement si due', async () => {
  const realSetInterval = globalThis.setInterval;
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setInterval = (fn, ms) => { timers.push({ kind: 'interval', fn, ms }); return { unref() {} }; };
  globalThis.setTimeout = (fn, ms) => { timers.push({ kind: 'timeout', fn, ms }); return { unref() {} }; };
  try {
    backups.scheduleBackups();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.setTimeout = realSetTimeout;
  }
  const interval = timers.find((t) => t.kind === 'interval');
  assert.ok(interval, 'vérification périodique planifiée');
  assert.ok(interval.ms > 0 && interval.ms <= MAX_TIMER_MS, `délai ${interval.ms} ms`);
  assert.equal(interval.ms, 3600000);
  assert.ok(timers.every((t) => t.ms <= MAX_TIMER_MS));

  // Aucune sauvegarde : la vérification en crée une
  assert.equal(backups.listBackups().length, 0);
  interval.fn();
  await waitFor(() => backups.listBackups().length === 1, 'première sauvegarde planifiée');
  // Sauvegarde récente : la vérification suivante ne fait rien
  interval.fn();
  await sleep(300);
  assert.equal(backups.listBackups().length, 1);
});

test('createBackupArchive — format 2, thème lu, deux sauvegardes dans la même seconde distinctes', async () => {
  await sitesStore.createSite({ slug: SLUG, name: 'Sauvegarde unitaire', status: 'draft' });
  fs.writeFileSync(getSitePagesFile(SLUG), JSON.stringify({ docs: [page('home', 'Accueil'), page('contact', 'Contact')] }));
  fs.writeFileSync(getSitePostsFile(SLUG), JSON.stringify({ docs: [{ title: 'Article', slug: 'article' }] }));
  fs.writeFileSync(getSiteThemeFile(SLUG), JSON.stringify({ theme: THEME }));

  const first = await backups.createBackupArchive();
  const second = await backups.createBackupArchive();
  assert.ok(first && second);
  assert.notEqual(first, second);
  archiveName = second;
  for (const name of [first, second]) assert.ok(fs.existsSync(path.join(config.BACKUPS_DIR, name)), name);

  const zip = new AdmZip(path.join(config.BACKUPS_DIR, second));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.format, 2);
  assert.equal(manifest.media, true);
  assert.ok(manifest.sites.includes(SLUG));
  assert.deepEqual(JSON.parse(zip.readAsText(`sites/${SLUG}/theme.json`)), { theme: THEME });
  assert.equal(JSON.parse(zip.readAsText(`sites/${SLUG}/pages.json`)).docs.length, 2);
  assert.equal(backups.backupConfig().media, true);
});

test('describeBackup — sites contenus et comptes ; noms hostiles, absents ou illisibles', async () => {
  const latest = { name: archiveName };
  const d = await backups.describeBackup(latest.name);
  assert.equal(d.name, latest.name);
  assert.equal(d.format, 2);
  const site = d.sites.find((s) => s.slug === SLUG);
  assert.deepEqual(site, { slug: SLUG, name: 'Sauvegarde unitaire', pages: 2, posts: 1, media: 0, theme: true, exists: true, slugFree: false });

  await assert.rejects(backups.describeBackup('../etc/passwd'), (e) => e instanceof backups.RestoreError && e.status === 400);
  await assert.rejects(backups.describeBackup('backup-1999-01-01T00-00-00.zip'), (e) => e.status === 404);
  const corrupt = 'backup-1999-01-02T00-00-00.zip';
  fs.writeFileSync(path.join(config.BACKUPS_DIR, corrupt), 'pas un zip');
  await assert.rejects(backups.describeBackup(corrupt), (e) => e.status === 400 && /illisible/.test(e.message));
  fs.rmSync(path.join(config.BACKUPS_DIR, corrupt));
});

test('restoreSiteFromBackup — copie : nouveau brouillon, le site actuel intact', async () => {
  const latest = { name: archiveName };
  // Le site a changé depuis la sauvegarde
  fs.writeFileSync(getSitePagesFile(SLUG), JSON.stringify({ docs: [page('autre', 'Autre')] }));

  await assert.rejects(backups.restoreSiteFromBackup({ name: latest.name, slug: 'zz-absent', mode: 'copy' }), (e) => e.status === 404 && /pas dans cette sauvegarde/.test(e.message));

  const r = await backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'copy' });
  assert.equal(r.mode, 'copy');
  assert.equal(r.site.slug, COPY_SLUG);
  assert.equal(r.site.name, 'Sauvegarde unitaire (restauration)');
  assert.equal(r.site.status, 'draft');
  assert.deepEqual([r.pages, r.posts, r.theme], [2, 1, true]);
  assert.deepEqual(r.skipped, { pages: 0, posts: 0, theme: false });
  assert.deepEqual(readJson(getSitePagesFile(COPY_SLUG)).docs.map((p) => p.slug), ['home', 'contact']);
  assert.deepEqual(readJson(getSitePagesFile(SLUG)).docs.map((p) => p.slug), ['autre']);
  assert.deepEqual(readJson(getSiteThemeFile(COPY_SLUG)), { theme: THEME });
});

test('restoreSiteFromBackup — remplacement : sauvegarde de sécurité puis contenu remplacé', async () => {
  const latest = { name: archiveName };
  const before = backups.listBackups().length;

  // Build en cours : refus, rien n'est écrit
  assert.ok(build.tryReserve());
  try {
    await assert.rejects(backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'replace' }), (e) => e.status === 409 && /build/.test(e.message));
  } finally {
    build.release();
  }
  assert.equal(backups.listBackups().length, before);

  const r = await backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'replace' });
  assert.equal(r.mode, 'replace');
  assert.equal(r.site.slug, SLUG);
  assert.match(r.safetyBackup, /^backup-.*-securite\.zip$/);
  assert.notEqual(r.safetyBackup, latest.name);
  assert.equal(backups.listBackups().length, before + 1);
  assert.deepEqual([r.pages, r.posts, r.theme], [2, 1, true]);
  // La page « autre », ajoutée après la sauvegarde, est retirée
  assert.deepEqual(readJson(getSitePagesFile(SLUG)).docs.map((p) => p.slug), ['home', 'contact']);
  // Le créneau de build est libéré
  assert.ok(build.tryReserve());
  build.release();
  // La sauvegarde de sécurité contient l'état d'avant la restauration
  const safety = new AdmZip(path.join(config.BACKUPS_DIR, r.safetyBackup));
  assert.deepEqual(JSON.parse(safety.readAsText(`sites/${SLUG}/pages.json`)).docs.map((p) => p.slug), ['autre']);
});

test('restoreSiteFromBackup — remplacement : sauvegarde de sécurité non restaurable (> 1 Go) retirée, rien de remplacé (409)', async () => {
  const latest = { name: archiveName };
  fs.writeFileSync(getSitePagesFile(SLUG), JSON.stringify({ docs: [page('modifiee', 'Modifiée')] }));
  const before = backups.listBackups().map((b) => b.name);
  // Taille lue par le service : toute sauvegarde de sécurité dépasse la borne de 1 Go
  const realStat = fs.statSync;
  fs.statSync = function statSync(p, ...rest) {
    const st = realStat.call(this, p, ...rest);
    if (/-securite\.zip$/.test(String(p))) Object.defineProperty(st, 'size', { value: backups.RESTORE_MAX_ARCHIVE_BYTES + 1 });
    return st;
  };
  try {
    await assert.rejects(
      backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'replace' }),
      (e) => e instanceof backups.RestoreError && e.status === 409 && /trop volumineuse/.test(e.message) && !e.safetyBackup,
    );
  } finally {
    fs.statSync = realStat;
  }
  assert.deepEqual(backups.listBackups().map((b) => b.name), before, 'sauvegarde de sécurité inutilisable conservée');
  assert.deepEqual(readJson(getSitePagesFile(SLUG)).docs.map((p) => p.slug), ['modifiee'], 'contenu remplacé malgré le refus');
  assert.ok(build.tryReserve(), 'créneau non libéré');
  build.release();
});

test('restoreSiteFromBackup — site supprimé : remplacement refusé, copie sous le slug d’origine', async () => {
  const latest = { name: archiveName };
  // Comme DELETE /api/sites/:slug : fiche puis données locales (sinon le slug reste réservé)
  for (const slug of [COPY_SLUG, SLUG]) {
    await sitesStore.deleteSite(slug);
    purgeSiteData(slug);
  }

  await assert.rejects(backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'replace' }), (e) => e.status === 404 && /n'existe plus/.test(e.message));
  const r = await backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'copy' });
  assert.equal(r.site.slug, SLUG);
  assert.equal(r.site.name, 'Sauvegarde unitaire');
  assert.deepEqual(readJson(getSitePagesFile(SLUG)).docs.map((p) => p.slug), ['home', 'contact']);
});

test('restoreSiteFromBackup — une seule restauration à la fois', async () => {
  const latest = { name: archiveName };
  const first = backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'copy' });
  await assert.rejects(backups.restoreSiteFromBackup({ name: latest.name, slug: SLUG, mode: 'copy' }), (e) => e.status === 409 && /déjà en cours/.test(e.message));
  const r = await first;
  assert.equal(r.site.slug, COPY_SLUG);
  // Verrou libéré après la restauration, même en cas d'erreur
  await assert.rejects(backups.restoreSiteFromBackup({ name: 'backup-1999-01-01T00-00-00.zip', slug: SLUG, mode: 'copy' }), (e) => e.status === 404);
  await assert.rejects(backups.restoreSiteFromBackup({ name: latest.name, slug: 'zz-absent', mode: 'copy' }), (e) => e.status === 404);
});

test('describeBackup — site supprimé : slug d’origine libre, ou occupé par son dossier publié conservé', async () => {
  await sitesStore.createSite({ slug: GONE_SLUG, name: 'Site publié', status: 'active' });
  fs.writeFileSync(getSitePagesFile(GONE_SLUG), JSON.stringify({ docs: [page('home', 'Accueil')] }));
  const name = await backups.createBackupArchive();
  const entryOf = async () => (await backups.describeBackup(name)).sites.find((s) => s.slug === GONE_SLUG);
  assert.equal((await entryOf()).slugFree, false, 'site existant');

  // Supprimé avec les options par défaut : fiche et données retirées…
  await sitesStore.deleteSite(GONE_SLUG);
  purgeSiteData(GONE_SLUG);
  assert.deepEqual([(await entryOf()).exists, (await entryOf()).slugFree], [false, true]);
  // … mais dossier publié conservé (« Supprimer aussi les fichiers publiés » décochée)
  const documentRoot = path.join(config.PUBLIC_HTML_DIR, GONE_SLUG);
  fs.mkdirSync(documentRoot, { recursive: true });
  fs.writeFileSync(path.join(documentRoot, 'index.html'), '<h1>ancien site</h1>');
  assert.equal((await entryOf()).slugFree, false, 'adresse d’origine annoncée alors que le dossier publié l’occupe');
  const r = await backups.restoreSiteFromBackup({ name, slug: GONE_SLUG, mode: 'copy' });
  assert.equal(r.site.slug, `${GONE_SLUG}-2`);
  assert.equal(fs.readFileSync(path.join(documentRoot, 'index.html'), 'utf-8'), '<h1>ancien site</h1>');
});
