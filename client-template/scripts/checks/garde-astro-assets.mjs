// Garde de l'exception d'audit astro/sharp (security/audit-allowlist.json) : elle n'est
// justifiée que tant que le template n'utilise pas l'optimisation d'images d'Astro
// (astro:assets, getImage), seule à charger sharp et à exposer les failles exceptées.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const FORBIDDEN = ['astro:assets', 'getImage('];

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.isFile()) yield full;
  }
}

// Fichiers de src/ (chemins relatifs) qui utilisent l'optimisation d'images d'Astro
export function filesUsingAstroAssets(srcDir = SRC_DIR) {
  const hits = [];
  for (const file of sourceFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (FORBIDDEN.some((needle) => text.includes(needle))) hits.push(path.relative(srcDir, file).split(path.sep).join('/'));
  }
  return hits;
}

export default async function ({ check }) {
  const hits = filesUsingAstroAssets();
  check(hits.length === 0, `Optimisation d'images Astro utilisée (${hits.join(', ')}) : l'exception d'audit astro/sharp n'est plus justifiée`);
}
