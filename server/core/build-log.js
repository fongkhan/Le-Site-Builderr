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

// Fin du journal (sondé toutes les 2 s par chaque orchestrateur ouvert pendant un build) :
// les ~200 derniers Ko suffisent à suivre la progression et à lire une erreur. Lecture par
// position : le fichier (jusqu'à ~5 Mo pendant un gros build) n'est jamais relu en entier.
const MAX_LOG_BYTES = 200 * 1024;
const TRUNCATED_PREFIX = '[…]\n';
function readBuildLog(file = LOGS_FILE) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const { size } = fs.fstatSync(fd);
    const truncated = size > MAX_LOG_BYTES;
    // Préfixe compris dans le budget : la réponse ne dépasse jamais MAX_LOG_BYTES.
    const length = truncated ? MAX_LOG_BYTES - Buffer.byteLength(TRUNCATED_PREFIX) : size;
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, size - length);
    if (!truncated) return buf.subarray(0, read).toString('utf-8');
    // Recaler le début sur une frontière UTF-8 : sauter les octets de continuation
    // (10xxxxxx) d'un caractère coupé par la position de lecture.
    let start = 0;
    while (start < read && start < 4 && (buf[start] & 0xc0) === 0x80) start++;
    return TRUNCATED_PREFIX + buf.subarray(start, read).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { timestamp, appendBuildLog, appendRawBuildLog, resetBuildLog, readBuildLog };
