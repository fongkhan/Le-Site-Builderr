// Taille d'un dossier (octets, nombre de fichiers) pour le panneau Système. Parcours
// itératif (pas de récursion profonde), liens symboliques jamais suivis (ni boucle ni sortie
// du dossier), nombre d'entrées borné : au-delà, le résultat est marqué « partiel ».
const fs = require('fs');
const path = require('path');

async function measureDir(dir, { maxEntries = 200000 } = {}) {
  const out = { bytes: 0, files: 0, truncated: false };
  try {
    if (!(await fs.promises.lstat(dir)).isDirectory()) return out;
  } catch {
    return out; // dossier absent
  }
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue; // dossier disparu ou illisible pendant le parcours
    }
    for (const entry of entries) {
      if (seen >= maxEntries) {
        out.truncated = true;
        return out;
      }
      seen++;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          out.bytes += (await fs.promises.lstat(full)).size;
          out.files++;
        } catch {
          // fichier supprimé pendant le parcours
        }
      }
    }
  }
  return out;
}

module.exports = { measureDir };
