import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { saveRelease, listReleases, pruneReleases, resolveRelease } = require('../../lib/releases.js');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'releases-'));
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>v</h1>');
  return { base, dist };
}

test('saveRelease + listReleases — tri anté-chronologique', () => {
  const { base, dist } = setup();
  const r1 = saveRelease(base, 'mon-site', dist, 1000000000000);
  const r2 = saveRelease(base, 'mon-site', dist, 1000000000500);
  const r3 = saveRelease(base, 'mon-site', dist, 1000000000250);
  const list = listReleases(base, 'mon-site');
  assert.deepEqual(list.map((r) => r.id), [r2, r3, r1]);
  assert.ok(fs.existsSync(path.join(base, 'mon-site', r1, 'index.html')));
  fs.rmSync(base, { recursive: true, force: true });
});

test('pruneReleases — conserve les N plus récentes (minimum 1)', () => {
  const { base, dist } = setup();
  for (let i = 0; i < 5; i++) saveRelease(base, 's', dist, 1000000000000 + i);
  const removed = pruneReleases(base, 's', 3);
  assert.equal(removed.length, 2);
  assert.equal(listReleases(base, 's').length, 3);
  // keep=0 absurde → garde quand même la plus récente
  pruneReleases(base, 's', 0);
  assert.equal(listReleases(base, 's').length, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolveRelease — refuse les identifiants hostiles et les releases absentes', () => {
  const { base, dist } = setup();
  const ok = saveRelease(base, 's', dist, 1000000000000);
  assert.ok(resolveRelease(base, 's', ok));
  assert.equal(resolveRelease(base, 's', '../../etc'), null);
  assert.equal(resolveRelease(base, 's', 'abc'), null);
  assert.equal(resolveRelease(base, 's', '9999999999999'), null); // inexistante
  assert.equal(resolveRelease(base, 's', null), null);
  fs.rmSync(base, { recursive: true, force: true });
});

test('listReleases — site sans release ou dossier pollué', () => {
  const { base, dist } = setup();
  assert.deepEqual(listReleases(base, 'inconnu'), []);
  saveRelease(base, 's', dist, 1000000000000);
  fs.mkdirSync(path.join(base, 's', 'pas-un-id'));
  fs.writeFileSync(path.join(base, 's', 'fichier.txt'), 'x');
  assert.equal(listReleases(base, 's').length, 1);
  fs.rmSync(base, { recursive: true, force: true });
});
