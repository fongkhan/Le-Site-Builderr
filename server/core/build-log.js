// Journal du pipeline de build (fichier unique, affiché dans l'orchestrateur).
const fs = require('fs');
const { LOGS_FILE } = require('./config');

const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

// Ajoute une ligne horodatée. gap=true insère une ligne vide avant (blocs d'erreur/résultat).
function appendBuildLog(message, { gap = false } = {}) {
  fs.appendFileSync(LOGS_FILE, `${gap ? '\n' : ''}${timestamp()} ${message}\n`);
}

// Ajoute un texte brut, sans horodatage.
function appendRawBuildLog(text) {
  fs.appendFileSync(LOGS_FILE, text);
}

// Remplace tout le journal (début d'un nouveau build ou boot du serveur).
function resetBuildLog(text) {
  fs.writeFileSync(LOGS_FILE, text, 'utf-8');
}

function readBuildLog() {
  return fs.existsSync(LOGS_FILE) ? fs.readFileSync(LOGS_FILE, 'utf-8') : '';
}

module.exports = { timestamp, appendBuildLog, appendRawBuildLog, resetBuildLog, readBuildLog };
