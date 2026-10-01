// Lecture/écriture sûres des petits fichiers JSON de données (mode sans base, miroirs,
// compteurs). Un fichier ABSENT donne la valeur par défaut ; un fichier ILLISIBLE lève
// une erreur au lieu d'être pris pour vide — la prochaine écriture effacerait sinon
// tout son contenu. L'écriture passe par un fichier temporaire renommé (atomique).
const fs = require('fs');

function readJsonStrict(filePath, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Fichier JSON illisible (${filePath}) : ${err.message}`);
  }
}

function writeJsonAtomic(filePath, data, { pretty = true } = {}) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, filePath);
}

module.exports = { readJsonStrict, writeJsonAtomic };
