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

const { recoverInterruptedSwaps } = require('../../lib/fs-swap.js');

test('recoverInterruptedSwaps — (a) site écarté en .old, cible absente : restauré', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'site.old-site'));
  fs.writeFileSync(path.join(root, 'site.old-site', 'index.html'), 'en ligne');
  fs.mkdirSync(path.join(root, 'site.tmp-site'));
  fs.writeFileSync(path.join(root, 'site.tmp-site', 'index.html'), 'partiel');

  const actions = recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'en ligne');
  assert.deepEqual(fs.readdirSync(root), ['site']);
  assert.equal(actions.length, 2);
});

test('recoverInterruptedSwaps — (b) site + copie .tmp : le .tmp est supprimé, le site intact', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), 'en ligne');
  fs.mkdirSync(path.join(root, 'site.tmp-site'));
  fs.writeFileSync(path.join(root, 'site.tmp-site', 'index.html'), 'partiel');

  recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'en ligne');
  assert.deepEqual(fs.readdirSync(root), ['site']);
});

test('recoverInterruptedSwaps — un .old n’écrase jamais une cible existante ; suffixes draft/rollback', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), 'nouveau');
  fs.mkdirSync(path.join(root, 'site.old-rollback'));
  fs.writeFileSync(path.join(root, 'site.old-rollback', 'index.html'), 'ancien');
  fs.mkdirSync(path.join(root, 'autre.old-draft'));
  fs.mkdirSync(path.join(root, 'autre2.tmp-draft'));
  fs.mkdirSync(path.join(root, 'pas.une.bascule'));

  recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'nouveau');
  assert.deepEqual(fs.readdirSync(root).sort(), ['autre', 'pas.une.bascule', 'site']);
});

test('recoverInterruptedSwaps — racine absente : aucune action', () => {
  assert.deepEqual(recoverInterruptedSwaps(path.join(os.tmpdir(), `introuvable-${Date.now()}`)), []);
});
