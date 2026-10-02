import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { replaceDirAtomically } = require('../../lib/fs-swap.js');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fs-swap-'));
}

test('replaceDirAtomically — remplace le contenu et ne laisse aucun dossier temporaire', () => {
  const root = tmpRoot();
  const src = path.join(root, 'dist');
  const dest = path.join(root, 'site');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'index.html'), 'nouveau');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'index.html'), 'ancien');
  fs.writeFileSync(path.join(dest, 'obsolete.html'), 'à supprimer');

  replaceDirAtomically(src, dest, 'test');

  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf-8'), 'nouveau');
  assert.ok(!fs.existsSync(path.join(dest, 'obsolete.html')));
  assert.deepEqual(fs.readdirSync(root).sort(), ['dist', 'site']);
  // La source est conservée (copie, pas déplacement)
  assert.ok(fs.existsSync(path.join(src, 'index.html')));
});

test('replaceDirAtomically — crée la cible si elle n’existe pas encore', () => {
  const root = tmpRoot();
  const src = path.join(root, 'dist');
  const dest = path.join(root, 'nouveau-site');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'a.txt'), 'A');
  replaceDirAtomically(src, dest, 'x');
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8'), 'A');
});

test('replaceDirAtomically — échec de copie : version en ligne intacte, erreur relancée', () => {
  const root = tmpRoot();
  const dest = path.join(root, 'site');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'index.html'), 'en ligne');

  assert.throws(() => replaceDirAtomically(path.join(root, 'introuvable'), dest, 'ko'));
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf-8'), 'en ligne');
  assert.deepEqual(fs.readdirSync(root), ['site']);
});
