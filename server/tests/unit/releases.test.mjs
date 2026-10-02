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

test('pruneReleases — keep invalide : la release la plus récente est toujours conservée', () => {
  const { base, dist } = setup();
  saveRelease(base, 'mon-site', dist, 1000000000000);
  const newest = saveRelease(base, 'mon-site', dist, 1000000000500);
  for (const keep of [undefined, NaN, 'abc', 0, -3]) {
    pruneReleases(base, 'mon-site', keep);
    assert.deepEqual(listReleases(base, 'mon-site').map((r) => r.id), [newest], String(keep));
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const { removePartialReleases } = require('../../lib/releases.js');

test('(c) release interrompue (.partial) : ignorée par list, resolve et prune, supprimée au boot', () => {
  const { base, dist } = setup();
  const ok = saveRelease(base, 's', dist, 1000000000000);
  const partial = path.join(base, 's', '1700000000000.partial');
  fs.mkdirSync(partial);
  fs.writeFileSync(path.join(partial, 'index.html'), '<h1>moitié</h1>');

  assert.deepEqual(listReleases(base, 's').map((r) => r.id), [ok]);
  assert.equal(resolveRelease(base, 's', '1700000000000'), null);
  assert.equal(resolveRelease(base, 's', '1700000000000.partial'), null);
  assert.deepEqual(pruneReleases(base, 's', 1), []);
  assert.ok(fs.existsSync(path.join(base, 's', ok)), 'la bonne release n’est pas chassée');

  assert.deepEqual(removePartialReleases(base), ['s/1700000000000.partial']);
  assert.ok(!fs.existsSync(partial));
  assert.deepEqual(removePartialReleases(path.join(base, 'absent')), []);
  fs.rmSync(base, { recursive: true, force: true });
});

test('saveRelease — aucune copie .partial ne subsiste, même en cas d’échec', () => {
  const { base, dist } = setup();
  saveRelease(base, 's', dist, 1000000000000);
  assert.deepEqual(fs.readdirSync(path.join(base, 's')), ['1000000000000']);
  // Source introuvable : erreur relancée, rien de partiel laissé
  assert.throws(() => saveRelease(base, 's', path.join(base, 'introuvable'), 1000000000001));
  assert.deepEqual(fs.readdirSync(path.join(base, 's')), ['1000000000000']);
  fs.rmSync(base, { recursive: true, force: true });
});
