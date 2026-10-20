import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Inventaire des gardes de TOUTES les routes Express : chaque route montée doit figurer
// dans EXPECTED avec sa garde, et la garde est vérifiée par de vraies requêtes HTTP sur
// l'application complète (sans Next ni base). Une nouvelle route sans inventaire, ou une
// garde retirée, fait échouer ce test.

// Mise en place AVANT tout chargement d'auth ou d'express-app (lus à leur chargement)
process.env.DEV_NO_AUTH = 'false';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-guard-'));
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const config = require('../../core/config.js');
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
// Beacon de statistiques : fichier redirigé, pour vérifier qu'aucune écriture n'a lieu
const statsFileOf = (slug) => path.join(tmp, `stats_${slug}.json`);
config.getSiteStatsFile = statsFileOf;
require('../../sites-store.js').init({ getPayload: () => null, sitesFile });

// Session simulée : l'utilisateur est désigné par l'en-tête x-test-user. Le client ne
// possède que site-a.
const fakePayload = {
  async auth({ headers }) {
    const who = headers.get('x-test-user');
    if (who === 'admin') return { user: { id: 1, roles: ['admin'] } };
    if (who === 'client') return { user: { id: 2, roles: ['client'] } };
    return { user: null };
  },
  async findByID() {
    return { id: 2, sites: [{ slug: 'site-a' }] };
  },
};
const auth = require('../../auth.js');
auth.init(() => fakePayload);

// Journal 🔍 [HTTP] (et messages de démarrage) réduit au silence
mock.method(console, 'log', () => {});

const { createApp } = require('../../express-app.js');
const { isExpressRoute, isPublicRoute } = require('../../core/http.js');
const app = createApp({ nextHandler: (q, r) => r.status(404).json({ error: 'next' }) });

// Garde de chaque route, établie en lisant ses middlewares :
//  - public : aucune authentification (sites publiés, supervision) ;
//  - build : jeton x-build-token du pipeline (requireBuildToken) ;
//  - auth : session seule (requireAuth) ;
//  - site : session + accès au site visé (requireSiteAccess) ;
//  - admin : administrateur (requireAdmin).
// Une route router.all s'inventorie sous la clé « ALL <chemin> ».
const EXPECTED = {
  'GET /api/health': 'public',
  'GET /api/health/ready': 'public',
  'POST /api/contact/:slug': 'public',
  'POST /api/stats/hit/:slug': 'public',

  'GET /internal/site-pages': 'build',
  'GET /internal/site-posts': 'build',
  'GET /internal/site-media': 'build',

  'GET /api/sites': 'auth',
  'GET /api/config': 'auth',
  'POST /api/onboard': 'auth',
  'GET /api/build-status': 'auth',

  'GET /api/site-pages': 'site',
  'POST /api/site-pages': 'site',
  'GET /api/site-posts': 'site',
  'POST /api/site-posts': 'site',
  'DELETE /api/site-posts': 'site',
  'GET /api/theme': 'site',
  'POST /api/theme': 'site',
  'GET /api/sites/:slug/submissions': 'site',
  'PATCH /api/sites/:slug/submissions/:id': 'site',
  'DELETE /api/sites/:slug/submissions/:id': 'site',
  'GET /api/sites/:slug/stats': 'site',
  'POST /api/ai/assist': 'site',
  'POST /webhook/rebuild': 'site',
  'GET /api/sites/:slug/builds': 'site',
  'POST /api/sites/:slug/preview-build': 'site',
  'GET /api/sites/:slug/media': 'site',
  'PATCH /api/sites/:slug/media/:id': 'site',
  'DELETE /api/sites/:slug/media/:id': 'site',
  'GET /api/sites/:slug/legal': 'site',
  'PUT /api/sites/:slug/legal': 'site',

  'GET /api/sites/owners': 'admin',
  'POST /api/sites': 'admin',
  'PUT /api/sites/:slug': 'admin',
  'DELETE /api/sites/:slug': 'admin',
  'POST /api/sites/scan': 'admin',
  'POST /api/sites/import': 'admin',
  'GET /api/sites/:slug/files': 'admin',
  'GET /api/sites/:slug/files/view': 'admin',
  'GET /api/sites/:slug/releases': 'admin',
  'POST /api/sites/:slug/rollback': 'admin',
  'GET /api/sites/:slug/export': 'admin',
  'POST /api/sites/import-archive': 'admin',
  'POST /api/sites/:slug/duplicate': 'admin',
  'GET /api/admin/overview': 'admin',
  'GET /api/admin/backups': 'admin',
  'POST /api/admin/backups': 'admin',
  'GET /api/admin/backups/download': 'admin',
  'GET /api/admin/backups/sites': 'admin',
  'POST /api/admin/backups/restore': 'admin',
  'GET /api/admin/system': 'admin',
  'POST /api/admin/system/orphans/purge': 'admin',
  'GET /api/hosting/status': 'admin',
  'POST /api/hosting/test': 'admin',
  'GET /api/audit': 'admin',
  'POST /api/sites/:slug/custom-domain': 'admin',
  'DELETE /api/sites/:slug/custom-domain': 'admin',
  'POST /api/sites/:slug/custom-domain/verify': 'admin',
};
const KINDS = new Set(['public', 'build', 'auth', 'site', 'admin']);

