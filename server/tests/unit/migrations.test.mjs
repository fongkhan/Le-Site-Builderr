import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Migrations versionnées (server/migrations, scripts/migrate.js) : le schéma de la
// configuration Payload doit correspondre au dernier instantané commité, vérifié sans
// base ni réseau (comme « npm run migrate:check » en CI).
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runTsx(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.DATABASE_URI;
  delete env.PAYLOAD_SECRET;
  delete env.NODE_ENV;
  return spawnSync(process.execPath, [tsxCli, ...args], { cwd: serverDir, env, encoding: 'utf8', timeout: 120000 });
}

test('migrate check — migrations à jour, sans DATABASE_URI ni PAYLOAD_SECRET (aucune connexion)', () => {
  const run = runTsx(['scripts/migrate.js', 'check']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /✔ Migrations à jour \(\d{8}_\d{6}_[\w]+\.json\)/);
});

test('migrations — index.ts, migration .ts et instantané .json versionnés ensemble', () => {
  const dir = path.join(serverDir, 'migrations');
  const files = fs.readdirSync(dir);
  const snapshots = files.filter((f) => f.endsWith('.json'));
  assert.ok(snapshots.length >= 1, 'aucun instantané .json');
  for (const json of snapshots) assert.ok(files.includes(json.replace(/\.json$/, '.ts')), `${json} sans migration .ts`);
  const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  for (const json of snapshots) assert.ok(index.includes(`name: '${json.replace(/\.json$/, '')}'`), `${json} absent de index.ts`);
  // Schéma FINAL : champs ajoutés par les lots de la vague 1 et par Payload 3.91
  const initial = fs.readFileSync(path.join(dir, snapshots.sort()[0].replace(/\.json$/, '.ts')), 'utf8');
  for (const column of ['"alt" varchar', '"logo" varchar', '"legal_company_name" varchar', '"cta_link" varchar', '"reset_password_requested_at"']) {
    assert.ok(initial.includes(column), `colonne ${column} absente de la migration initiale`);
  }
});

test('migrate — commande inconnue refusée en français (exit 1)', () => {
  const run = runTsx(['scripts/migrate.js', 'inconnue']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Commande inconnue « inconnue »/);
});

test('migrate create — nom obligatoire (aucun fichier écrit)', () => {
  const before = fs.readdirSync(path.join(serverDir, 'migrations')).sort();
  const run = runTsx(['scripts/migrate.js', 'create']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /Nom manquant/);
  assert.deepEqual(fs.readdirSync(path.join(serverDir, 'migrations')).sort(), before);
});

// Démarrage de production (core/payload.js) : une base créée en mode développement est
// refusée avant toute migration ; sinon les migrations de migrations/index.ts sont appliquées.
const PROBE = `
require('./core/next-env-patch');
const { applyProductionMigrations } = require('./core/payload');
const devRows = process.env.PROBE_DEV === 'true' ? [{ '?column?': 1 }] : [];
let migrated = null;
const payload = { db: {
  drizzle: {},
  execute: async ({ raw }) => ({ rows: raw.includes('to_regclass') ? [{ rel: 'payload_migrations' }] : devRows }),
  migrate: async (args) => { migrated = args; },
} };
applyProductionMigrations(payload).then(() => {
  console.log('MIGRATE ' + JSON.stringify(migrated.migrations.map((m) => m.name)));
  process.exit(0);
});
`;

test('applyProductionMigrations — base de développement refusée (exit 1, message explicite)', () => {
  const run = runTsx(['-e', PROBE], { PROBE_DEV: 'true' });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /Base créée en mode développement/);
  assert.match(run.stderr, /npm run migrate:baseline/);
  assert.doesNotMatch(run.stdout, /MIGRATE/);
});

test('applyProductionMigrations — base neuve ou migrée : migrations versionnées appliquées', () => {
  const run = runTsx(['-e', PROBE], { PROBE_DEV: 'false' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const names = JSON.parse(run.stdout.match(/MIGRATE (.*)/)[1]);
  assert.ok(names.length >= 1 && names.every((n) => /^\d{8}_\d{6}_\w+$/.test(n)), JSON.stringify(names));
});
