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

const { recoverInterruptedSwaps, isSwapDirRequest, SWAP_MARKER } = require('../../lib/fs-swap.js');

// Reste de bascule réel : dossier marqué par replaceDirAtomically
function swapLeftover(dir, files = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SWAP_MARKER), 'x');
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

test('recoverInterruptedSwaps — (a) site écarté en .old, cible absente : restauré', () => {
  const root = tmpRoot();
  swapLeftover(path.join(root, 'site.old-site'), { 'index.html': 'en ligne' });
  swapLeftover(path.join(root, 'site.tmp-site'), { 'index.html': 'partiel' });

  const actions = recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'en ligne');
  assert.deepEqual(fs.readdirSync(root), ['site']);
  // Le site restauré ne garde pas le marqueur
  assert.deepEqual(fs.readdirSync(path.join(root, 'site')), ['index.html']);
  assert.equal(actions.length, 2);
});

test('recoverInterruptedSwaps — (b) site + copie .tmp : le .tmp est supprimé, le site intact', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), 'en ligne');
  swapLeftover(path.join(root, 'site.tmp-site'), { 'index.html': 'partiel' });

  recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'en ligne');
  assert.deepEqual(fs.readdirSync(root), ['site']);
});

test('recoverInterruptedSwaps — un .old n’écrase jamais une cible existante ; suffixes draft/rollback', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), 'nouveau');
  swapLeftover(path.join(root, 'site.old-rollback'), { 'index.html': 'ancien' });
  swapLeftover(path.join(root, 'autre.old-draft'));
  swapLeftover(path.join(root, 'autre2.tmp-draft'));
  fs.mkdirSync(path.join(root, 'pas.une.bascule'));

  recoverInterruptedSwaps(root);

  assert.equal(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf-8'), 'nouveau');
  assert.deepEqual(fs.readdirSync(root).sort(), ['autre', 'pas.une.bascule', 'site']);
});

test('recoverInterruptedSwaps — racine absente : aucune action', () => {
  assert.deepEqual(recoverInterruptedSwaps(path.join(os.tmpdir(), `introuvable-${Date.now()}`)), []);
});

test('recoverInterruptedSwaps — un dossier qui ressemble seulement à un reste (sans marqueur) n’est jamais touché', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'boutique'));
  fs.mkdirSync(path.join(root, 'boutique.old-2024'));
  fs.writeFileSync(path.join(root, 'boutique.old-2024', 'index.html'), 'site en ligne');
  fs.mkdirSync(path.join(root, 'archive.old-2023'));
  fs.writeFileSync(path.join(root, 'archive.old-2023', 'index.html'), 'autre site');
  fs.mkdirSync(path.join(root, '.tmp-cache'));
  // Marqueur qui n'est pas un fichier : ignoré aussi
  fs.mkdirSync(path.join(root, 'x.tmp-y', SWAP_MARKER), { recursive: true });

  assert.deepEqual(recoverInterruptedSwaps(root), []);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.tmp-cache', 'archive.old-2023', 'boutique', 'boutique.old-2024', 'x.tmp-y']);
  assert.equal(fs.readFileSync(path.join(root, 'boutique.old-2024', 'index.html'), 'utf-8'), 'site en ligne');
});

test('replaceDirAtomically — interruption au moment de la bascule : la reprise au boot remet le site en ligne', () => {
  const root = tmpRoot();
  const live = path.join(root, 'live');
  const crash = path.join(root, 'crash');
  const src = path.join(root, 'dist');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'index.html'), 'nouveau');
  fs.mkdirSync(path.join(live, 'site'), { recursive: true });
  fs.writeFileSync(path.join(live, 'site', 'index.html'), 'ancien');

  // « Crash » juste avant la promotion de la copie : on fige l'état du disque à cet instant
  const realRename = fs.renameSync;
  let snapshot = null;
  fs.renameSync = (from, to) => {
    if (from.endsWith('.tmp-site') && !snapshot) {
      snapshot = fs.readdirSync(live).sort();
      fs.cpSync(live, crash, { recursive: true });
    }
    return realRename(from, to);
  };
  try {
    replaceDirAtomically(src, path.join(live, 'site'), 'site');
  } finally {
    fs.renameSync = realRename;
  }

  assert.deepEqual(snapshot, ['site.old-site', 'site.tmp-site']);
  // Bascule complète : aucun marqueur dans le site en ligne
  assert.deepEqual(fs.readdirSync(path.join(live, 'site')), ['index.html']);
  recoverInterruptedSwaps(crash);
  assert.equal(fs.readFileSync(path.join(crash, 'site', 'index.html'), 'utf-8'), 'ancien');
  assert.ok(!fs.readdirSync(path.join(crash, 'site')).includes(SWAP_MARKER));
});

test('replaceDirAtomically — copie partielle interrompue : supprimée au boot, site intact', () => {
  const root = tmpRoot();
  const src = path.join(root, 'dist');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'index.html'), 'nouveau');
  const live = path.join(root, 'live');
  fs.mkdirSync(path.join(live, 'site'), { recursive: true });
  fs.writeFileSync(path.join(live, 'site', 'index.html'), 'en ligne');
  const realCp = fs.cpSync;
  fs.cpSync = (from, to, opts) => {
    realCp(from, to, opts);
    // L'état à la fin de la copie (avant la bascule) est figé comme après un crash
    realCp(live, path.join(root, 'crash'), { recursive: true });
  };
  try {
    replaceDirAtomically(src, path.join(live, 'site'), 'site');
  } finally {
    fs.cpSync = realCp;
  }
  const crash = path.join(root, 'crash');
  assert.deepEqual(recoverInterruptedSwaps(crash), ['supprimé : site.tmp-site']);
  assert.deepEqual(fs.readdirSync(crash), ['site']);
  assert.equal(fs.readFileSync(path.join(crash, 'site', 'index.html'), 'utf-8'), 'en ligne');
});

test('isSwapDirRequest — seul le premier segment désigne un dossier de bascule', () => {
  for (const p of ['/site.old-x/index.html', '/site.tmp-draft/', '/a/../site.old-x/index.html', '/site%2Eold-x/', '/a%2F..%2Fsite.tmp-y/i.html']) {
    assert.equal(isSwapDirRequest(p), true, p);
  }
  for (const p of ['/site/media/affiche.old-2023.png', '/site/media/logo.tmp-v2.png', '/site/index.html', '/', '']) {
    assert.equal(isSwapDirRequest(p), false, p);
  }
});
