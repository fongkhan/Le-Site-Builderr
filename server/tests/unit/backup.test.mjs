import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { backupFilename, isValidBackupName, selectBackupsToDelete } = require('../../lib/backup.js');

test('backupFilename — horodaté, triable', () => {
  const name = backupFilename(new Date('2026-07-22T11:30:05.000Z'));
  assert.equal(name, 'backup-2026-07-22T11-30-05.zip');
  assert.ok(isValidBackupName(name));
});

test('isValidBackupName — rejette les noms hostiles (anti-traversée)', () => {
  assert.ok(!isValidBackupName('../etc/passwd'));
  assert.ok(!isValidBackupName('backup-2026.zip'));
  assert.ok(!isValidBackupName('backup-2026-07-22T11-30-05.zip/../x'));
  assert.ok(!isValidBackupName('evil.zip'));
  assert.ok(!isValidBackupName(42));
});

test('selectBackupsToDelete — garde les N plus récents', () => {
  const names = [
    'backup-2026-07-20T10-00-00.zip',
    'backup-2026-07-21T10-00-00.zip',
    'backup-2026-07-22T10-00-00.zip',
    'pas-une-sauvegarde.zip',
  ];
  const toDelete = selectBackupsToDelete(names, 2);
  assert.deepEqual(toDelete, ['backup-2026-07-20T10-00-00.zip']); // le plus ancien
  assert.deepEqual(selectBackupsToDelete(names, 5), []); // rien à supprimer
  assert.deepEqual(selectBackupsToDelete([], 3), []);
});

test('selectBackupsToDelete — keep=0 supprime tout (sauf non conformes)', () => {
  const names = ['backup-2026-07-20T10-00-00.zip', 'garbage'];
  assert.deepEqual(selectBackupsToDelete(names, 0), ['backup-2026-07-20T10-00-00.zip']);
});

// --- Planification, noms libres, lecture d'une archive, demande de restauration ---
const {
  backupIntervalMs,
  backupCheckDelayMs,
  isBackupDue,
  nextFreeBackupName,
  listBackupSites,
  backupMediaEntries,
  backupMediaEntryName,
  parseBackupManifest,
  parseBackupSiteMeta,
  parseRestoreRequest,
} = require('../../lib/backup.js');

const MAX_TIMER_MS = 2147483647; // au-delà, Node ramène le délai d'un minuteur à 1 ms

test('backupIntervalMs — heures → ms, 24 h si invalide, 1 h minimum', () => {
  assert.equal(backupIntervalMs(24), 86400000);
  assert.equal(backupIntervalMs(720), 2592000000);
  assert.equal(backupIntervalMs('x'), 86400000);
  assert.equal(backupIntervalMs(undefined), 86400000);
  assert.equal(backupIntervalMs(-5), 3600000);
});

test('backupCheckDelayMs — jamais au-delà de la borne des minuteurs (720 h, 100000 h)', () => {
  assert.equal(backupCheckDelayMs(backupIntervalMs(720)), 3600000);
  assert.ok(backupCheckDelayMs(backupIntervalMs(720)) <= MAX_TIMER_MS);
  assert.ok(backupCheckDelayMs(backupIntervalMs(100000)) <= MAX_TIMER_MS);
  assert.equal(backupCheckDelayMs(backupIntervalMs(1)), 3600000);
  assert.equal(backupCheckDelayMs(NaN), 3600000);
});

test('isBackupDue — aucune sauvegarde ou date illisible : due ; sinon selon l’intervalle', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const day = backupIntervalMs(24);
  assert.equal(isBackupDue(null, now, day), true);
  assert.equal(isBackupDue('pas une date', now, day), true);
  assert.equal(isBackupDue(new Date(now - 23 * 3600000).toISOString(), now, day), false);
  assert.equal(isBackupDue(new Date(now - 24 * 3600000).toISOString(), now, day), true);
  assert.equal(isBackupDue(new Date(now - 25 * 3600000).toISOString(), now, day), true);
  // Tolérance : une archive terminée 2 min après l'heure prévue ne décale pas le cycle
  assert.equal(isBackupDue(new Date(now - day + 120000).toISOString(), now, day), false);
  assert.equal(isBackupDue(new Date(now - day + 120000).toISOString(), now, day, 600000), true);
});

