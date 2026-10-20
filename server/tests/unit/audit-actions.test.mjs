import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Journal d'audit : chaque action écrite par le serveur (logAudit(req, '<action>' …) et
// entrées { action: '<action>' } des hooks Payload et tâches de fond) relève d'une
// catégorie du filtre du journal de l'orchestrateur (préfixes de AUDIT_CATEGORIES, lus en
// texte). Une nouvelle famille d'actions sans catégorie serait introuvable par le filtre.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const filtersFile = path.join(serverDir, '..', 'orchestrator', 'src', 'features', 'admin', 'panels', 'auditFilters.ts');
const SKIPPED_DIRS = new Set(['node_modules', 'tests', 'data', 'uploads']);

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) out.push(...sourceFiles(path.join(dir, entry.name)));
    } else if (/\.(c?js|mjs|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Actions écrites par le serveur : Map action → fichiers (relatifs à server/).
function writtenActions() {
  const actions = new Map();
  const patterns = [/logAudit\(\s*req\s*,\s*(['"`])([^'"`]+)\1/g, /\baction:\s*(['"`])([^'"`]+)\1/g];
  for (const file of sourceFiles(serverDir)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const rel = path.relative(serverDir, file);
        actions.set(m[2], [...new Set([...(actions.get(m[2]) || []), rel])]);
      }
    }
  }
  return actions;
}

// Préfixes des catégories : valeurs « a.,b. » de AUDIT_CATEGORIES (catégorie vide exclue).
function categoryPrefixes() {
  const text = fs.readFileSync(filtersFile, 'utf-8');
  const block = text.slice(text.indexOf('AUDIT_CATEGORIES'), text.indexOf('];', text.indexOf('AUDIT_CATEGORIES')));
  return [...block.matchAll(/value:\s*'([^']*)'/g)].flatMap((m) => m[1].split(',')).map((p) => p.trim()).filter(Boolean);
}

test('journal d’audit — actions écrites relevées dans le code du serveur (hooks et tâches de fond compris)', () => {
  const actions = writtenActions();
  for (const expected of [
    'site.creation', 'site.suppression', 'theme.modification', 'page.creation', 'article.enregistrement',
    'media.ajout', 'media.suppression', 'build.declenchement', 'contact.recu',
    'utilisateur.creation', 'motdepasse.reinitialisation', 'connexion.echec', 'connexion.succes',
    'maintenance.purge', 'sauvegarde.creation', 'sauvegarde.restauration', 'site.informations-legales', 'journal.purge',
  ]) {
    assert.ok(actions.has(expected), `action « ${expected} » introuvable dans server/`);
  }
  // Actions de la forme famille.nom (minuscules, tirets) : jamais une valeur calculée
  for (const [action, files] of actions) {
    assert.match(action, /^[a-z]+(?:\.[a-z][a-z-]*)+$/, `${action} (${files.join(', ')})`);
  }
});

test('journal d’audit — chaque action relève d’une catégorie du filtre de l’orchestrateur', () => {
  const prefixes = categoryPrefixes();
  assert.ok(prefixes.length >= 8 && prefixes.every((p) => p.endsWith('.')), `préfixes lus : ${prefixes.join(' ')}`);
  const orphans = [...writtenActions()]
    .filter(([action]) => !prefixes.some((p) => action.startsWith(p)))
    .map(([action, files]) => `${action} (${files.join(', ')})`);
  assert.deepEqual(orphans, [], 'actions sans catégorie dans AUDIT_CATEGORIES (orchestrator/src/features/admin/panels/auditFilters.ts)');
});
