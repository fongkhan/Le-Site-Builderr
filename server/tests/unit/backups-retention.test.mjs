import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Rétention par famille : les sauvegardes de sécurité (avant une suppression ou un
// remplacement) n'évincent jamais les sauvegardes planifiées et manuelles, et ne
// repoussent pas la suivante. Mode sans base, dossiers isolés et rétentions réduites
// AVANT le chargement du service.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-retention-'));
const config = require('../../core/config.js');
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.BACKUPS_DIR = path.join(tmp, 'backups');
config.BACKUP_ENABLED = true;
config.BACKUP_INTERVAL_HOURS = 24;
config.BACKUP_KEEP = 2;
process.env.BACKUP_KEEP_SAFETY = '2';
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.REPOSITORIES_DIR = path.join(tmp, 'repositories');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.UPLOADS_DIR = path.join(tmp, 'uploads');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });
const backups = require('../../services/backups.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = () => backups.listBackups().map((b) => b.name).sort();
const OLD = ['backup-2020-01-01T00-00-00.zip', 'backup-2020-01-02T00-00-00.zip'];

test('createBackupArchive — sauvegardes de sécurité comptées à part : l’historique planifié reste intact', async () => {
  fs.mkdirSync(config.BACKUPS_DIR, { recursive: true });
  for (const name of OLD) fs.writeFileSync(path.join(config.BACKUPS_DIR, name), 'archive planifiée');
  assert.equal(backups.backupConfig().keepSafety, 2);

  const safety = [];
  for (let i = 0; i < 3; i++) safety.push(await backups.createBackupArchive({ safety: true }));
  assert.ok(safety.every((n) => /^backup-.*-securite\.zip$/.test(n)), safety.join(', '));
  // Les deux sauvegardes planifiées survivent à trois sauvegardes de sécurité
  assert.deepEqual(names(), [...OLD, ...safety.slice(1)].sort());

  // Une sauvegarde manuelle n'évince que la plus ancienne de sa famille
  const manual = await backups.createBackupArchive();
  assert.match(manual, /^backup-[\dT-]+\.zip$/);
  assert.deepEqual(names(), [OLD[1], manual, ...safety.slice(1)].sort());
});

test('scheduleBackups — une sauvegarde de sécurité récente ne repousse pas la sauvegarde planifiée', async () => {
  // Seule archive récente : une sauvegarde de sécurité ; la dernière planifiée date de 2020
  for (const name of fs.readdirSync(config.BACKUPS_DIR)) fs.rmSync(path.join(config.BACKUPS_DIR, name));
  fs.writeFileSync(path.join(config.BACKUPS_DIR, OLD[0]), 'archive planifiée');
  fs.utimesSync(path.join(config.BACKUPS_DIR, OLD[0]), new Date('2020-01-01'), new Date('2020-01-01'));
  const safety = await backups.createBackupArchive({ safety: true });

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
  for (let i = 0; i < 100 && names().length < 3; i++) await sleep(25);
  const regular = names().filter((n) => n !== safety && n !== OLD[0]);
  assert.equal(regular.length, 1, `sauvegarde planifiée non lancée : ${names().join(', ')}`);
  assert.doesNotMatch(regular[0], /-securite/);
});
