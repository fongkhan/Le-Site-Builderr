import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Cohérence de la documentation avec le code : README.md (collections, blocs, modèles
// d'IA, routeurs, section « Tests et vérifications ») et server/.env.example (variables
// d'environnement lues par le serveur, et réciproquement). Les listes de référence sont
// lues dans le code (payload.config.ts, ai.js, routes/, template), jamais recopiées ici.
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DIR = path.dirname(SERVER_DIR);
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf-8');

const README = read(ROOT_DIR, 'README.md');
const ENV_EXAMPLE = read(SERVER_DIR, '.env.example');
const { payloadConfigSlugs } = require('../../lib/payload-inventory.js');
const { collections, blocks } = payloadConfigSlugs(read(SERVER_DIR, 'payload.config.ts'));
const { PROVIDERS, KNOWN_BLOCK_TYPES } = require('../../ai.js');

// Nom cité en code dans le README : `nom`
const citedInReadme = (name) => README.includes(`\`${name}\``);
const sorted = (list) => [...list].sort();

test('payload.config.ts — collections et blocs trouvés', () => {
  assert.ok(collections.includes('users') && collections.includes('pages'), `collections : ${collections.join(', ')}`);
  assert.ok(blocks.includes('hero') && blocks.includes('footer'), `blocs : ${blocks.join(', ')}`);
  for (const block of blocks) assert.ok(!collections.includes(block), `bloc compté comme collection : ${block}`);
});

test('README — chaque collection Payload est citée (`slug`)', () => {
  const missing = collections.filter((c) => !citedInReadme(c));
  assert.deepEqual(missing, [], `collections absentes du README (§ « Payload CMS v3 multi-tenant ») : ${missing.join(', ')}`);
});

test('Blocs — IA (KNOWN_BLOCK_TYPES), README et template = blocs de payload.config.ts', () => {
  assert.deepEqual(sorted(KNOWN_BLOCK_TYPES), sorted(blocks), 'ai.js KNOWN_BLOCK_TYPES diffère des blocs de payload.config.ts');
  const missing = blocks.filter((b) => !citedInReadme(b));
  assert.deepEqual(missing, [], `blocs absents du README (§ « CMS par blocs ») : ${missing.join(', ')}`);
  const astro = read(ROOT_DIR, 'client-template', 'src', 'pages', '[...slug].astro');
  const map = astro.match(/const blockMap[^=]*=\s*\{([\s\S]*?)\};/);
  assert.ok(map, 'const blockMap introuvable dans client-template/src/pages/[...slug].astro');
  const keys = [...map[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map((m) => m[1]);
  assert.deepEqual(sorted(keys), sorted(blocks), 'blockMap du template diffère des blocs de payload.config.ts');
});

test('README — modèles d\'IA par défaut cités', () => {
  const vars = ['OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'];
  const saved = Object.fromEntries(vars.map((v) => [v, process.env[v]]));
  let models;
  try {
    for (const v of vars) delete process.env[v];
    models = Object.values(PROVIDERS).map((p) => p.model());
  } finally {
    for (const v of vars) if (saved[v] !== undefined) process.env[v] = saved[v];
  }
  assert.equal(models.length, 3);
  const missing = models.filter((m) => !citedInReadme(m));
  assert.deepEqual(missing, [], `modèles par défaut absents du README (§ « Tunnel d'Onboarding IA ») : ${missing.join(', ')}`);
  for (const v of vars) assert.ok(citedInReadme(v), `${v} absent du README`);
});

test('README — chaque routeur de server/routes est cité (`nom`)', () => {
  const routers = fs.readdirSync(path.join(SERVER_DIR, 'routes')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
  assert.ok(routers.length > 0);
  const missing = routers.filter((r) => !citedInReadme(r));
  assert.deepEqual(missing, [], `routeurs absents du README (tableau « Organisation du serveur ») : ${missing.join(', ')}`);
});

// --- Variables d'environnement ---

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'tests', 'data', 'uploads', 'migrations']);
const SOURCE_EXT = /\.(js|mjs|ts|tsx)$/;
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...sourceFiles(full));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
const sources = sourceFiles(SERVER_DIR).map((file) => ({ file: path.relative(SERVER_DIR, file), text: read(file) }));

// Lectures : process.env.X, process.env['X'], envInt('X'), env.X — jamais une affectation
// (process.env.X = … : drapeau posé par le serveur lui-même pour Next ou Payload).
const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /\benvInt\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\benv\.([A-Z][A-Z0-9_]*)/g,
];
function envReads(text) {
  const names = new Set();
  for (const re of READ_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const after = text.slice(m.index + m[0].length);
      if (/^\s*=(?!=)/.test(after)) continue;
      names.add(m[1]);
    }
  }
  return names;
}

