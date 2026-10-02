import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readBuildLog } = require('../../core/build-log.js');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'build-log-')), 'log.txt');

test('readBuildLog — fichier absent : chaîne vide', () => {
  assert.equal(readBuildLog(tmpFile()), '');
});

test('readBuildLog — petit fichier : rendu tel quel', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'Démarrage… ✅\n');
  assert.equal(readBuildLog(file), 'Démarrage… ✅\n');
});

test('readBuildLog — 1 Mo : au plus 200 Ko, préfixés par […], sans caractère UTF-8 coupé', () => {
  const file = tmpFile();
  // Caractères de 1, 2, 3 et 4 octets : la position de lecture tombe au milieu de l'un d'eux
  const unit = 'aé€😀';
  const content = unit.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(unit))) + 'FIN';
  fs.writeFileSync(file, content);
  const out = readBuildLog(file);
  assert.ok(Buffer.byteLength(out) <= 200 * 1024);
  assert.ok(out.startsWith('[…]\n'));
  assert.ok(!out.includes('�'), 'aucun caractère de remplacement');
  assert.ok(out.endsWith('FIN'));
  // La fin lue correspond exactement à la fin du fichier
  assert.ok(content.endsWith(out.slice('[…]\n'.length)));
});
