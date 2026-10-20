import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Arrêt propre d'un vrai process : gestionnaires de signaux (core/process-handlers), serveur
// HTTP suivi par core/shutdown, délai d'arrêt de 1,5 s. /lent répond en 600 ms, /tres-lent
// en 10 s.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posixOnly = { skip: process.platform === 'win32' ? 'signaux POSIX' : false };

function startServer() {
  const script = `
    require(${JSON.stringify(path.join(serverDir, 'core/process-handlers.js'))});
    const shutdown = require(${JSON.stringify(path.join(serverDir, 'core/shutdown.js'))});
    const http = require('http');
    const server = http.createServer((req, res) => {
      const delay = req.url === '/lent' ? 600 : req.url === '/tres-lent' ? 10000 : 0;
      setTimeout(() => res.end('ok'), delay);
    });
    shutdown.attachServer(server);
    server.listen(0, '127.0.0.1', () => console.log('PORT:' + server.address().port));
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: serverDir,
    env: { ...process.env, SHUTDOWN_GRACE_MS: '1500', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`serveur non démarré : ${output}`)); }, 15000);
    child.stdout.on('data', () => {
      const m = output.match(/PORT:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  return { child, ready, exited, output: () => output };
}

// Requête sans keep-alive : { status, body } ou { error: code }.
function get(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ error: err.code }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('SIGTERM pendant une requête : réponse complète, plus de nouvelle connexion, sortie 0', posixOnly, async () => {
  const srv = startServer();
  const port = await srv.ready;
  const pending = get(port, '/lent');
  await sleep(100);
  srv.child.kill('SIGTERM');
  await sleep(150);
  const refused = await get(port, '/');
  assert.equal(refused.error, 'ECONNREFUSED', 'port fermé dès le début de l’arrêt');
  const res = await pending;
  assert.deepEqual(res, { status: 200, body: 'ok' });
  const { code } = await srv.exited;
  assert.equal(code, 0);
  assert.match(srv.output(), /Arrêt propre terminé/);
  assert.equal((await get(port, '/')).error, 'ECONNREFUSED');
});

test('Ctrl+C puis SIGTERM relayé 50 ms après : signal ignoré, sortie 0', posixOnly, async () => {
  const srv = startServer();
  const port = await srv.ready;
  const pending = get(port, '/lent');
  await sleep(100);
  srv.child.kill('SIGINT');
  await sleep(50);
  srv.child.kill('SIGTERM');
  assert.equal((await pending).status, 200);
  const { code } = await srv.exited;
  assert.equal(code, 0);
  assert.match(srv.output(), /signal relayé ignoré/);
});

test('second SIGTERM après plus d’une seconde : arrêt forcé (code 1) sans attendre le délai', posixOnly, async () => {
  const srv = startServer();
  const port = await srv.ready;
  get(port, '/tres-lent');
  await sleep(100);
  const first = Date.now();
  srv.child.kill('SIGTERM');
  await sleep(1200);
  srv.child.kill('SIGTERM');
  const { code, at } = await srv.exited;
  assert.equal(code, 1);
  assert.ok(at - first < 2000, `sortie après ${at - first} ms`);
  assert.match(srv.output(), /arrêt forcé/);
});

test('requête trop longue : sortie 0 au bout du délai d’arrêt, « Délai dépassé » journalisé', posixOnly, async () => {
  const srv = startServer();
  const port = await srv.ready;
  get(port, '/tres-lent');
  await sleep(100);
  const first = Date.now();
  srv.child.kill('SIGTERM');
  const { code, at } = await srv.exited;
  assert.equal(code, 0);
  assert.ok(at - first >= 1400 && at - first < 4000, `sortie après ${at - first} ms`);
  assert.match(srv.output(), /Délai dépassé : 1 requête\(s\) en cours/);
});