// Routes déclarées par des routeurs Express. router.all (méthode « _all ») donne la clé
// « ALL <chemin> », à inventorier comme les autres, et elle est appelée en GET et en POST.
function inventoryRoutes(routers) {
  const unrouted = [];
  const routes = [];
  for (const router of routers) {
    for (const layer of router.stack) {
      if (!layer.route) {
        unrouted.push(layer.name || '(anonyme)');
        continue;
      }
      const { path: routePath, methods } = layer.route;
      for (const method of Object.keys(methods)) {
        if (method === '_all') {
          for (const called of ['GET', 'POST']) routes.push({ method: called, path: routePath, key: `ALL ${routePath}` });
        } else {
          routes.push({ method: method.toUpperCase(), path: routePath, key: `${method.toUpperCase()} ${routePath}` });
        }
      }
    }
  }
  return { unrouted, routes };
}

// Routes montées : couches des routeurs de l'application (Express 4 : _router, 5 : router)
const routerLayers = (app._router || app.router).stack.filter((l) => l.name === 'router');
const { unrouted, routes } = inventoryRoutes(routerLayers.map((l) => l.handle));
const WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

// Chemin concret d'une route : :slug → le site visé, tout autre paramètre → x1
const concretePath = (routePath, slug) => routePath.replace(/:(\w+)/g, (m, name) => (name === 'slug' ? slug : 'x1'));

