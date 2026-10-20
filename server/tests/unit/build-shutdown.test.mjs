import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Arrêt du serveur pendant un build, puis reprise de la file au redémarrage. Même isolation
// que build.test.mjs (journal, verrou, template factice et racines de publication dans un
// dossier temporaire, sites en JSON) ; la file est sauvegardée dans ce dossier.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-shutdown-'));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.ASTRO_PROJECT_DIR = path.join(tmp, 'template');
config.DIST_DIR = path.join(config.ASTRO_PROJECT_DIR, 'dist');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.RELEASES_DIR = path.join(tmp, 'releases');
const sitesFile = path.join(tmp, 'sites.json');
const queueFile = path.join(tmp, 'build-queue.json');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const buildPath = require.resolve('../../services/build.js');
const readLog = () => fs.readFileSync(config.LOGS_FILE, 'utf-8');
const readSites = () => JSON.parse(fs.readFileSync(sitesFile, 'utf-8'));
const readQueueFile = () => JSON.parse(fs.readFileSync(queueFile, 'utf-8')).queue.map((e) => e.slug);

// Template factice : le « build » attend FAKE_BUILD_DELAY_MS puis écrit dist/index.html.
fs.mkdirSync(path.join(config.ASTRO_PROJECT_DIR, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(config.ASTRO_PROJECT_DIR, 'node_modules', '.package-lock.json'), '{}');
fs.writeFileSync(path.join(config.ASTRO_PROJECT_DIR, 'package.json'), JSON.stringify({ name: 'faux-template', private: true, scripts: { build: 'node build.cjs' } }));
fs.writeFileSync(path.join(config.ASTRO_PROJECT_DIR, 'build.cjs'), `
  const fs = require('fs');
  setTimeout(() => {
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/index.html', '<h1>ok</h1>');
  }, Number(process.env.FAKE_BUILD_DELAY_MS || 0));
`);

const site = (slug) => ({ slug, name: slug, documentRoot: path.join(config.PUBLIC_HTML_DIR, slug), status: 'active' });

async function waitFor(predicate, label, timeoutMs = 20000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`délai dépassé : ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('beginShutdown — build interrompu remis en tête de file, ni échec ni build suivant', async () => {
  fs.writeFileSync(sitesFile, JSON.stringify([site('long'), site('suivant')]));
  fs.writeFileSync(config.LOGS_FILE, '');
  process.env.FAKE_BUILD_DELAY_MS = '30000';
  const build = require(buildPath);

  assert.equal(await build.restoreQueue({ file: queueFile }), 0, 'file vide au démarrage');
  assert.equal(build.tryReserve('long'), true);
  build.launch('long', 'admin@exemple.fr');
  build.enqueue('suivant', 'client@exemple.fr');
  // La commande est lancée dès que « Commande exécutée » est écrite (même tick)
  await waitFor(() => readLog().includes('Commande exécutée'), 'lancement du build');

  const started = Date.now();
  assert.equal(build.beginShutdown(), true, 'build en cours interrompu');
  await waitFor(() => !build.isBusy(), 'fin du build interrompu');
  assert.ok(Date.now() - started < 10000, 'arbre du build tué sans attendre les 30 s');

  assert.deepEqual(build.getQueue(), ['long', 'suivant'], 'site interrompu en tête, file conservée');
  assert.deepEqual(readQueueFile(), ['long', 'suivant'], 'file réécrite sur disque');
  assert.notEqual(readSites().find((s) => s.slug === 'long').status, 'error', 'aucun échec enregistré');
  assert.match(readLog(), /INTERROMPU : Build interrompu par l'arrêt du serveur/);
  assert.equal(build.getBuildStatus().buildingSite, null);
  assert.equal(build.isBusy(), false);
  assert.equal(build.tryReserve('suivant'), false, 'aucune réservation pendant l’arrêt');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(build.isBusy(), false, 'aucun build suivant lancé pendant l’arrêt');
  assert.equal(fs.existsSync(path.join(config.PUBLIC_HTML_DIR, 'long')), false, 'rien de déployé');
  // Un lancement réservé juste avant l'arrêt repart en file au lieu de compiler
  build.launch('suivant', 'client@exemple.fr');
  assert.deepEqual(build.getQueue(), ['suivant', 'long']);
  assert.equal(build.isBusy(), false);
});

test('restoreQueue — nouvelle instance : seul le site existant est relancé et déployé', async () => {
  delete require.cache[buildPath];
  process.env.FAKE_BUILD_DELAY_MS = '0';
  fs.writeFileSync(sitesFile, JSON.stringify([site('existant')]));
  fs.writeFileSync(config.LOGS_FILE, '');
  fs.writeFileSync(queueFile, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    queue: [
      { slug: 'existant', triggeredBy: 'admin@exemple.fr' },
      { slug: 'site-disparu', triggeredBy: 'client@exemple.fr' },
      { slug: '../x', triggeredBy: 'pirate' },
      { slug: 'existant', triggeredBy: 'doublon@exemple.fr' },
    ],
  }));
  const build = require(buildPath);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let restored;
  // Créneau occupé pendant la reprise : le journal est lu avant que le build ne le remplace
  assert.equal(build.tryReserve(), true);
  try {
    restored = await build.restoreQueue({ file: queueFile });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(restored, 1);
  assert.deepEqual(build.getQueue(), ['existant']);
  assert.deepEqual(readQueueFile(), ['existant'], 'site supprimé retiré du fichier');
  assert.ok(warnings.some((w) => w.includes('site-disparu') && w.includes('site supprimé')), warnings.join('\n'));
  const log = readLog();
  assert.match(log, /REPRISE : 1 publication\(s\) en attente relancée\(s\) après le redémarrage\./);
  assert.ok(!log.includes('site-disparu') && !log.includes('../x') && !log.includes('existant'), `aucun slug dans le journal : ${log}`);

  build.release();
  await waitFor(() => build.getQueue().length === 0 && !build.isBusy(), 'build relancé terminé');
  assert.equal(build.getBuildStatus().status, 'success', readLog());
  assert.ok(fs.existsSync(path.join(config.PUBLIC_HTML_DIR, 'existant', 'index.html')), 'site existant déployé');
  assert.ok(!readLog().includes('site-disparu'));
  assert.deepEqual(readQueueFile(), []);
});
