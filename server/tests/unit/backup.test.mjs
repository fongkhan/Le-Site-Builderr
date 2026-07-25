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