let server;
let port;
before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Requête HTTP brute (chemin transmis tel quel : jamais normalisé comme le ferait fetch)
function request(method, urlPath, { user, headers = {}, body, accept = 'application/json' } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const allHeaders = { accept, ...headers };
  if (user) allHeaders['x-test-user'] = user;
  if (payload !== null) {
    allHeaders['content-type'] = 'application/json';
    allHeaders['content-length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, agent: false, headers: allHeaders }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), json, text });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// Requête vers une route, pour le site visé (paramètre, ?site= et corps JSON)
function callRoute(route, { slug = 'site-b', user, headers } = {}) {
  const urlPath = `${concretePath(route.path, slug)}?site=${slug}`;
  return request(route.method, urlPath, { user, headers, body: WITH_BODY.has(route.method) ? { site: slug } : undefined });
}

const routesOf = (...kinds) => routes.filter((r) => kinds.includes(EXPECTED[r.key]));
const describe = (r, res) => `${r.key}${r.key.startsWith('ALL ') ? ` (${r.method})` : ''} → ${res.status} ${res.json ? JSON.stringify(res.json) : res.text.slice(0, 80)}`;

test('Inventaire — router.all, router.route et méthodes simples produisent chacun leur clé', () => {
  const express = require('express');
  const { createRouter } = require('../../core/http.js');
  const handler = (req, res) => res.json({});
  const router = createRouter();
  router.all('/api/sites/:slug/fuite', handler);
  router.get('/api/a', handler);
  router.route('/api/b').get(handler).post(handler);
  const plain = express.Router();
  plain.all('/api/c', handler);
  const { unrouted: none, routes: found } = inventoryRoutes([router, plain]);
  assert.deepEqual(none, []);
  assert.deepEqual(found.map((r) => `${r.key} [${r.method}]`), [
    'ALL /api/sites/:slug/fuite [GET]',
    'ALL /api/sites/:slug/fuite [POST]',
    'GET /api/a [GET]',
    'GET /api/b [GET]',
    'POST /api/b [POST]',
    'ALL /api/c [GET]',
    'ALL /api/c [POST]',
  ]);
});

test('Inventaire — chaque couche des routeurs est une route (aucun router.use non inventorié)', () => {
  assert.ok(routerLayers.length > 0, 'aucun routeur monté');
  assert.deepEqual(unrouted.map((n) => `Middleware de routeur non inventorié (router.use) : ${n}`), []);
});

test('Inventaire — routes montées = EXPECTED, dans les deux sens', () => {
  const mounted = new Set(routes.map((r) => r.key));
  const problems = [];
  for (const key of mounted) {
    if (!(key in EXPECTED)) problems.push(`Route non inventoriée : ${key} — ajoutez-la à EXPECTED avec sa garde (public, build, auth, site, admin)`);
  }
  for (const key of Object.keys(EXPECTED)) {
    if (!mounted.has(key)) problems.push(`Route inventoriée introuvable : ${key}`);
    if (!KINDS.has(EXPECTED[key])) problems.push(`Garde inconnue pour ${key} : ${EXPECTED[key]}`);
  }
  assert.deepEqual(problems, []);
});

test('Routes protégées — anonyme : 401', async () => {
  const problems = [];
  for (const r of routesOf('build', 'auth', 'site', 'admin')) {
    const res = await callRoute(r);
    if (res.status !== 401) problems.push(describe(r, res));
  }
  assert.deepEqual(problems, []);
});

test('Routes de site — client sur un site qui n\'est pas le sien : 403', async () => {
  const problems = [];
  for (const r of routesOf('site')) {
    const res = await callRoute(r, { user: 'client', slug: 'site-b' });
    if (res.status !== 403) problems.push(describe(r, res));
  }
  assert.deepEqual(problems, []);
});

test('Routes d\'administration — client : 403, même pour son propre site', async () => {
  const problems = [];
  for (const r of routesOf('admin')) {
    for (const slug of ['site-b', 'site-a']) {
      const res = await callRoute(r, { user: 'client', slug });
      if (res.status !== 403) problems.push(`[${slug}] ${describe(r, res)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('Canal interne de build — session client ou jeton invalide : 401', async () => {
  const problems = [];
  for (const r of routesOf('build')) {
    const asClient = await callRoute(r, { user: 'client' });
    if (asClient.status !== 401) problems.push(`[client] ${describe(r, asClient)}`);
    const badToken = await callRoute(r, { headers: { 'x-build-token': 'invalide' } });
    if (badToken.status !== 401) problems.push(`[jeton invalide] ${describe(r, badToken)}`);
  }
  assert.deepEqual(problems, []);
});

test('Routes publiques — anonyme : jamais 401 ni 403 (contact sur site inconnu 404, beacon 204 sans écriture)', async () => {
  const expectedStatus = { 'POST /api/contact/:slug': 404, 'POST /api/stats/hit/:slug': 204, 'GET /api/health': 200 };
  const problems = [];
  for (const r of routesOf('public')) {
    const res = await callRoute(r);
    if (res.status === 401 || res.status === 403) problems.push(describe(r, res));
    else if (expectedStatus[r.key] !== undefined && res.status !== expectedStatus[r.key]) problems.push(`${describe(r, res)} (attendu ${expectedStatus[r.key]})`);
  }
  assert.deepEqual(problems, []);
  // Le beacon répond avant d'écrire : laisser son traitement se terminer
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(statsFileOf('site-b')), false, 'aucun compteur écrit pour un site inconnu');
});

test('Corps JSON — toute route POST/PUT/PATCH est couverte par EXPRESS_ROUTE_PREFIXES', () => {
  const problems = routes
    .filter((r) => WITH_BODY.has(r.method) && !isExpressRoute(concretePath(r.path, 'site-b')))
    .map((r) => `Corps JSON jamais lu : ajoutez le préfixe à EXPRESS_ROUTE_PREFIXES (core/http.js) — ${r.key}`);
  assert.deepEqual(problems, []);
});

test('CORS public — aucune route protégée n\'est déclarée publique (isPublicRoute)', () => {
  const problems = routesOf('build', 'auth', 'site', 'admin')
    .filter((r) => isPublicRoute(concretePath(r.path, 'site-b')))
    .map((r) => `Route protégée traitée comme publique (PUBLIC_ROUTE_PREFIXES) : ${r.key}`);
  assert.deepEqual(problems, []);
});

test('Brouillons /draft — anonyme 401 (JSON ou page), client hors site 403, slug encodé 400', async () => {
  const anonJson = await request('GET', '/draft/site-b/');
  assert.equal(anonJson.status, 401);
  assert.match(anonJson.type, /application\/json/);
  assert.ok(anonJson.json && anonJson.json.error);

  const anonHtml = await request('GET', '/draft/site-b/', { accept: 'text/html' });
  assert.equal(anonHtml.status, 401);
  assert.match(anonHtml.type, /text\/html/);

  const client = await request('GET', '/draft/site-b/', { user: 'client' });
  assert.equal(client.status, 403);

  const traversal = await request('GET', '/draft/%2e%2e/', { user: 'client' });
  assert.equal(traversal.status, 400);
});

test('Optimiseur d\'images de Next — /_next/image fermé côté Express (404, jamais transmis à Next)', async () => {
  const res = await request('GET', '/_next/image?url=%2Ffavicon.svg&w=64&q=75');
  assert.equal(res.status, 404);
  assert.ok(res.json && res.json.error && res.json.error !== 'next', `réponse de Next au lieu de la route Express : ${res.text}`);
});
