import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Isolation : journal, verrou et fichier de sites dans un dossier temporaire. Les modules
// lisent ces chemins à leur chargement : on les remplace AVANT de charger build.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-logo-'));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.ASTRO_PROJECT_DIR = path.join(tmp, 'template');
config.DIST_DIR = path.join(config.ASTRO_PROJECT_DIR, 'dist');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.UPLOADS_DIR = path.join(tmp, 'uploads');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

// Thème appliqué et compilation Astro simulés (remplacés AVANT le chargement de build.js) ;
// médiathèque simulée (siteOwnsMedia est relue à chaque build).
const content = require('../../services/content.js');
let appliedTheme;
content.applySiteThemeCss = async () => appliedTheme;
const owned = new Set();
content.siteOwnsMedia = async (_slug, name) => owned.has(name);
let lastEnv = null;
require('../../lib/run-command.js').runCommand = (_command, { env }) => {
  lastEnv = env;
  fs.mkdirSync(config.DIST_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.DIST_DIR, 'index.html'), '<h1>ok</h1>');
  return { promise: Promise.resolve({ code: 0, signal: null, timedOut: false, tail: '' }), kill() {} };
};

const build = require('../../services/build.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const site = { slug: 'logo-demo', name: 'Logo Démo', domain: 'logo.example', documentRoot: path.join(config.PUBLIC_HTML_DIR, 'logo-demo'), status: 'draft' };
const logo = { name: 'logo (1).png', apiUrl: '/api/media/file/logo%20%281%29.png', staticPath: '/media/logo%20%281%29.png' };
const BASE_THEME = {
  colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' },
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  radius: '12px',
};
fs.writeFileSync(sitesFile, JSON.stringify([site]));
fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });

const readLog = () => fs.readFileSync(config.LOGS_FILE, 'utf-8');
const waitIdle = async () => {
  for (let i = 0; i < 500 && build.isBusy(); i++) await new Promise((r) => setTimeout(r, 10));
};
async function runBuild() {
  lastEnv = null;
  assert.equal(build.tryReserve(), true);
  build.launch('logo-demo', 'test');
  await waitIdle();
  assert.equal(build.getBuildStatus().status, 'success', readLog());
}

test('buildEnvFor — PUBLIC_SITE_LOGO = chemin publié du logo vérifié (brouillon compris)', () => {
  assert.equal(build.buildEnvFor(site, 'logo-demo', { logo }).PUBLIC_SITE_LOGO, '/media/logo%20%281%29.png');
  assert.equal(build.buildEnvFor(site, 'logo-demo', { draft: true, logo }).PUBLIC_SITE_LOGO, '/media/logo%20%281%29.png');
});

test("buildEnvFor — sans logo : vide, jamais hérité de l'environnement du serveur", () => {
  const previous = process.env.PUBLIC_SITE_LOGO;
  process.env.PUBLIC_SITE_LOGO = '/media/injecte.png';
  try {
    assert.equal(build.buildEnvFor(site, 'logo-demo').PUBLIC_SITE_LOGO, '');
    assert.equal(build.buildEnvFor(site, 'logo-demo', { draft: true }).PUBLIC_SITE_LOGO, '');
    assert.equal(build.buildEnvFor(site, 'logo-demo', { logo: null }).PUBLIC_SITE_LOGO, '');
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_SITE_LOGO;
    else process.env.PUBLIC_SITE_LOGO = previous;
  }
});

test('build — avertissements de lisibilité dans le journal ; logo d’un autre site ignoré', async () => {
  appliedTheme = { ...BASE_THEME, colors: { ...BASE_THEME.colors, background: '#ffffff', text: '#999999' }, logo: '/api/media/file/autre-site.png' };
  fs.writeFileSync(path.join(config.UPLOADS_DIR, 'autre-site.png'), 'png');
  await runBuild();
  const log = readLog();
  assert.match(log, /Avertissement d'accessibilité : Texte peu lisible sur le fond : contraste 2,8:1/);
  assert.match(log, /Logo ignoré : image absente de la médiathèque du site\./);
  assert.equal(lastEnv.PUBLIC_SITE_LOGO, '');
  assert.equal(fs.existsSync(path.join(site.documentRoot, 'media', 'autre-site.png')), false);
});

test('build — logo de la médiathèque du site : publié dans /media et annoncé au template', async () => {
  appliedTheme = { ...BASE_THEME, logo: logo.apiUrl };
  owned.add(logo.name);
  fs.writeFileSync(path.join(config.UPLOADS_DIR, logo.name), 'contenu-du-logo');
  await runBuild();
  assert.equal(lastEnv.PUBLIC_SITE_LOGO, logo.staticPath);
  assert.equal(fs.readFileSync(path.join(site.documentRoot, 'media', logo.name), 'utf-8'), 'contenu-du-logo');
  assert.doesNotMatch(readLog(), /Avertissement d'accessibilité/);
  assert.doesNotMatch(readLog(), /Logo ignoré/);

  // Brouillon : même logo, copié dans le dossier du brouillon
  lastEnv = null;
  assert.equal(build.tryReserve(), true);
  assert.equal(await build.runDraftPreview('logo-demo'), '/draft/logo-demo/index.html');
  assert.equal(lastEnv.PUBLIC_SITE_LOGO, logo.staticPath);
  assert.equal(lastEnv.PUBLIC_IS_DRAFT, '1');
  assert.ok(fs.existsSync(path.join(config.DRAFTS_DIR, 'logo-demo', 'media', logo.name)));
});

test('build — fichier du logo absent du disque : logo ignoré, build réussi', async () => {
  appliedTheme = { ...BASE_THEME, logo: '/api/media/file/disparu.png' };
  owned.add('disparu.png');
  await runBuild();
  assert.equal(lastEnv.PUBLIC_SITE_LOGO, '');
  assert.match(readLog(), /Logo ignoré/);
});