// Variables lues mais volontairement absentes de .env.example (justification obligatoire)
const NOT_IN_ENV_EXAMPLE = new Map([
  ['NODE_ENV', 'variable standard de Node, posée par « npm run start:prod » (--production) : écrite dans .env, elle ferait aussi démarrer « npm start » en production'],
]);

// Variables documentées : lignes « X=… » ou « # X=… » de .env.example
const documented = new Set([...ENV_EXAMPLE.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

test('envReads — lectures reconnues, affectations ignorées', () => {
  const sample = "const a = process.env.A_1; process.env['B'] ; envInt('C', 3); env.D; process.env.E = 'true'; if (env.F === 'x') {}";
  assert.deepEqual(sorted(envReads(sample)), ['A_1', 'B', 'C', 'D', 'F']);
});

test('.env.example — chaque variable lue par le serveur est documentée', () => {
  const readIn = new Map();
  for (const { file, text } of sources) {
    for (const name of envReads(text)) if (!readIn.has(name)) readIn.set(name, file);
  }
  assert.ok(readIn.has('DATABASE_URI') && readIn.has('RL_LOGIN_MAX'), 'extraction des variables lues inopérante');
  const missing = [...readIn]
    .filter(([name]) => !documented.has(name) && !NOT_IN_ENV_EXAMPLE.has(name))
    .map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(missing, [], `variables lues mais absentes de server/.env.example (ajoutez une ligne « # NOM=valeur » commentée, ou une exclusion justifiée dans ce test) : ${missing.join(', ')}`);
  for (const name of NOT_IN_ENV_EXAMPLE.keys()) assert.ok(readIn.has(name), `exclusion devenue inutile : ${name}`);
});

test('.env.example — chaque variable documentée est utilisée par le serveur', () => {
  const code = sources.map((s) => s.text).join('\n');
  const unused = [...documented].filter((name) => !new RegExp(`\\b${name}\\b`).test(code));
  assert.deepEqual(unused, [], `variables documentées dans server/.env.example mais jamais citées par le code du serveur : ${unused.join(', ')}`);
});

test('README — section « Tests et vérifications » complète', () => {
  const start = README.search(/^## .*Tests et vérifications/m);
  assert.ok(start >= 0, 'section « ## … Tests et vérifications » absente du README');
  const rest = README.slice(start + 3);
  const next = rest.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  for (const command of ['npm test', 'npm run lint', 'npm run typecheck', 'security-check.mjs', 'check-fixture-build.mjs', 'auth-empty-db-check.mjs', 'migrate:check', 'routes-guard.test.mjs']) {
    assert.ok(section.includes(command), `section « Tests et vérifications » : « ${command} » absent`);
  }
});

// --- payloadConfigSlugs ---

test('payloadConfigSlugs — apostrophe dans un commentaire, crochet dans une chaîne', () => {
  const text = `
    export default buildConfig({
      // l'apostrophe d'un commentaire ne doit rien ouvrir [
      /* ni ce crochet ] ni « collections: [ » */
      collections: [
        { slug: 'users', fields: [{ name: 'note', defaultValue: 'crochet ] dans une chaîne' }] },
        { slug: "themes" },
        // { slug: 'commentee' },
        {
          slug: 'pages',
          fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'hero' }, { slug: 'faq', label: \`[\${'x'}]\` }] }],
        },
        { slug: 'posts' },
      ],
      globals: [{ slug: 'hors-collections' }],
    })`;
  assert.deepEqual(payloadConfigSlugs(text), { collections: ['users', 'themes', 'pages', 'posts'], blocks: ['hero', 'faq'] });
});

test('payloadConfigSlugs — marqueur absent : erreur explicite (fichier reformaté)', () => {
  assert.throws(() => payloadConfigSlugs("collections: [{ slug: 'users' }]"), /blocks: \[.*introuvable/);
  assert.throws(() => payloadConfigSlugs("// collections: [\nblocks: [{ slug: 'hero' }]"), /collections: \[.*introuvable/);
  assert.throws(() => payloadConfigSlugs("blocks: [{ slug: 'hero' }] collections: [ { slug: 'users' }"), /non refermée/);
});
