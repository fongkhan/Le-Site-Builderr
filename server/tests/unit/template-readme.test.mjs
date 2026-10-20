import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cohérence de client-template/README.md avec le template : arborescence existante,
// fonctions citées réellement exportées, variables d'environnement lues documentées,
// règle de la CSP rappelée.
const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'client-template');
const README = fs.readFileSync(path.join(TEMPLATE_DIR, 'README.md'), 'utf-8');

// Sources du template (hors dépendances et sorties de build)
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.astro'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(astro|ts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const SOURCES = [...sourceFiles(path.join(TEMPLATE_DIR, 'src')), ...sourceFiles(path.join(TEMPLATE_DIR, 'integrations')), path.join(TEMPLATE_DIR, 'astro.config.mjs')]
  .map((file) => fs.readFileSync(file, 'utf-8'));

test('README du template — chaque entrée de l’arborescence existe', () => {
  const block = README.match(/```text\n([\s\S]*?)```/);
  assert.ok(block, 'arborescence ```text introuvable');
  const lines = block[1].split('\n');
  assert.equal(lines[0], 'client-template/');
  const stack = [];
  const missing = [];
  let entries = 0;
  for (const line of lines.slice(1)) {
    const m = line.match(/^((?:│ {3}| {4})*)(?:├── |└── )(\S+)/);
    if (!m) continue;
    entries++;
    stack.length = m[1].length / 4;
    stack.push(m[2].replace(/\/$/, ''));
    const rel = path.join(...stack);
    if (!fs.existsSync(path.join(TEMPLATE_DIR, rel))) missing.push(rel);
  }
  assert.ok(entries > 10, `${entries} entrées lues`);
  assert.deepEqual(missing, [], `chemins absents du template : ${missing.join(', ')}`);
});

test('README du template — fonctions citées exportées par le template', () => {
  const exported = new Set();
  for (const src of SOURCES) {
    for (const [, name] of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) exported.add(name);
    for (const [, list] of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const item of list.split(',')) exported.add(item.trim().split(/\s+as\s+/).pop());
    }
  }
  const cited = [...new Set([...README.matchAll(/\b([A-Za-z_]\w*)\(\)/g)].map((m) => m[1]))];
  assert.ok(cited.includes('withBase') && cited.includes('safeHttpUrl'), cited.join(', '));
  const missing = cited.filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], `fonctions citées introuvables dans le template : ${missing.join(', ')}`);
});

test('README du template — chaque variable d’environnement lue par le template est documentée', () => {
  const read = new Set();
  for (const src of SOURCES) {
    for (const [, name] of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) read.add(name);
    // import.meta.env : variables d'Astro elles-mêmes (BASE_URL…) non documentées ici
    for (const [, name] of src.matchAll(/import\.meta\.env\.(PUBLIC_[A-Z0-9_]*)/g)) read.add(name);
  }
  assert.ok(read.has('PUBLIC_SITE_LOGO') && read.has('SITE_BASE_PATH'), [...read].join(', '));
  const documented = [...README.matchAll(/`([A-Z][A-Z0-9_]*\*?)(?:=[^`]*)?`/g)].map((m) => m[1]);
  const isDocumented = (name) => documented.some((d) => d === name || (d.endsWith('*') && name.startsWith(d.slice(0, -1))));
  const missing = [...read].filter((name) => !isDocumented(name)).sort();
  assert.deepEqual(missing, [], `variables lues par le template absentes du README : ${missing.join(', ')}`);
});

test('README du template — règle de la CSP rappelée (styles et scripts en ligne interdits)', () => {
  for (const term of ['style=', 'is:inline', 'define:vars', 'data-*', 'site-csp.test.mjs', 'scripts/checks/csp.mjs']) {
    assert.ok(README.includes(term), `« ${term} » absent du README du template`);
  }
});
