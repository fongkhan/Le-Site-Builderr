import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCommand } = require('../../lib/run-command.js');

const node = JSON.stringify(process.execPath);
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    throw err;
  }
};

const posixOnly = { skip: process.platform === 'win32' ? 'groupes de processus POSIX' : false };

test('runCommand — délai dépassé : tout l’arbre de processus est tué', posixOnly, async () => {
  // Le shell lance node, qui lance un petit-enfant (NON détaché) puis attend.
  const script = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)";
  let grandChildPid = null;
  const { promise } = runCommand(`${node} -e ${JSON.stringify(script)}`, {
    timeoutMs: 300,
    onOutput: (text) => {
      const m = text.match(/(\d+)/);
      if (m && !grandChildPid) grandChildPid = Number(m[1]);
    },
  });
  const result = await promise;
  assert.equal(result.timedOut, true);
  assert.ok(grandChildPid, 'PID du petit-enfant reçu');
  // Le petit-enfant est tué avec le groupe ; orphelin, il reste zombie jusqu'à ce que
  // le processus init le réclame (quelques centaines de ms dans un conteneur).
  for (let i = 0; i < 250 && isAlive(grandChildPid); i++) await new Promise((r) => setTimeout(r, 20));
  assert.throws(() => process.kill(grandChildPid, 0), { code: 'ESRCH' });
});

test('runCommand — la sortie est transmise au fil de l’eau', async () => {
  const script = "console.log('ligne1');setTimeout(()=>console.log('ligne2'),300)";
  const received = [];
  let closed = false;
  const { promise } = runCommand(`${node} -e ${JSON.stringify(script)}`, {
    onOutput: (text) => received.push({ text, closed }),
  });
  const result = await promise;
  closed = true;
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  const first = received.find((r) => r.text.includes('ligne1'));
  assert.ok(first && !first.closed, 'ligne1 reçue avant la fin du processus');
  assert.ok(received.findIndex((r) => r.text.includes('ligne1')) < received.findIndex((r) => r.text.includes('ligne2')));
});

test('runCommand — fenêtre glissante : tail borné et terminé par la fin réelle de la sortie', async () => {
  // ~1 Mo de sortie, puis un marqueur de fin
  const script = "process.stdout.write('x'.repeat(1024*1024));process.stdout.write('FIN-REELLE')";
  let total = 0;
  const { promise } = runCommand(`${node} -e ${JSON.stringify(script)}`, {
    tailBytes: 4096,
    onOutput: (text) => { total += text.length; },
  });
  const { tail, code } = await promise;
  assert.equal(code, 0);
  assert.ok(total >= 1024 * 1024, 'toute la sortie passe par onOutput');
  assert.ok(Buffer.byteLength(tail) <= 4096);
  assert.ok(tail.endsWith('FIN-REELLE'));
});

test('runCommand — code de sortie non nul transmis', async () => {
  const { promise } = runCommand(`${node} -e "process.exit(3)"`, {});
  const { code, timedOut } = await promise;
  assert.equal(code, 3);
  assert.equal(timedOut, false);
});
