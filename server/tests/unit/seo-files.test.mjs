import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Fichiers SEO écrits dans le dist à la publication (services/build.js writeSeoFiles) :
// sitemap.xml et robots.txt toujours, .htaccess uniquement sur l'hébergement distant
// (cPanel, site à la racine de son domaine). Chemins redirigés AVANT de charger build.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-files-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.ASTRO_PROJECT_DIR = path.join(tmp, 'template');
config.DIST_DIR = path.join(config.ASTRO_PROJECT_DIR, 'dist');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
const hosting = require('../../core/hosting.js');
const build = require('../../services/build.js');

const site = { slug: 'demo', name: 'Demo', domain: 'demo.example', documentRoot: path.join(config.PUBLIC_HTML_DIR, 'demo') };
// Une page CMS d'adresse « 404 » est réservée à la page d'erreur du template
const pages = { docs: [{ title: 'Accueil', slug: 'home', locale: 'fr' }, { title: 'Erreur', slug: '404', locale: 'fr' }] };
const posts = { docs: [] };
const dist = (name) => path.join(config.DIST_DIR, name);

beforeEach(() => {
  fs.rmSync(config.DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIST_DIR, { recursive: true });
});

test('writeSeoFiles — simulation (aperçu /preview) : sitemap et robots, jamais de .htaccess', () => {
  assert.equal(hosting.isRemote, false);
  build.writeSeoFiles(site, pages, posts);
  assert.ok(fs.existsSync(dist('sitemap.xml')));
  assert.ok(fs.existsSync(dist('robots.txt')));
  assert.equal(fs.existsSync(dist('.htaccess')), false, '.htaccess écrit hors hébergement distant');
});

test('writeSeoFiles — hébergement distant : .htaccess avec la page 404, sitemap sans /404/', () => {
  hosting.isRemote = true;
  try {
    build.writeSeoFiles(site, pages, posts);
  } finally {
    hosting.isRemote = false;
  }
  assert.match(fs.readFileSync(dist('.htaccess'), 'utf-8'), /^ErrorDocument 404 \/404\.html$/m);
  const sitemap = fs.readFileSync(dist('sitemap.xml'), 'utf-8');
  assert.match(sitemap, /<loc>https:\/\/demo\.example\/<\/loc>/);
  assert.doesNotMatch(sitemap, /\/404\//);
});
