const { spawn } = require('child_process');
const path = require('path');

console.log('=== DÉMARRAGE DE LA STACK META-BUILDER ===');

// 1. Démarrer le serveur Express (Port 4000)
const serverProcess = spawn('node', ['index.js'], {
  cwd: path.join(__dirname, 'server'),
  shell: true,
  stdio: 'inherit'
});

console.log('✔ Serveur Express lancé sur http://localhost:4000');

// 2. Démarrer le client Orchestrateur React (Vite - Port 5173)
const clientProcess = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'orchestrator'),
  shell: true,
  stdio: 'inherit'
});

console.log('✔ Orchestrateur React lancé sur http://localhost:5173');

// Gérer la fermeture propre des processus
process.on('SIGINT', () => {
  console.log('\n=== FERMETURE DE LA STACK ===');
  serverProcess.kill();
  clientProcess.kill();
  process.exit();
});
