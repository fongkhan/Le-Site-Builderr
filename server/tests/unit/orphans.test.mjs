import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findOrphans, isPurgeableDataFileName } = require('../../lib/orphans.js');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const file = (name, ageMs = 0) => ({ name, bytes: 10, mtimeMs: NOW - ageMs });
const names = (list) => list.map((e) => e.name);

test('fichiers de données — sites inconnus listés, sites connus et fichiers du serveur jamais', () => {
  const out = findOrphans({
    knownSlugs: new Set(['vivant']),
    now: NOW,
    dataFiles: [
      file('site_vivant_pages.json'), file('site_vivant_theme.json'), file('posts_vivant.json'), file('stats_vivant.json'), file('submissions_vivant.json'),
      file('site_mort_pages.json'), file('site_mort_theme.json'), file('posts_mort.json'), file('stats_mort.json'), file('submissions_mort.json'),
      file('sites.json'), file('build-logs.txt'), file('build-queue.json'), file('ai-usage.json'),
      file('site_A_B_pages.json'), file('posts_..json'), file('posts_-x.json'), file('notes.txt'),
    ],
  });
  assert.deepEqual(names(out.dataFiles).sort(), ['posts_mort.json', 'site_mort_pages.json', 'site_mort_theme.json', 'stats_mort.json', 'submissions_mort.json']);
});

test('fichiers temporaires d’écriture — récents ignorés, anciens listés', () => {
  const out = findOrphans({
    now: NOW,
    dataFiles: [file('sites.json.123.tmp', 5 * 60 * 1000), file('site_x_pages.json.456.tmp', 2 * HOUR), file('x.tmp', 2 * HOUR)],
  });
  assert.deepEqual(names(out.dataFiles), ['site_x_pages.json.456.tmp']);
});

test('versions et brouillons — slug valide et inconnu uniquement', () => {
  const dirs = [{ name: 'vivant' }, { name: 'mort' }, { name: 'Site_Importe' }, { name: 'mort.tmp-draft' }, { name: 'mort.old-draft' }];
  const out = findOrphans({ knownSlugs: new Set(['vivant']), releaseDirs: dirs, draftDirs: dirs });
  assert.deepEqual(names(out.releases), ['mort']);
  assert.deepEqual(names(out.drafts), ['mort']);
});

test('dépôts — copie marquée non enregistrée purgeable ; sans marqueur ou enregistrée : jamais', () => {
  const out = findOrphans({
    knownSlugs: new Set(['vivant']),
    repoDirs: [
      { name: 'copie-morte', provisioned: true },
      { name: 'depot-importe', provisioned: false },
      { name: 'vivant', provisioned: true },
      { name: 'enregistre-ailleurs', provisioned: true },
      { name: 'Depot_Client', provisioned: true },
    ],
    registeredRepoNames: new Set(['vivant', 'enregistre-ailleurs']),
  });
  assert.deepEqual(names(out.repositories), ['copie-morte']);
  assert.deepEqual(names(out.kept.repositories).sort(), ['Depot_Client', 'depot-importe']);
});

test('dossiers publiés sans site — signalés (conservés), jamais purgeables ; copies de bascule ignorées', () => {
  const out = findOrphans({
    knownSlugs: new Set(['vivant']),
    publicDirs: [{ name: 'vivant' }, { name: 'ancien-site' }, { name: 'client' }, { name: 'vivant.old-vivant' }, { name: 'x.tmp-rollback' }],
    registeredPublicNames: new Set(['vivant', 'client']),
  });
  assert.deepEqual(names(out.kept.publicDirs), ['ancien-site']);
  for (const category of ['dataFiles', 'releases', 'drafts', 'repositories']) {
    assert.ok(!names(out[category]).includes('ancien-site'), category);
  }
});

test('isPurgeableDataFileName — revalidation du motif', () => {
  assert.equal(isPurgeableDataFileName('posts_mort.json'), true);
  assert.equal(isPurgeableDataFileName('sites.json'), false);
  assert.equal(isPurgeableDataFileName('../posts_mort.json'), false);
  assert.equal(isPurgeableDataFileName('posts_A.json'), false);
  assert.equal(isPurgeableDataFileName(42), false);
});
