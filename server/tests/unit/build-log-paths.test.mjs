import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Journal de build (lu par le client propriétaire du site) : aucun chemin absolu du
// serveur, ni dans les lignes du pipeline ni dans la sortie brute recopiée.
// Isolation : journal, verrou, dist et sites dans un dossier temporaire ; la commande de
// build et l'application du thème sont remplacées AVANT le chargement de build.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-paths-'));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.DIST_DIR = path.join(tmp, 'dist');
const { PROJECT_DIR, PUBLIC_HTML_DIR } = config;
const HOME = os.homedir();

const sitesFile = path.join(tmp, 'sites.json');
// documentRoot = racine partagée elle-même : le déploiement échoue (garde de confinement)
// avec un message qui cite des chemins absolus.
fs.writeFileSync(sitesFile, JSON.stringify([
  { slug: 'demo-chemins', name: 'Démo', domain: 'demo.example', documentRoot: PUBLIC_HTML_DIR, repositoryPath: path.join(PROJECT_DIR, 'repositories', 'demo-chemins'), status: 'draft' },
]));
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

require('../../services/content.js').applySiteThemeCss = async () => {};
const runCommandModule = require('../../lib/run-command.js');
let commandCwd = null;
runCommandModule.runCommand = (command, { cwd, onOutput }) => {
  commandCwd = cwd;
  // Chemin du projet coupé entre deux paquets, puis dossier personnel (log npm)
  const cut = Math.floor(PROJECT_DIR.length / 2);
  onOutput(`[build] error in ${PROJECT_DIR.slice(0, cut)}`);
  onOutput(`${PROJECT_DIR.slice(cut)}/client-template/src/pages/index.astro\n`);
  onOutput(`npm log: ${HOME}/.npm/_logs/debug.log\n`);
  onOutput(`[build] directory: ${PROJECT_DIR}/client-template/dist/\n`);
  return { promise: Promise.resolve({ code: 0, signal: null, timedOut: false, tail: '' }), kill() {} };
};

const build = require('../../services/build.js');

async function waitForEnd() {
  for (let i = 0; i < 200; i++) {
    if (!build.getBuildStatus().inProgress && build.getBuildStatus().status === 'error') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('build jamais terminé');
}

test('journal de build — aucun chemin absolu du serveur (lignes du pipeline et sortie brute)', async () => {
  assert.ok(build.tryReserve());
  build.launch('demo-chemins', 'test');
  await waitForEnd();
  const log = fs.readFileSync(config.LOGS_FILE, 'utf-8');

  assert.equal(commandCwd, config.ASTRO_PROJECT_DIR); // la commande tourne toujours au bon endroit
  assert.ok(!log.includes(PROJECT_DIR), `chemin du projet présent dans le journal :\n${log}`);
  assert.ok(!log.includes(`${HOME}/`), `dossier personnel présent dans le journal :\n${log}`);
  assert.ok(!log.includes(PUBLIC_HTML_DIR), log);

  // Repères relatifs conservés : le journal reste utile
  assert.match(log, /Commande exécutée : .*\(dans client-template\)/);
  assert.match(log, /error in \.\/client-template\/src\/pages\/index\.astro/);
  assert.match(log, /directory: \.\/client-template\/dist\//);
  assert.match(log, /npm log: ~\/\.npm\/_logs\/debug\.log/);
  assert.match(log, /Déploiement atomique vers simulated_public_html\.\.\./);
  assert.match(log, /ERREUR DE DÉPLOIEMENT/);
});
