// Exécution d'une commande shell bornée dans le temps, en tuant TOUT l'arbre de
// processus au délai maximal (un `exec` avec timeout ne tue que le shell : npm et astro
// continueraient d'écrire dans le dist partagé pendant le build suivant).
// Sortie transmise au fil de l'eau (onOutput) ; seule une fenêtre glissante (tail) est
// gardée en mémoire pour le message d'erreur et l'historique.
const { spawn, spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

const IS_WINDOWS = process.platform === 'win32';
const KILL_GRACE_MS = 5000;

// Début d'un tampon tronqué recalé sur une frontière UTF-8 (sauter les octets de
// continuation 10xxxxxx) : jamais de caractère coupé en tête.
function utf8Start(buf) {
  let i = 0;
  while (i < buf.length && i < 4 && (buf[i] & 0xc0) === 0x80) i++;
  return buf.subarray(i);
}

// Tue le groupe de processus (POSIX : process détaché = chef de groupe, pid négatif) ou
// l'arbre (Windows : taskkill /T). Silencieux si tout est déjà terminé.
function killTree(pid, signal) {
  if (!pid) return;
  try {
    if (IS_WINDOWS) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, signal);
    }
  } catch { /* groupe déjà terminé */ }
}

// Renvoie { promise, kill }. La promesse se résout sur 'close' (tous les descripteurs
// fermés) avec { code, signal, timedOut, tail } ; elle ne rejette que si le shell ne
// peut pas être lancé.
function runCommand(command, { cwd, env, timeoutMs = 0, onOutput, tailBytes = 65536 } = {}) {
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: !IS_WINDOWS,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let tail = Buffer.alloc(0);
  let timedOut = false;
  let killed = false;
  let timer = null;
  let graceTimer = null;

  // Un décodeur par flux : un caractère multi-octets coupé entre deux paquets n'est
  // jamais transmis à moitié.
  const listen = (stream) => {
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk) => {
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > tailBytes) tail = tail.subarray(tail.length - tailBytes);
      const text = decoder.write(chunk);
      if (onOutput && text) {
        try { onOutput(text); } catch { /* un journal en échec n'arrête pas la commande */ }
      }
    });
  };
  listen(child.stdout);
  listen(child.stderr);

  // SIGTERM au groupe, puis SIGKILL si quelque chose survit au délai de grâce. Dernier
  // recours (descendant sorti du groupe qui garde nos tubes ouverts) : on ferme les tubes
  // de notre côté, ce qui déclenche 'close' sans attendre indéfiniment.
  const kill = () => {
    if (killed) return;
    killed = true;
    killTree(child.pid, 'SIGTERM');
    graceTimer = setTimeout(() => {
      killTree(child.pid, 'SIGKILL');
      graceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, KILL_GRACE_MS);
    }, KILL_GRACE_MS);
  };

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
  }

  const promise = new Promise((resolve, reject) => {
    child.on('error', (err) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      // Après un arrêt forcé, aucun membre du groupe ne doit survivre au shell (un
      // descendant qui ignorerait SIGTERM sans tenir nos tubes).
      if (killed && !IS_WINDOWS) killTree(child.pid, 'SIGKILL');
      resolve({ code, signal, timedOut, tail: utf8Start(tail).toString('utf-8') });
    });
  });

  return { promise, kill, pid: child.pid };
}

module.exports = { runCommand, killTree };
