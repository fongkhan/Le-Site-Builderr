import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Commande de lancement du serveur : tsx chargé DANS le process (node --import tsx), jamais
// via la CLI tsx, qui relaie les signaux et tue l'enfant (SIGKILL) s'il n'en confirme pas la
// réception sous 30 ms. Un serveur occupé (copie synchrone d'un déploiement) perdrait alors
// son arrêt propre : publication perdue, build orphelin.
const require = createRequire(import.meta.url);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rootDir = path.dirname(serverDir);
const { SERVER_NODE_ARGS } = require('../../../start.js');
const posixOnly = { skip: process.platform === 'win32' ? 'signaux POSIX' : false };

// Serveur réduit en TypeScript (chargé par tsx) : gestionnaires de signaux et arrêt propre
// du vrai serveur ; /copie bloque la boucle d'événements 500 ms (fs.cpSync d'un déploiement).
function writeScript(dir) {
  const file = path.join(dir, 'serveur.cts');
  fs.writeFileSync(file, `
    require(${JSON.stringify(path.join(serverDir, 'core/process-handlers.js'))});
    const shutdown = require(${JSON.stringify(path.join(serverDir, 'core/shutdown.js'))});
    const http = require('http');
    const busy = (ms: number): void => { const end = Date.now() + ms; while (Date.now() < end) { /* copie synchrone */ } };
    const server = http.createServer((req: any, res: any) => {
      if (req.url === '/copie') {
        process.stdout.write('COPIE\\n');
        busy(500);
      }
      res.end('ok');
    });
    shutdown.attachServer(server);
    server.listen(0, '127.0.0.1', () => console.log('PORT:' + server.address().port));
  `);
  return file;
}

test('SIGTERM pendant une copie synchrone : arrêt propre, réponse complète (commande du lanceur)', posixOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lancement-'));
  try {
    const script = writeScript(dir);
    const args = SERVER_NODE_ARGS.map((a) => (a === 'index.js' ? script : a));
    assert.ok(args.includes(script), 'la commande lance index.js');
    const child = spawn(process.execPath, args, {
      cwd: serverDir,
      env: { ...process.env, SHUTDOWN_GRACE_MS: '3000', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const waitFor = (re) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.stdout.off('data', onData); reject(new Error(`attente de ${re} : ${output}`)); }, 30000);
      function onData() {
        const m = output.match(re);
        if (!m) return;
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(m);
      }
      child.stdout.on('data', onData);
      onData();
    });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const port = Number((await waitFor(/PORT:(\d+)/))[1]);

    const response = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/copie', agent: false }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', (err) => resolve({ error: err.code }));
    });
    await waitFor(/COPIE/);
    // Signal adressé au process lancé par la commande (docker stop, systemd, PM2…)
    child.kill('SIGTERM');

    assert.deepEqual(await response, { status: 200, body: 'ok' });
    assert.deepEqual(await exited, { code: 0, signal: null }, output);
    assert.match(output, /Arrêt propre terminé/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('commandes documentées et outillées : node --import tsx, jamais la CLI tsx', () => {
  assert.deepEqual(SERVER_NODE_ARGS, ['--import', 'tsx', 'index.js']);
  const scripts = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.start, 'node --import tsx index.js');
  assert.equal(scripts['start:prod'], 'node --import tsx index.js --production');

  const cliLaunch = /tsx\/dist\/cli\.mjs|(?<!--import )\btsx index\.js/;
  const files = {
    Dockerfile: /CMD \["node", "--import", "tsx", "index\.js", "--production"\]/,
    '.github/workflows/ci.yml': /node --import tsx index\.js/,
    'README.md': /ExecStart=\/usr\/bin\/node --import tsx index\.js --production/,
  };
  for (const [name, expected] of Object.entries(files)) {
    const text = fs.readFileSync(path.join(rootDir, name), 'utf8');
    assert.match(text, expected, name);
    assert.doesNotMatch(text, cliLaunch, `${name} : serveur lancé par la CLI tsx`);
  }
  assert.match(fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8'), /--node-args="--import tsx"/, 'commande PM2');
});
