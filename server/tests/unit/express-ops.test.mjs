import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Application Express réelle (sans Next ni base) : 404 des sites sous /preview et
// fermeture des connexions pendant l'arrêt. Racine /preview redirigée AVANT le chargement.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'express-ops-'));
const config = require('../../core/config.js');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
fs.mkdirSync(path.join(config.PUBLIC_HTML_DIR, 'site', 'en'), { recursive: true });
fs.writeFileSync(path.join(config.PUBLIC_HTML_DIR, 'site', 'index.html'), '<h1>accueil</h1>');
fs.writeFileSync(path.join(config.PUBLIC_HTML_DIR, 'site', '404.html'), '<h1>404 du site</h1>');
fs.writeFileSync(path.join(config.PUBLIC_HTML_DIR, 'site', 'en', '404.html'), '<h1>404 in English</h1>');
fs.writeFileSync(path.join(tmp, '404.html'), '<h1>hors racine</h1>');

const { createApp } = require('../../express-app.js');
const shutdown = require('../../core/shutdown.js');

let server;
let port;
const agent = new http.Agent({ keepAlive: true });

before(async () => {
  const app = createApp({ nextHandler: (req, res) => { res.statusCode = 418; res.end('next'); } });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => {
  agent.destroy();
  server.close();
});

function request(urlPath, { method = 'GET', accept } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent, headers: accept ? { Accept: accept } : {} }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('/preview — fichier absent : page 404 du site, ou de sa langue', async () => {
  const page = await request('/preview/site/page-absente', { accept: 'text/html' });
  assert.equal(page.status, 404);
  assert.equal(page.body, '<h1>404 du site</h1>');
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.headers['x-robots-tag'], /noindex/);
  const en = await request('/preview/site/en/absente/encore');
  assert.deepEqual([en.status, en.body], [404, '<h1>404 in English</h1>']);
  const existing = await request('/preview/site/index.html');
  assert.deepEqual([existing.status, existing.body], [200, '<h1>accueil</h1>']);
});

test('/preview — site sans 404 : page lisible ou JSON, jamais Next', async () => {
  const html = await request('/preview/inconnu/x', { accept: 'text/html' });
  assert.equal(html.status, 404);
  assert.match(html.body, /Page introuvable/);
  const json = await request('/preview/inconnu/x', { accept: 'application/json' });
  assert.deepEqual([json.status, JSON.parse(json.body)], [404, { error: 'Ressource introuvable.' }]);
  const posted = await request('/preview/site/x', { method: 'POST' });
  assert.equal(posted.status, 404);
  assert.equal(posted.body, '<h1>404 du site</h1>');
});

test('/preview — traversée : jamais un fichier hors de la racine', async () => {
  for (const p of ['/preview/..%2F404.html', '/preview/..%2F..%2Fx', '/preview/site/..%2F..%2F404.html']) {
    const r = await request(p, { accept: 'text/html' });
    assert.notEqual(r.status, 200, p);
    assert.ok(!r.body.includes('hors racine'), p);
  }
});

test('arrêt en cours : chaque réponse ferme sa connexion', async () => {
  const before = await request('/preview/site/index.html');
  assert.notEqual(before.headers.connection, 'close');
  shutdown.beginDrain();
  const during = await request('/preview/site/index.html');
  assert.equal(during.headers.connection, 'close');
  const ready = await request('/api/health/ready');
  assert.deepEqual([ready.status, JSON.parse(ready.body)], [503, { status: 'stopping', checks: {} }]);
});
