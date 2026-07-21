// Lanceur de la stack Meta-Builder : vérifie les prérequis (préflight) AVANT de
// démarrer, avec des messages d'erreur explicites et la commande corrective.
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
let envContent = '';
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

async function main() {
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

  // 1. Serveur Express + Payload (port 4000)
  const serverProcess = spawn('npx', ['tsx', 'index.js'], {
    cwd: SERVER_DIR,
    shell: true,
    stdio: 'inherit',
  });

  // 2. Orchestrateur React/Vite (port 5173)
  const clientProcess = spawn('npm', ['run', 'dev'], {
    cwd: ORCHESTRATOR_DIR,
    shell: true,
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ Le serveur (port 4000) s'est arrêté avec le code ${code}.`);
      console.error(`   Si l'erreur mentionne « vendor-chunks » ou MODULE_NOT_FOUND dans .next :`);
      console.error(`   supprimez le cache Next (rm -rf server/.next) puis relancez npm start.`);
      clientProcess.kill();
      process.exit(code);
    }
  });

  clientProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ L'orchestrateur (port 5173) s'est arrêté avec le code ${code}.`);
      serverProcess.kill();
      process.exit(code);
    }
  });

  console.log('→ Serveur API : http://localhost:4000');
  console.log('→ Interface  : http://localhost:5173  (comptes de démo dans le README)');

  process.on('SIGINT', () => {
    console.log('\n=== FERMETURE DE LA STACK ===');
    serverProcess.kill();
    clientProcess.kill();
    process.exit();
  });
}

main();
