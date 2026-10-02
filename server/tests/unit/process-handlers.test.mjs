import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Arrêt du serveur pendant un build : le build (groupe de processus détaché) ne doit
// jamais survivre au serveur, qu'il s'arrête sur un signal ou sur process.exit.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posixOnly = { skip: process.platform === 'win32' ? 'groupes de processus POSIX' : false };

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    throw err;
  }
};

// Faux serveur : charge les gestionnaires de processus, lance un « build » (shell → node
// → petit-enfant) via runCommand et publie le PID du petit-enfant. `then` décide de la fin.
function startFakeServer(then) {
  const build = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log('GC:'+c.pid);setInterval(()=>{},1000)";
  const script = `
    require(${JSON.stringify(path.join(serverDir, 'core/process-handlers.js'))});
    const { runCommand } = require(${JSON.stringify(path.join(serverDir, 'lib/run-command.js'))});
    const node = JSON.stringify(process.execPath);
    runCommand(node + ' -e ' + JSON.stringify(${JSON.stringify(build)}), {
      onOutput: (t) => { const m = t.match(/GC:(\\d+)/); if (m) { console.log('GC:' + m[1]); ${then} } },
    });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', script], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`pas de PID : ${out}`)); }, 15000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/GC:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, grandChildPid: Number(m[1]) }); }
    });
    child.stderr.on('data', (d) => { out += d; });
  });
}

async function waitDead(pid) {
  for (let i = 0; i < 250 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  return !isAlive(pid);
}

test('arrêt du serveur sur SIGTERM : l’arbre du build en cours est tué', posixOnly, async () => {
  const { child, grandChildPid } = await startFakeServer('');
  assert.ok(isAlive(grandChildPid));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 0, 'sortie propre sur SIGTERM');
  assert.ok(await waitDead(grandChildPid), 'aucun processus du build ne survit');
});

test('arrêt du serveur sur SIGINT (Ctrl+C) : l’arbre du build en cours est tué', posixOnly, async () => {
  const { child, grandChildPid } = await startFakeServer('');
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.kill('SIGINT');
  await exited;
  assert.ok(await waitDead(grandChildPid), 'aucun processus du build ne survit');
});

test('sortie brutale du serveur (process.exit après une exception) : l’arbre du build est tué', posixOnly, async () => {
  const { child, grandChildPid } = await startFakeServer('setTimeout(() => process.exit(1), 50);');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(await waitDead(grandChildPid), 'aucun processus du build ne survit');
});
