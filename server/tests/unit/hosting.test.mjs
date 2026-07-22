import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHostingDriver, createCpanelDriver } = require('../../lib/hosting.js');

// ---------------------------------------------------------------------------
// Mock cPanel : reproduit les réponses UAPI/API2 et enregistre chaque appel
// (méthode, chemin, query, en-tête Authorization) pour les assertions.
// ---------------------------------------------------------------------------
const calls = [];
let subDomains = ['deja-la.exemple.fr'];
let server;
let mockPort;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization };
    calls.push(entry);

    const send = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };

    if (entry.auth !== 'cpanel demo-user:demo-token') {
      res.statusCode = 403;
      return send({ status: 0, errors: ['Access denied'] });
    }
    if (url.pathname === '/execute/DomainInfo/list_domains') {
      return send({ status: 1, data: { main_domain: 'exemple.fr', sub_domains: subDomains } });
    }
    if (url.pathname === '/execute/SubDomain/addsubdomain') {
      subDomains.push(`${entry.query.domain}.${entry.query.rootdomain}`);
      return send({ status: 1, data: null });
    }
    if (url.pathname === '/execute/Fileman/upload_files') {
      return send({ status: 1, data: { succeeded: 1 } });
    }
    if (url.pathname === '/json-api/cpanel') {
      return send({ cpanelresult: { event: { result: 1 }, data: [] } });
    }
    if (url.pathname === '/execute/SSL/installed_hosts') {
      return send({ status: 1, data: [{ fqdns: ['exemple.fr', 'securise.exemple.fr'], certificate: { domains: ['*.wildcard.fr'] } }] });
    }
    res.statusCode = 404;
    send({ status: 0, errors: ['unknown endpoint'] });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockPort = server.address().port;
});

after(() => server.close());

function makeDriver() {
  return createCpanelDriver({
    host: '127.0.0.1',
    user: 'demo-user',
    token: 'demo-token',
    rootDomain: 'exemple.fr',
    port: mockPort,
    baseUrl: `http://127.0.0.1:${mockPort}`, // le mock parle HTTP simple
  });
}

test('fabrique — simulation par défaut, cpanel exige ses variables', () => {
  assert.equal(createHostingDriver({}).name, 'simulation');
  assert.equal(createHostingDriver({ HOSTING_DRIVER: 'simulation' }).name, 'simulation');
  assert.throws(() => createHostingDriver({ HOSTING_DRIVER: 'cpanel' }), /CPANEL_HOST/);
  assert.throws(() => createHostingDriver({ HOSTING_DRIVER: 'ftp' }), /inconnu/);
});

test('simulation — domaine fictif historique conservé, SSL actif, publish local', async () => {
  const sim = createHostingDriver({});
  assert.deepEqual(await sim.ensureSubdomain('mon-site'), { domain: 'mon-site.o2switch.site', created: false });
  assert.equal(await sim.getSslStatus('x'), 'active');
  assert.deepEqual(await sim.publish(), { published: 'local' });
  assert.equal((await sim.testConnection()).ok, true);
});

test('cpanel — testConnection envoie le bon en-tête et lit le domaine principal', async () => {
  calls.length = 0;
  const r = await makeDriver().testConnection();
  assert.equal(r.ok, true);
  assert.match(r.message, /exemple\.fr/);
  assert.equal(calls[0].auth, 'cpanel demo-user:demo-token');
});

test('cpanel — ensureSubdomain est idempotent (existant → aucun addsubdomain)', async () => {
  const driver = makeDriver();
  calls.length = 0;
  subDomains = ['deja-la.exemple.fr'];

  const r1 = await driver.ensureSubdomain('deja-la');
  assert.deepEqual(r1, { domain: 'deja-la.exemple.fr', created: false });
  assert.equal(calls.filter((c) => c.path.includes('addsubdomain')).length, 0);

  const r2 = await driver.ensureSubdomain('nouveau');
  assert.deepEqual(r2, { domain: 'nouveau.exemple.fr', created: true });
  const add = calls.find((c) => c.path.includes('addsubdomain'));
  assert.equal(add.query.domain, 'nouveau');
  assert.equal(add.query.rootdomain, 'exemple.fr');
  assert.equal(add.query.dir, 'public_html/nouveau');
});

test('cpanel — publish enchaîne upload → extract → unlink avec des chemins dérivés du slug', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>ok</h1>');
  calls.length = 0;

  const r = await makeDriver().publish('mon-site', dist);
  assert.equal(r.published, 'cpanel');
  assert.equal(r.remoteDir, 'public_html/mon-site');

  const upload = calls.find((c) => c.path.includes('upload_files'));
  assert.equal(upload.method, 'POST');
  const fileops = calls.filter((c) => c.path === '/json-api/cpanel');
  assert.equal(fileops[0].query.op, 'extract');
  assert.equal(fileops[0].query.destfiles, 'public_html/mon-site');
  assert.match(fileops[0].query.sourcefiles, /^public_html\/deploy-mon-site-\d+\.zip$/);
  assert.equal(fileops[1].query.op, 'unlink');

  fs.rmSync(dist, { recursive: true, force: true });
});

test('cpanel — statut SSL : couvert (exact ou wildcard) = active, sinon pending', async () => {
  const driver = makeDriver();
  assert.equal(await driver.getSslStatus('securise.exemple.fr'), 'active');
  assert.equal(await driver.getSslStatus('app.wildcard.fr'), 'active');
  assert.equal(await driver.getSslStatus('inconnu.exemple.fr'), 'pending');
});

test('cpanel — les erreurs ne contiennent jamais le jeton', async () => {
  const bad = createCpanelDriver({
    host: '127.0.0.1', user: 'demo-user', token: 'mauvais-jeton-secret',
    rootDomain: 'exemple.fr', port: mockPort, baseUrl: `http://127.0.0.1:${mockPort}`,
  });
  await assert.rejects(
    () => bad.testConnection(),
    (e) => {
      assert.ok(!e.message.includes('mauvais-jeton-secret'), 'le jeton ne doit pas fuiter dans les erreurs');
      return true;
    }
  );
});
