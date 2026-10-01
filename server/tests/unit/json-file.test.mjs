import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readJsonStrict, writeJsonAtomic } = require('../../lib/json-file.js');

test('readJsonStrict — absent : valeur par défaut ; illisible : erreur (jamais pris pour vide)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-file-'));
  const file = path.join(dir, 'data.json');
  assert.deepEqual(readJsonStrict(file, []), []);
  fs.writeFileSync(file, '{ corrompu');
  assert.throws(() => readJsonStrict(file, []), /illisible/);
});

test('writeJsonAtomic — écrit puis relit, sans fichier temporaire résiduel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-file-'));
  const file = path.join(dir, 'data.json');
  writeJsonAtomic(file, { a: [1, 2] });
  assert.deepEqual(readJsonStrict(file, null), { a: [1, 2] });
  assert.deepEqual(fs.readdirSync(dir), ['data.json']);
});
