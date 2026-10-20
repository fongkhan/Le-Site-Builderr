import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Démarrage de production : NODE_ENV posé par « --production » avant tout chargement,
// interface de l'orchestrateur servie par défaut, arrêt explicite sans build Next.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readConfig(env) {
  const full = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete full[k];
  const run = spawnSync(process.execPath, ['-e', "const c = require('./core/config'); console.log(JSON.stringify({ prod: c.IS_PRODUCTION, serve: c.SERVE_ORCHESTRATOR, dist: c.ORCHESTRATOR_DIST_DIR }))"], { cwd: serverDir, env: full, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('config — interface servie en production sauf SERVE_ORCHESTRATOR=false, jamais en développement', () => {
  const prod = readConfig({ NODE_ENV: 'production', SERVE_ORCHESTRATOR: undefined });
  assert.deepEqual([prod.prod, prod.serve], [true, true]);
  assert.equal(prod.dist, path.join(path.dirname(serverDir), 'orchestrator', 'dist'));
  assert.equal(readConfig({ NODE_ENV: 'production', SERVE_ORCHESTRATOR: 'false' }).serve, false);
  assert.equal(readConfig({ NODE_ENV: 'production', SERVE_ORCHESTRATOR: 'true' }).serve, true);
  assert.equal(readConfig({ NODE_ENV: undefined, SERVE_ORCHESTRATOR: 'true' }).serve, false);
});

test('index.js --production sans build Next : arrêt explicite (exit 1) avant tout démarrage', (t) => {
  if (fs.existsSync(path.join(serverDir, '.next', 'BUILD_ID'))) {
    t.skip('build Next présent dans server/.next (contrôle exécuté en CI, sans build)');
    return;
  }
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.DATABASE_URI;
  const run = spawnSync(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'index.js', '--production'], { cwd: serverDir, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /Build de production absent \(server\/\.next\) : lancez « npm run build »/);
  assert.doesNotMatch(run.stdout, /Serveur Meta-Builder démarré/);
});
