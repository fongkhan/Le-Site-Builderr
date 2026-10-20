// Lanceur de la stack Meta-Builder : vérifie les prérequis (préflight) AVANT de
// démarrer, avec des messages d'erreur explicites et la commande corrective, puis lance le
// serveur et l'orchestrateur et, à l'arrêt, attend qu'ils se soient arrêtés proprement.
// N'utilise que des modules Node natifs : il doit fonctionner même sans node_modules.

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');
const ORCHESTRATOR_DIR = path.join(__dirname, 'orchestrator');
const ENV_FILE = path.join(SERVER_DIR, '.env');

const errors = [];
const warnings = [];
let envContent = '';

// Préflights 1 à 3 (exécutés par main() : le module reste importable sans effet de bord).
function preflight() {
  // --- Préflight 1 : version de Node (Vite 7 et Astro exigent ≥ 22.12) ---
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    errors.push(
      `Node.js ${process.versions.node} est trop ancien (requis : ≥ 22.12).\n` +
      `   → Installez Node 22 LTS : https://nodejs.org (ou « nvm install 22 »).\n` +
      `   Symptôme typique sinon : « crypto.hash is not a function » au démarrage de Vite.`
    );
  }

  // --- Préflight 2 : server/.env présent ---
  if (!fs.existsSync(ENV_FILE)) {
    errors.push(
      `Le fichier server/.env est absent : le serveur démarrerait sans base de données\n` +
      `   et toutes les routes protégées (dont le login) répondraient 503.\n` +
      `   → Copiez le modèle puis renseignez-le :\n` +
      `     cp server/.env.example server/.env   (Windows : copy server\\.env.example server\\.env)`
    );
  } else {
    envContent = fs.readFileSync(ENV_FILE, 'utf-8');
  }

  // --- Préflight 3 : dépendances installées (la racine n'a aucune dépendance : non vérifiée) ---
  for (const [label, dir] of [['server', SERVER_DIR], ['orchestrator', ORCHESTRATOR_DIR]]) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      errors.push(
        `Dépendances non installées dans « ${label} » (${path.relative(process.cwd(), dir) || '.'}).\n` +
        `   → cd ${path.relative(process.cwd(), dir) || '.'} && npm install`
      );
    }
  }
}

