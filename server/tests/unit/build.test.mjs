import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Isolation : journal, verrou et fichier de sites dans un dossier temporaire. Les modules
// lisent ces chemins à leur chargement : on les remplace AVANT de charger build.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const build = require('../../services/build.js');
const readLog = () => fs.readFileSync(config.LOGS_FILE, 'utf-8');

before(() => fs.writeFileSync(config.LOGS_FILE, ''));

test('sanitizedEnv — secrets et connexions à la base filtrés, variables utiles conservées', () => {
  const env = {
    PAYLOAD_SECRET: 's',
    SMTP_PASS: 's',
    OPENAI_API_KEY: 's',
    CPANEL_API_TOKEN: 's',
    DATABASE_URI: 'postgres://u:p@h/db',
    DATABASE_URL: 'postgres://u:p@h/db',
    POSTGRES_URL: 'postgres://u:p@h/db',
    POSTGRES_PASSWORD: 's',
    PGPASSWORD: 's',
    PGHOST: 'h',
    DB_URL: 'postgres://u:p@h/db',
    npm_config__authToken: 's',
    PATH: '/usr/bin',
    HOME: '/home/x',
    NODE_ENV: 'production',
    PUBLIC_API_URL: 'https://api.example',
  };
  const out = build.sanitizedEnv(env);
  for (const key of ['PAYLOAD_SECRET', 'SMTP_PASS', 'OPENAI_API_KEY', 'CPANEL_API_TOKEN', 'DATABASE_URI', 'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PASSWORD', 'PGPASSWORD', 'PGHOST', 'DB_URL', 'npm_config__authToken']) {
    assert.ok(!(key in out), `${key} ne doit pas être transmis au build`);
  }
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.HOME, '/home/x');
  assert.equal(out.NODE_ENV, 'production');
  assert.equal(out.PUBLIC_API_URL, 'https://api.example');
});

test('tryReserve — réservation exclusive, puis release', () => {
  assert.equal(build.isBusy(), false);
  assert.equal(build.tryReserve(), true);
  assert.equal(build.tryReserve(), false);
  assert.equal(build.isBusy(), true);
  build.release();
  assert.equal(build.isBusy(), false);
  assert.equal(build.tryReserve(), true);
  build.release();
});

test('tryReserve — un verrou physique (build.lock) bloque la réservation', () => {
  fs.writeFileSync(config.LOCK_FILE, 'locked');
  try {
    assert.equal(build.tryReserve(), false);
  } finally {
    fs.unlinkSync(config.LOCK_FILE);
  }
  assert.equal(build.tryReserve(), true);
  build.release();
});

test('enqueue — position comptée à partir de 1, file dédupliquée ; drainQueue annule un site disparu', async () => {
  assert.equal(build.tryReserve(), true); // un build « en cours » : la file attend
  assert.equal(build.enqueue('site-a', 'a@example.com'), 1);
  assert.equal(build.enqueue('site-b'), 2);
  assert.equal(build.enqueue('site-a'), 1); // déjà en file : même position
  assert.deepEqual(build.getQueue(), ['site-a', 'site-b']);
  assert.match(readLog(), /"site-a" ajouté \(position 1\)/);

  // Fin du build en cours : la file est drainée. Les deux sites n'existent pas (sites.json
  // vide) : chacun est annulé et le créneau libéré pour le suivant.
  build.release();
  for (let i = 0; i < 100 && (build.getQueue().length > 0 || build.isBusy()); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepEqual(build.getQueue(), []);
  assert.equal(build.isBusy(), false);
  const log = readLog();
  assert.match(log, /ANNULÉ : le site "site-a" n'existe plus\./);
  assert.match(log, /ANNULÉ : le site "site-b" n'existe plus\./);
  assert.equal(build.tryReserve(), true);
  build.release();
});

test('basePathFor — brouillon sous /draft, aperçu simulé sous /preview', () => {
  assert.equal(build.basePathFor(null, 'mon-site', { draft: true }), '/draft/mon-site');
  assert.equal(build.basePathFor({ documentRoot: '' }, 'mon-site'), '/preview/mon-site');
  const docRoot = path.join(config.PUBLIC_HTML_DIR, 'client', 'site');
  assert.equal(build.basePathFor({ documentRoot: docRoot }, 'mon-site'), '/preview/client/site');
});

test('isValidBuildToken — refuse les types et longueurs invalides', () => {
  for (const value of [undefined, null, 42, {}, [], '', 'abc', 'x'.repeat(48 + 1), 'x'.repeat(47)]) {
    assert.equal(build.isValidBuildToken(value), false, JSON.stringify(value));
  }
  // Bonne longueur (48 caractères hexadécimaux) mais mauvaise valeur
  assert.equal(build.isValidBuildToken('0'.repeat(48)), false);
});

test('abortCurrent — sans build en cours : rien à arrêter', () => {
  assert.equal(build.abortCurrent(), false);
});