test('nextFreeBackupName — seconde suivante si le nom existe déjà', () => {
  const date = new Date('2026-07-22T11:30:05Z');
  assert.equal(nextFreeBackupName(date, (n) => n === 'backup-2026-07-22T11-30-05.zip'), 'backup-2026-07-22T11-30-06.zip');
  assert.equal(nextFreeBackupName(date, () => false), backupFilename(date));
  // Tous pris : le dernier nom essayé (60 essais), jamais une boucle sans fin
  assert.equal(nextFreeBackupName(date, () => true), 'backup-2026-07-22T11-31-04.zip');
});

test('listBackupSites — slugs canoniques uniques et triés', () => {
  const entries = [
    'manifest.json',
    'sites/b/pages.json',
    'sites/a-site/site.json',
    'sites/a-site/theme.json',
    'sites/../x/pages.json',
    'sites/Bad_Slug/pages.json',
    'sites/c/sub/pages.json',
    'sites/d/media/photo.png',
    'sites/e/autre.json',
    42,
    null,
  ];
  assert.deepEqual(listBackupSites(entries), ['a-site', 'b']);
  assert.deepEqual(listBackupSites(undefined), []);
});

test('backupMediaEntries — seulement les images publiables du site demandé', () => {
  const entries = [
    'sites/s/pages.json',
    backupMediaEntryName('s', 'photo.png'),
    'sites/s/media/logo.svg',
    'sites/s/media/../x.png',
    'sites/s/media/sub/x.png',
    'sites/s/media/sans-extension',
    'sites/autre/media/autre.png',
  ];
  assert.equal(backupMediaEntryName('s', 'photo.png'), 'sites/s/media/photo.png');
  assert.deepEqual(backupMediaEntries(entries, 's'), [{ entryName: 'sites/s/media/photo.png', filename: 'photo.png' }]);
  assert.deepEqual(backupMediaEntries(['sites/../x/media/a.png'], '../x'), []);
});

test('parseBackupManifest — format 2, ancien format 1, JSON invalide', () => {
  assert.deepEqual(parseBackupManifest(JSON.stringify({ format: 2, createdAt: '2026-10-01T10:00:00.000Z', sites: [] })), { format: 2, createdAt: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(parseBackupManifest(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', sites: ['a'] })), { format: 1, createdAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(parseBackupManifest('{pas du json'), { format: 1, createdAt: null });
  assert.deepEqual(parseBackupManifest(null), { format: 1, createdAt: null });
  assert.deepEqual(parseBackupManifest(JSON.stringify({ format: '2', createdAt: 5 })), { format: 1, createdAt: null });
});

test('parseBackupSiteMeta — nom et stack seulement (jamais chemins, domaines ni jeton)', () => {
  const meta = parseBackupSiteMeta(JSON.stringify({
    name: '  Boulangerie  ',
    stack: 'Astro SSG',
    documentRoot: '/etc',
    repositoryPath: '/root',
    domainVerifyToken: 'secret',
    customDomain: 'exemple.fr',
  }));
  assert.deepEqual(meta, { name: 'Boulangerie', stack: 'Astro SSG' });
  assert.equal(parseBackupSiteMeta(JSON.stringify({ name: 'x'.repeat(500) })).name.length, 200);
  assert.deepEqual(parseBackupSiteMeta('invalide'), { name: '', stack: '' });
  assert.deepEqual(parseBackupSiteMeta(JSON.stringify({ name: 42 })), { name: '', stack: '' });
});

test('parseRestoreRequest — mode par défaut, mode inconnu, nom et slug hostiles', () => {
  const name = 'backup-2026-10-01T10-00-00.zip';
  assert.deepEqual(parseRestoreRequest({ name, slug: 'mon-site' }), { name, slug: 'mon-site', mode: 'copy' });
  assert.deepEqual(parseRestoreRequest({ name, slug: 'mon-site', mode: '' }), { name, slug: 'mon-site', mode: 'copy' });
  assert.deepEqual(parseRestoreRequest({ name, slug: 'mon-site', mode: 'replace' }), { name, slug: 'mon-site', mode: 'replace' });
  assert.match(parseRestoreRequest({ name, slug: 'mon-site', mode: 'tout' }).error, /Mode de restauration/);
  assert.match(parseRestoreRequest({ name: '../etc/passwd', slug: 'mon-site' }).error, /Nom de sauvegarde/);
  assert.match(parseRestoreRequest({ name, slug: '../x' }).error, /Site invalide/);
  assert.ok(parseRestoreRequest(null).error);
});
