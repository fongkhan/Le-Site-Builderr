import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { missingBuildMessage } = require('../../lib/prod-build.js');

test('missingBuildMessage — build Next présent (.next/BUILD_ID) : aucun message', () => {
  const seen = [];
  assert.equal(missingBuildMessage('/srv/app/server', (p) => { seen.push(p); return true; }), null);
  assert.deepEqual(seen, [path.join('/srv/app/server', '.next', 'BUILD_ID')]);
});

test('missingBuildMessage — build absent : message d\'arrêt avec la commande à lancer', () => {
  const msg = missingBuildMessage('/srv/app/server', () => false);
  assert.match(msg, /Build de production absent \(server\/\.next\)/);
  assert.match(msg, /npm run build/);
});
