import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Application Express réelle (sans Next ni base) en configuration de production :
// interface de l'orchestrateur servie depuis un dist factice, optimiseur d'images de Next
// fermé. La configuration est lue à la création de l'application (redirigée ici).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'express-prod-'));
const config = require('../../core/config.js');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
const dist = path.join(tmp, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
const INDEX = '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script>';
fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

const { createApp } = require('../../express-app.js');
const nextHandler = (req, res) => { res.statusCode = 418; res.end('next'); };

const servers = [];
async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
}

function request(port, urlPath, { accept } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, agent: false, headers: accept ? { Accept: accept } : {} }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

let port; // interface servie
let logs = [];
before(async () => {
  config.SERVE_ORCHESTRATOR = true;
  config.ORCHESTRATOR_DIST_DIR = dist;
  const log = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  try {
    port = await listen(createApp({ nextHandler }));
  } finally {
    console.log = log;
  }
});

after(() => {
  for (const s of servers) s.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const assertSpaPage = (r, label) => {
  assert.equal(r.status, 200, label);
  assert.equal(r.body, INDEX, label);
  assert.match(r.headers['content-type'], /text\/html/, label);
  assert.equal(r.headers['cache-control'], 'no-cache', label);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', label);
  assert.equal(r.headers['content-security-policy'], "frame-ancestors 'self'", label);
};

test('production — interface servie et journalisée au démarrage', () => {
  assert.ok(logs.some((l) => l.includes('✔ [Orchestrateur] Interface servie depuis orchestrator/dist')), logs.join('\n'));
});

test('production — pages de l\'interface : index.html, jamais en cache, non indexé, non encadrable', async () => {
  for (const p of ['/', '/login', '/sites/boulangerie/design', '/admin-panel', '/reset-password?token=x']) {
    assertSpaPage(await request(port, p, { accept: 'text/html' }), p);
  }
  // Accès direct au fichier : mêmes en-têtes
  assertSpaPage(await request(port, '/index.html'), '/index.html');
});

test('production — fichiers versionnés de /assets en cache long, autres fichiers servis', async () => {
  const js = await request(port, '/assets/index-abc123.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable');
  const icon = await request(port, '/favicon.svg');
  assert.equal(icon.status, 200);
  assert.doesNotMatch(icon.headers['cache-control'] || '', /immutable/);
});

test('production — admin, API, Next, fichiers absents et requêtes non HTML : jamais l\'interface', async () => {
  for (const p of ['/admin', '/admin/login', '/api/inconnue', '/_next/static/chunk.js', '/server/.env', '/inconnu.php', '/assets/absent.js']) {
    const r = await request(port, p, { accept: 'text/html' });
    assert.equal(r.status, 418, p);
    assert.equal(r.body, 'next', p);
  }
  const json = await request(port, '/sites/x', { accept: 'application/json' });
  assert.equal(json.status, 418);
});

test("production — optimiseur d'images de Next : 404 JSON, jamais Next", async () => {
  const r = await request(port, '/_next/image?url=%2Ffavicon.svg&w=64&q=75', { accept: 'image/avif,image/webp,*/*' });
  assert.equal(r.status, 404);
  assert.deepEqual(JSON.parse(r.body), { error: 'Ressource introuvable.' });
});

test('production — dist absent : avertissement, pages laissées à Next', async () => {
  config.ORCHESTRATOR_DIST_DIR = path.join(tmp, 'absent');
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  let p;
  try {
    p = await listen(createApp({ nextHandler }));
  } finally {
    console.warn = warn;
    config.ORCHESTRATOR_DIST_DIR = dist;
  }
  assert.ok(warnings.some((w) => w.includes('orchestrator/dist absent') && w.includes('SERVE_ORCHESTRATOR=false')), warnings.join('\n'));
  assert.equal((await request(p, '/', { accept: 'text/html' })).status, 418);
});

test('SERVE_ORCHESTRATOR désactivé (développement, ou interface hébergée ailleurs) : rien de servi', async () => {
  config.SERVE_ORCHESTRATOR = false;
  try {
    const p = await listen(createApp({ nextHandler }));
    assert.equal((await request(p, '/', { accept: 'text/html' })).status, 418);
    assert.equal((await request(p, '/assets/index-abc123.js')).status, 418);
    assert.equal((await request(p, '/_next/image?url=%2Fx&w=8&q=1')).status, 404);
  } finally {
    config.SERVE_ORCHESTRATOR = true;
  }
});
