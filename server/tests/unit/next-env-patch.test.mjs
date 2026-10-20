import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// core/next-env-patch.js : CHAQUE copie de @next/env (celle de Next et celle que Payload
// embarque dans node_modules/payload/node_modules) expose `.default.loadEnvConfig`, sans
// quoi Payload échoue au chargement (« Cannot destructure property 'loadEnvConfig' »).
const require = createRequire(import.meta.url);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const payloadDir = path.join(serverDir, 'node_modules', 'payload');

test('next-env-patch — chaque copie résoluble de @next/env expose .default.loadEnvConfig', () => {
  require('../../core/next-env-patch.js');
  const serverRequire = createRequire(path.join(serverDir, 'index.js'));
  const copies = new Set();
  for (const paths of [undefined, [payloadDir]]) {
    let resolved;
    try {
      resolved = serverRequire.resolve('@next/env', paths ? { paths } : undefined);
    } catch {
      continue; // copie absente : rien à vérifier
    }
    copies.add(resolved);
    const env = serverRequire(resolved);
    assert.equal(typeof env.default?.loadEnvConfig, 'function', `${path.relative(serverDir, resolved)} sans .default.loadEnvConfig`);
    assert.equal(typeof env.loadEnvConfig, 'function', `${path.relative(serverDir, resolved)} sans loadEnvConfig`);
  }
  assert.ok(copies.size >= 1, 'aucune copie de @next/env');
});
