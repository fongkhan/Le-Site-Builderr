// Version de l'application affichée dans le panneau Système : première entrée datée du
// CHANGELOG (« ## [x.y.z] »), sinon version du package.json racine, sinon « inconnue ».
const fs = require('fs');
const path = require('path');

function parseChangelogVersion(text) {
  const m = /^##\s*\[(\d+\.\d+\.\d+)\]/m.exec(String(text || ''));
  return m ? m[1] : null;
}

const cache = new Map();

// Lue une fois par dossier de projet (fichiers relus seulement au redémarrage).
function readAppVersion(projectDir) {
  if (cache.has(projectDir)) return cache.get(projectDir);
  let version;
  try {
    version = parseChangelogVersion(fs.readFileSync(path.join(projectDir, 'CHANGELOG.md'), 'utf-8'));
  } catch {
    version = null;
  }
  if (!version) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
      if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) version = pkg.version.trim();
    } catch {
      version = null;
    }
  }
  const result = version || 'inconnue';
  cache.set(projectDir, result);
  return result;
}

module.exports = { parseChangelogVersion, readAppVersion };