// --- Préflight 4 : PostgreSQL joignable (hôte/port extraits de DATABASE_URI) ---
function parseDbHostPort(env) {
  const m = env.match(/^\s*DATABASE_URI\s*=\s*(.+)\s*$/m);
  if (!m) return null;
  try {
    const url = new URL(m[1].trim().replace(/^["']|["']$/g, ''));
    return { host: url.hostname || '127.0.0.1', port: Number(url.port) || 5432 };
  } catch {
    return null;
  }
}

function checkTcp({ host, port }, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

// Délai d'arrêt propre du serveur (SHUTDOWN_GRACE_MS) : variable d'environnement, sinon
// premier entier après « SHUTDOWN_GRACE_MS= » en début de ligne du .env, sinon 15 s.
function readShutdownGraceMs(env, processEnv = process.env) {
  const fromProcess = Number.parseInt(processEnv.SHUTDOWN_GRACE_MS ?? '', 10);
  if (fromProcess > 0) return fromProcess;
  const m = String(env || '').match(/^\s*SHUTDOWN_GRACE_MS\s*=\s*["']?(\d+)/m);
  const fromFile = m ? Number(m[1]) : 0;
  return fromFile > 0 ? fromFile : 15000;
}

// Arrêt de la stack : SIGTERM à chaque enfant encore vivant, puis attente de leur sortie
// (le serveur termine ses requêtes et remet en file un build interrompu). Au-delà de
// timeoutMs, les survivants sont tués (SIGKILL) et le lanceur sort en erreur. Un nouvel
// appel (second Ctrl+C) relaie SIGTERM aux enfants encore vivants, sans sortir.
// Sous Windows, kill() reste immédiat (pas de signal POSIX).
function createStopper({ children, timeoutMs, log = console, exit = (code) => process.exit(code) }) {
  let stopping = false;
  let finished = false;
  let timer = null;
  const alive = () => children.filter(({ proc }) => proc.exitCode === null && proc.signalCode === null);
  const terminate = () => {
    for (const { proc } of alive()) {
      try { proc.kill('SIGTERM'); } catch { /* déjà sorti */ }
    }
  };
  const finish = (code) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    timer = null;
    exit(code);
  };
  const onChildExit = () => {
    if (stopping && alive().length === 0) finish(0);
  };

  function stop() {
    if (stopping) {
      terminate();
      return;
    }
    stopping = true;
    log.log('\n=== FERMETURE DE LA STACK (arrêt propre en cours) ===');
    for (const { proc } of children) proc.once('exit', onChildExit);
    terminate();
    if (alive().length === 0) return finish(0);
    timer = setTimeout(() => {
      for (const { name, proc } of alive()) {
        log.error(`⛔ ${name} ne s'est pas arrêté à temps : arrêt forcé.`);
        try { proc.kill('SIGKILL'); } catch { /* déjà sorti */ }
      }
      finish(1);
    }, timeoutMs);
  }

  return {
    stop,
    get stopping() { return stopping; },
  };
}

async function main() {
  preflight();
  const db = envContent ? parseDbHostPort(envContent) : null;
  if (envContent && !db) {
    warnings.push(
      `DATABASE_URI absent ou illisible dans server/.env : le serveur démarrera en mode\n` +
      `   simulation SANS authentification possible (login → 503). Renseignez DATABASE_URI.`
    );
  }
  if (db && !(await checkTcp(db))) {
    errors.push(
      `PostgreSQL est injoignable sur ${db.host}:${db.port} (d'après DATABASE_URI).\n` +
      `   → Le plus simple : docker compose up -d   (base prête à l'emploi, voir docker-compose.yml)\n` +
      `   → Sinon démarrez votre PostgreSQL local et vérifiez que la base « metabuilder_db » existe\n` +
      `     (voir la section Dépannage du README).`
    );
  }

  for (const w of warnings) console.warn(`\n⚠️  ${w}`);
  if (errors.length > 0) {
    console.error('\n❌ Impossible de démarrer — corrigez d\'abord ceci :\n');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}\n`));
    process.exit(1);
  }

  console.log('=== DÉMARRAGE DE LA STACK META-BUILDER ===');
  console.log('✔ Préflight OK (Node, .env, dépendances, PostgreSQL joignable)');
  console.log('⏳ Premier démarrage : l\'initialisation Payload (push du schéma + seed) peut prendre ~1 minute.\n');

  // Enfants lancés SANS shell (node directement) : un signal atteint le vrai process, qui
  // ne survit jamais au lanceur (sinon : process orphelin et EADDRINUSE au redémarrage).
  let tsxCli;
  let viteBin;
  try {
    tsxCli = require.resolve('tsx/cli', { paths: [SERVER_DIR] });
    viteBin = path.join(path.dirname(require.resolve('vite/package.json', { paths: [ORCHESTRATOR_DIR] })), 'bin', 'vite.js');
  } catch {
    console.error('\n❌ Dépendances incomplètes (tsx ou vite introuvable).\n   → cd server && npm install, puis cd orchestrator && npm install');
    process.exit(1);
  }

  // 1. Serveur Express + Payload (port 4000), via la CLI de tsx
  const serverProcess = spawn(process.execPath, [tsxCli, 'index.js'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
  });

  // 2. Orchestrateur React/Vite (port 5173), via le binaire de vite
  const clientProcess = spawn(process.execPath, [viteBin], {
    cwd: ORCHESTRATOR_DIR,
    stdio: 'inherit',
  });

  const stopper = createStopper({
    children: [{ name: 'Le serveur', proc: serverProcess }, { name: "L'orchestrateur", proc: clientProcess }],
    // Marge au-delà du délai d'arrêt propre du serveur
    timeoutMs: readShutdownGraceMs(envContent) + 5000,
  });

  serverProcess.on('exit', (code) => {
    if (stopper.stopping) return;
    if (code !== 0 && code !== null) {
      console.error(`\n❌ Le serveur (port 4000) s'est arrêté avec le code ${code}.`);
      console.error(`   Si l'erreur mentionne « vendor-chunks » ou MODULE_NOT_FOUND dans .next :`);
      console.error(`   supprimez le cache Next (rm -rf server/.next) puis relancez npm start.`);
      clientProcess.kill();
      process.exit(code);
    }
  });

  clientProcess.on('exit', (code) => {
    if (stopper.stopping) return;
    if (code !== 0 && code !== null) {
      console.error(`\n❌ L'orchestrateur (port 5173) s'est arrêté avec le code ${code}.`);
      serverProcess.kill();
      process.exit(code);
    }
  });

  console.log('→ Serveur API : http://localhost:4000');
  console.log('→ Interface  : http://localhost:5173  (comptes de démo dans le README)');

  // Ctrl+C (SIGINT) ou arrêt demandé (SIGTERM : kill, docker stop…) : chaque enfant reçoit
  // SIGTERM et le lanceur attend leur sortie. Le serveur termine ses requêtes et interrompt
  // lui-même le build en cours (lancé dans son propre groupe de processus, que le signal du
  // terminal n'atteint pas) ; il ignore le SIGTERM relayé juste après un Ctrl+C.
  process.on('SIGINT', (s) => stopper.stop(s));
  process.on('SIGTERM', (s) => stopper.stop(s));
}

if (require.main === module) main();

module.exports = { createStopper, readShutdownGraceMs };
