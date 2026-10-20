import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { measureDir } = require('../../lib/dir-size.js');
const { parseChangelogVersion, readAppVersion } = require('../../lib/version.js');
const { backupState, isPartialBackupName } = require('../../lib/backup-state.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'system-'));

test('measureDir — octets et fichiers, liens symboliques jamais suivis', async () => {
  const dir = path.join(tmp, 'mesure');
  fs.mkdirSync(path.join(dir, 'sous', 'dossier'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x'.repeat(100));
  fs.writeFileSync(path.join(dir, 'sous', 'b.txt'), 'x'.repeat(20));
  fs.writeFileSync(path.join(dir, 'sous', 'dossier', 'c.txt'), 'x'.repeat(3));
  const outside = path.join(tmp, 'gros-fichier-externe');
  fs.writeFileSync(outside, 'x'.repeat(5000));
  let linked = false;
  try {
    fs.symlinkSync(outside, path.join(dir, 'lien'));
    fs.symlinkSync(tmp, path.join(dir, 'boucle'));
    linked = true;
  } catch { /* liens symboliques indisponibles (Windows sans droits) */ }
  const out = await measureDir(dir);
  assert.deepEqual(out, { bytes: 123, files: 3, truncated: false }, linked ? 'liens ignorés' : 'sans liens');
});

test('measureDir — nombre d’entrées borné, dossier absent', async () => {
  const dir = path.join(tmp, 'borne');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(dir, n), 'x');
  const out = await measureDir(dir, { maxEntries: 2 });
  assert.equal(out.truncated, true);
  assert.ok(out.files <= 2);
  assert.deepEqual(await measureDir(path.join(tmp, 'absent')), { bytes: 0, files: 0, truncated: false });
});

test('parseChangelogVersion / readAppVersion — CHANGELOG, puis package.json, puis « inconnue »', () => {
  assert.equal(parseChangelogVersion('# Changelog\n\n## [2.3.0] - 2026-10-02\n\n## [2.2.0] - 2026-10-01'), '2.3.0');
  assert.equal(parseChangelogVersion('# Changelog\n\n## [Non publié]\n\n## [2.4.1] - 2026-11-01'), '2.4.1');
  assert.equal(parseChangelogVersion('# Rien'), null);
  assert.equal(parseChangelogVersion(undefined), null);

  const withPkg = path.join(tmp, 'projet-pkg');
  fs.mkdirSync(withPkg);
  fs.writeFileSync(path.join(withPkg, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  assert.equal(readAppVersion(withPkg), '1.2.3');
  const empty = path.join(tmp, 'projet-vide');
  fs.mkdirSync(empty);
  assert.equal(readAppVersion(empty), 'inconnue');
  const withChangelog = path.join(tmp, 'projet-changelog');
  fs.mkdirSync(withChangelog);
  fs.writeFileSync(path.join(withChangelog, 'CHANGELOG.md'), '# Changelog\n\n## [9.8.7] - 2026-10-20\n');
  fs.writeFileSync(path.join(withChangelog, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  assert.equal(readAppVersion(withChangelog), '9.8.7');
});

test('backupState — désactivées, aucune, en retard, ok', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(backupState({ enabled: false, intervalHours: 24, latestCreatedAt: '2026-10-20T11:00:00Z', now }), 'désactivées');
  assert.equal(backupState({ enabled: true, intervalHours: 24, latestCreatedAt: null, now }), 'aucune');
  assert.equal(backupState({ enabled: true, intervalHours: 24, latestCreatedAt: '2026-10-18T11:00:00Z', now }), 'en retard');
  assert.equal(backupState({ enabled: true, intervalHours: 24, latestCreatedAt: '2026-10-19T13:00:00Z', now }), 'ok');
});

test('isPartialBackupName — archive inachevée au nom valide uniquement', () => {
  assert.equal(isPartialBackupName('backup-2026-10-02T02-27-27.zip.part'), true);
  assert.equal(isPartialBackupName('backup-2026-10-02T02-27-27.zip'), false);
  assert.equal(isPartialBackupName('x.part'), false);
  assert.equal(isPartialBackupName('../backup-2026-10-02T02-27-27.zip.part'), false);
  assert.equal(isPartialBackupName(null), false);
});

// --- Service : inventaire et nettoyage sur des racines temporaires ------------------------
const config = require('../../core/config.js');
const root = path.join(tmp, 'racines');
Object.assign(config, {
  DATA_DIR: path.join(root, 'data'),
  RELEASES_DIR: path.join(root, 'releases'),
  DRAFTS_DIR: path.join(root, 'drafts'),
  REPOSITORIES_DIR: path.join(root, 'repositories'),
  PUBLIC_HTML_DIR: path.join(root, 'public_html'),
  BACKUPS_DIR: path.join(root, 'backups'),
  LOCK_FILE: path.join(root, 'build.lock'),
  LOGS_FILE: path.join(root, 'build-logs.txt'),
});
const sitesFile = path.join(root, 'sites.json');
const sitesStore = require('../../sites-store.js');
const write = (rel, content = 'x') => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('removePartialBackups — archives inachevées supprimées, le reste conservé', () => {
  const system = require('../../services/system.js');
  write('backups/backup-2026-10-02T02-27-27.zip.part');
  write('backups/backup-2026-10-01T02-27-27.zip');
  write('backups/notes.part');
  assert.deepEqual(system.removePartialBackups(), ['backup-2026-10-02T02-27-27.zip.part']);
  assert.ok(!exists('backups/backup-2026-10-02T02-27-27.zip.part'));
  assert.ok(exists('backups/backup-2026-10-01T02-27-27.zip'));
  assert.ok(exists('backups/notes.part'));
});

test('scanOrphans / purgeOrphans — recalcul serveur, sélection, site occupé épargné', async () => {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(sitesFile, JSON.stringify([
    { slug: 'vivant', name: 'Vivant', documentRoot: path.join(config.PUBLIC_HTML_DIR, 'vivant'), repositoryPath: path.join(config.REPOSITORIES_DIR, 'vivant') },
  ]));
  sitesStore.init({ getPayload: () => null, sitesFile });
  write('data/site_vivant_pages.json');
  write('data/posts_mort.json', 'x'.repeat(40));
  write('data/stats_occupe.json');
  write('data/sites.json', '[]');
  write('releases/mort/1/index.html', 'x'.repeat(10));
  write('drafts/mort/index.html');
  write('drafts/vivant/index.html');
  write('repositories/vivant/.meta-builder-provisioned');
  write('repositories/copie-morte/.meta-builder-provisioned');
  write('repositories/copie-morte/package.json', '{}');
  write('repositories/depot-importe/package.json', '{}');
  write('public_html/vivant/index.html');
  write('public_html/ancien-site/index.html');

  const system = require('../../services/system.js');
  const scan = await system.scanOrphans();
  assert.deepEqual(scan.dataFiles.map((e) => e.name).sort(), ['posts_mort.json', 'stats_occupe.json']);
  assert.deepEqual(scan.releases, [{ name: 'mort', bytes: 10 }]);
  assert.deepEqual(scan.drafts.map((e) => e.name), ['mort']);
  assert.deepEqual(scan.repositories.map((e) => e.name), ['copie-morte']);
  assert.deepEqual(scan.kept, { publicDirs: [{ name: 'ancien-site' }], repositories: [{ name: 'depot-importe' }] });
  assert.ok(!JSON.stringify(scan).includes(root), 'aucun chemin absolu');

  // Sélection : seuls les noms cochés ; un site en cours de build n'est jamais touché
  const build = require('../../services/build.js');
  assert.equal(build.tryReserve('occupe'), true);
  let result;
  try {
    result = await system.purgeOrphans({ categories: ['dataFiles', 'drafts', 'releases'], names: ['posts_mort.json', 'mort', 'stats_occupe.json'] });
  } finally {
    build.release();
  }
  assert.deepEqual(result.removed, { dataFiles: ['posts_mort.json'], releases: ['mort'], drafts: ['mort'], repositories: [] });
  assert.equal(result.failed, 0);
  assert.ok(result.bytes >= 50, `octets libérés : ${result.bytes}`);
  assert.ok(!exists('data/posts_mort.json') && !exists('releases/mort') && !exists('drafts/mort'));
  assert.ok(exists('data/stats_occupe.json'), 'site occupé épargné');
  assert.ok(exists('repositories/copie-morte'), 'catégorie non demandée conservée');
  for (const kept of ['data/site_vivant_pages.json', 'data/sites.json', 'drafts/vivant/index.html', 'public_html/ancien-site/index.html', 'repositories/depot-importe/package.json', 'repositories/vivant/.meta-builder-provisioned']) {
    assert.ok(exists(kept), `${kept} conservé`);
  }

  const second = await system.purgeOrphans({ categories: ['repositories'] });
  assert.deepEqual(second.removed.repositories, ['copie-morte']);
  assert.ok(!exists('repositories/copie-morte') && exists('repositories/depot-importe'));
});
