import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Isolation (même en-tête que build.test.mjs) : journal, verrou, fichier de sites et
// racines de publication dans un dossier temporaire, remplacés AVANT de charger build.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-env-legal-'));
const config = require('../../core/config.js');
config.LOGS_FILE = path.join(tmp, 'build-logs.txt');
config.LOCK_FILE = path.join(tmp, 'build.lock');
config.ASTRO_PROJECT_DIR = path.join(tmp, 'template');
config.DIST_DIR = path.join(config.ASTRO_PROJECT_DIR, 'dist');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.RELEASES_DIR = path.join(tmp, 'releases');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const build = require('../../services/build.js');

test('buildEnvFor — PUBLIC_LEGAL_JSON transmis au build, brouillon compris', () => {
  const previous = process.env.LEGAL_HOST_NAME;
  process.env.LEGAL_HOST_NAME = 'Hébergeur du serveur';
  try {
    const site = {
      slug: 's',
      name: 'Site',
      domain: 's.example',
      documentRoot: path.join(tmp, 'public_html', 's'),
      legal: { companyName: 'Société', email: 'contact@s.example', hostName: '' },
      analyticsProvider: 'matomo',
      analyticsId: '3',
      analyticsHost: 'stats.s.example',
    };
    const env = build.buildEnvFor(site, 's', { draft: true });
    const data = JSON.parse(env.PUBLIC_LEGAL_JSON);
    assert.equal(data.companyName, 'Société');
    assert.equal(data.email, 'contact@s.example');
    assert.equal(data.hostName, 'Hébergeur du serveur'); // vide : valeur par défaut du serveur
    assert.equal(data.retentionMonths, 12);
    assert.equal(data.visitStats, true);
    // La politique décrit le site publié : mesure d'audience annoncée même en brouillon…
    assert.equal(data.analyticsProvider, 'matomo');
    assert.equal(data.analyticsHost, 'stats.s.example');
    // … qui, lui, ne la charge jamais
    assert.equal(env.PUBLIC_ANALYTICS_PROVIDER, '');
    assert.equal(env.PUBLIC_IS_DRAFT, '1');

    const published = JSON.parse(build.buildEnvFor(site, 's').PUBLIC_LEGAL_JSON);
    assert.equal(published.analyticsProvider, 'matomo');
  } finally {
    if (previous === undefined) delete process.env.LEGAL_HOST_NAME;
    else process.env.LEGAL_HOST_NAME = previous;
  }
});

test('buildEnvFor — site inconnu : informations légales vides, jamais d’exception', () => {
  const data = JSON.parse(build.buildEnvFor(null, 'orphelin').PUBLIC_LEGAL_JSON);
  assert.equal(data.companyName, '');
  assert.equal(data.analyticsProvider, '');
  assert.equal(data.retentionMonths, 12);
});
