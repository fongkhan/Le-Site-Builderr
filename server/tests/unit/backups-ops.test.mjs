import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Sauvegardes et exploitation : sauvegarde planifiée attendue par l'arrêt propre, tous les
// sites sauvegardés (au-delà de la limite de la liste), restauration protégée contre une
// suppression ou un arrêt simultanés, informations légales restaurées en copie. Mode sans
// base (magasin de sites JSON), dossiers isolés remplacés AVANT le chargement des services.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-ops-'));
const config = require('../../core/config.js');
// Fichiers de données des sites de test : dossier data/ réel, créé d'emblée et jamais
// supprimé (d'autres fichiers de test, lancés en parallèle, peuvent l'utiliser)
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.BACKUPS_DIR = path.join(tmp, 'backups');
config.BACKUP_ENABLED = true;
config.BACKUP_INTERVAL_HOURS = 24;
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
// Base simulée (seulement pour le test « au-delà de 500 sites ») : null = magasin JSON
let fakeSitesDb = null;
sitesStore.init({ getPayload: () => fakeSitesDb, sitesFile });

const AdmZip = require('adm-zip');
const { getSitePagesFile, getSiteThemeFile, getSitePostsFile } = config;
const backups = require('../../services/backups.js');
const build = require('../../services/build.js');
const shutdown = require('../../core/shutdown.js');
const { parseBackupSiteLegal } = require('../../lib/backup.js');

const RUN = `${process.pid}-${Date.now()}`;
const SLUG = `zz-unit-ops-${RUN}`;
const created = new Set([SLUG, `${SLUG}-restauration`]);
after(() => {
  for (const slug of created) {
    for (const file of [getSitePagesFile(slug), getSiteThemeFile(slug), getSitePostsFile(slug)]) fs.rmSync(file, { force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEGAL = { companyName: 'Atelier Ops', address: '1 rue X\n69000 Lyon', phone: '04 78 00 00 00', email: 'contact@atelier.example' };
let archiveName = null;

async function waitFor(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(`délai dépassé : ${label}`);
}

test('scheduleBackups — la sauvegarde planifiée est attendue par l’arrêt propre (trackBackground)', async () => {
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
  const check = timers.find((t) => t.kind === 'interval');
  assert.ok(check, 'vérification périodique planifiée');

  assert.equal(shutdown.pendingBackground(), 0);
  check.fn();
  // Sauvegarde lancée : tâche de fond suivie jusqu'à la fin de l'écriture de l'archive
  assert.equal(shutdown.pendingBackground(), 1, 'sauvegarde planifiée non suivie par l’arrêt propre');
  await waitFor(() => shutdown.pendingBackground() === 0, 'fin de la sauvegarde planifiée');
  assert.equal(backups.listBackups().length, 1);
  // Sauvegarde récente : rien de lancé, rien de suivi
  check.fn();
  assert.equal(shutdown.pendingBackground(), 0);
});

test('createBackupArchive / describeBackup — tous les sites, au-delà des 500 de la liste (listAllSites)', async () => {
  // Base simulée : find borné par `limit` comme Payload (listSites : 500), complet sans pagination
  const docs = Array.from({ length: 501 }, (_, i) => ({ slug: `zz-unit-ops-masse-${String(i).padStart(3, '0')}`, name: `Masse ${i}` }));
  fakeSitesDb = {
    async find({ collection, where, limit, pagination }) {
      assert.equal(collection, 'payload_sites');
      let list = docs;
      if (where && where.slug) list = list.filter((d) => d.slug === where.slug.equals);
      if (pagination !== false && limit) list = list.slice(0, limit);
      return { docs: list };
    },
  };
  let name;
  let described;
  try {
    name = await backups.createBackupArchive();
    described = await backups.describeBackup(name);
  } finally {
    fakeSitesDb = null;
  }
  const zip = new AdmZip(path.join(config.BACKUPS_DIR, name));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.sites.length, 501);
  assert.ok(zip.getEntry(`sites/${docs[500].slug}/site.json`), '501e site absent de l’archive');
  const last = described.sites.find((s) => s.slug === docs[500].slug);
  assert.equal(last && last.exists, true, '501e site signalé comme supprimé');
  fs.rmSync(path.join(config.BACKUPS_DIR, name));
});

test('parseBackupSiteLegal — informations légales de site.json, normalisées', () => {
  const legal = parseBackupSiteLegal(JSON.stringify({ slug: 'x', legal: { companyName: '  A  ', inconnu: 'x', phone: 42 } }));
  assert.equal(Object.keys(legal).length, 11);
  assert.equal(legal.companyName, 'A');
  assert.equal(legal.phone, '');
  assert.equal(legal.inconnu, undefined);
  // Archive antérieure (sans legal) ou site.json illisible : champs vides
  for (const text of [JSON.stringify({ slug: 'x' }), 'pas du json', null]) {
    const empty = parseBackupSiteLegal(text);
    assert.equal(Object.keys(empty).length, 11);
    assert.ok(Object.values(empty).every((v) => v === ''), String(text));
  }
});

test('restoreSiteFromBackup — copie : informations légales du site sauvegardé reprises', async () => {
  await sitesStore.createSite({ slug: SLUG, name: 'Exploitation unitaire', status: 'draft', legal: LEGAL });
  fs.writeFileSync(getSitePagesFile(SLUG), JSON.stringify({ docs: [{ title: 'Accueil', slug: 'home', layout: [] }] }));
  archiveName = await backups.createBackupArchive();
  assert.ok(archiveName);

  const r = await backups.restoreSiteFromBackup({ name: archiveName, slug: SLUG, mode: 'copy' });
  assert.equal(r.site.slug, `${SLUG}-restauration`);
  assert.equal(r.site.legal.companyName, 'Atelier Ops');
  assert.equal(r.site.legal.address, '1 rue X\n69000 Lyon');
  assert.deepEqual((await sitesStore.getSiteBySlug(r.site.slug)).legal, r.site.legal);
  await sitesStore.deleteSite(r.site.slug);
});

test('restoreSiteFromBackup — remplacement : créneau réservé pour CE site (une suppression attend la fin)', async () => {
  const realRelease = build.release;
  let busyDuringRestore = null;
  build.release = () => {
    busyDuringRestore = build.isSiteBusy(SLUG);
    realRelease();
  };
  try {
    const r = await backups.restoreSiteFromBackup({ name: archiveName, slug: SLUG, mode: 'replace' });
    assert.equal(r.mode, 'replace');
  } finally {
    build.release = realRelease;
  }
  assert.equal(busyDuringRestore, true, 'restauration invisible pour isSiteBusy');
  assert.equal(build.isSiteBusy(SLUG), false, 'créneau non libéré');
});

test('restoreSiteFromBackup — remplacement refusé pendant la suppression du site (409), rien d’écrit', async () => {
  const before = backups.listBackups().length;
  const pages = fs.readFileSync(getSitePagesFile(SLUG), 'utf-8');
  build.markDeleting(SLUG);
  try {
    await assert.rejects(
      backups.restoreSiteFromBackup({ name: archiveName, slug: SLUG, mode: 'replace' }),
      (e) => e instanceof backups.RestoreError && e.status === 409 && e.message === 'Ce site est en cours de suppression.',
    );
  } finally {
    build.unmarkDeleting(SLUG);
  }
  assert.equal(backups.listBackups().length, before, 'sauvegarde de sécurité créée malgré le refus');
  assert.equal(fs.readFileSync(getSitePagesFile(SLUG), 'utf-8'), pages);
  // Créneau jamais pris : un build peut démarrer
  assert.ok(build.tryReserve());
  build.release();
});

test('restoreSiteFromBackup — site supprimé entre sa lecture et la réservation : 404, créneau libéré', async () => {
  const realGet = sitesStore.getSiteBySlug;
  let calls = 0;
  // 1re lecture : le site existe ; relecture après la réservation : il a été supprimé
  sitesStore.getSiteBySlug = async (slug) => (++calls === 1 ? realGet(slug) : null);
  const before = backups.listBackups().length;
  try {
    await assert.rejects(
      backups.restoreSiteFromBackup({ name: archiveName, slug: SLUG, mode: 'replace' }),
      (e) => e instanceof backups.RestoreError && e.status === 404,
    );
  } finally {
    sitesStore.getSiteBySlug = realGet;
  }
  assert.equal(calls, 2);
  assert.equal(backups.listBackups().length, before);
  assert.equal(build.isSiteBusy(SLUG), false);
  assert.ok(build.tryReserve());
  build.release();
});

// EN DERNIER : l'arrêt commencé ne se défait pas dans ce processus
test('restoreSiteFromBackup — arrêt du serveur en cours : 503 dans les deux modes ; plus de sauvegarde planifiée', async () => {
  shutdown.beginDrain();
  for (const mode of ['copy', 'replace']) {
    await assert.rejects(
      backups.restoreSiteFromBackup({ name: archiveName, slug: SLUG, mode }),
      (e) => e instanceof backups.RestoreError && e.status === 503 && e.message === 'Le serveur redémarre : réessayez dans un instant.',
      mode,
    );
  }
  assert.equal(await sitesStore.getSiteBySlug(`${SLUG}-restauration`), null, 'copie créée pendant l’arrêt');

  // Vérification périodique pendant l'arrêt : aucune sauvegarde lancée (même due)
  for (const name of fs.readdirSync(config.BACKUPS_DIR)) fs.rmSync(path.join(config.BACKUPS_DIR, name));
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
  timers.find((t) => t.kind === 'interval').fn();
  assert.equal(shutdown.pendingBackground(), 0);
  await sleep(100);
  assert.equal(backups.listBackups().length, 0, 'sauvegarde lancée pendant l’arrêt');
  await sitesStore.deleteSite(SLUG);
});
