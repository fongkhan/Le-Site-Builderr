import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { serializeQueue, parseQueue, MAX_QUEUE } = require('../../lib/build-queue.js');

const fileOf = (queue, version = 1) => JSON.stringify({ version, savedAt: '2026-10-20T10:00:00.000Z', queue });

test('serializeQueue / parseQueue — aller-retour', () => {
  const now = new Date('2026-10-20T10:00:00.000Z');
  const saved = serializeQueue([{ slug: 'site-a', triggeredBy: 'a@exemple.fr' }, { slug: 'site-b', triggeredBy: 'système' }], now);
  assert.deepEqual(saved, {
    version: 1,
    savedAt: '2026-10-20T10:00:00.000Z',
    queue: [{ slug: 'site-a', triggeredBy: 'a@exemple.fr' }, { slug: 'site-b', triggeredBy: 'système' }],
  });
  assert.deepEqual(parseQueue(JSON.stringify(saved)), saved.queue);
  assert.deepEqual(parseQueue(saved), saved.queue, 'objet déjà lu accepté');
});

test('parseQueue — slugs non canoniques et doublons écartés', () => {
  const parsed = parseQueue(fileOf([
    { slug: '../x', triggeredBy: 'a@b.fr' },
    { slug: '', triggeredBy: 'a@b.fr' },
    { slug: 'A_B', triggeredBy: 'a@b.fr' },
    { slug: 42 },
    null,
    'site-a',
    { slug: 'site-a', triggeredBy: 'premier@b.fr' },
    { slug: 'site-a', triggeredBy: 'second@b.fr' },
    { slug: 'site-b' },
  ]));
  assert.deepEqual(parsed, [
    { slug: 'site-a', triggeredBy: 'premier@b.fr' },
    { slug: 'site-b', triggeredBy: 'système' },
  ]);
});

test('parseQueue — fichier illisible, version inconnue ou file absente → file vide', () => {
  assert.deepEqual(parseQueue('{ tronqué'), []);
  assert.deepEqual(parseQueue(''), []);
  assert.deepEqual(parseQueue('null'), []);
  assert.deepEqual(parseQueue(fileOf([{ slug: 'site-a' }], 2)), []);
  assert.deepEqual(parseQueue(JSON.stringify({ version: 1, queue: { slug: 'site-a' } })), []);
  assert.deepEqual(parseQueue(JSON.stringify([{ slug: 'site-a' }])), []);
  assert.deepEqual(parseQueue(undefined), []);
});

test(`parseQueue — au plus ${MAX_QUEUE} entrées`, () => {
  const queue = Array.from({ length: MAX_QUEUE + 50 }, (_, i) => ({ slug: `site-${i}`, triggeredBy: 'a@b.fr' }));
  const parsed = parseQueue(fileOf(queue));
  assert.equal(parsed.length, 200);
  assert.equal(parsed[199].slug, 'site-199');
});

test('parseQueue — déclencheur non textuel, vide ou trop long → « système »', () => {
  const parsed = parseQueue(fileOf([
    { slug: 'a', triggeredBy: { email: 'x' } },
    { slug: 'b', triggeredBy: '   ' },
    { slug: 'c', triggeredBy: 'x'.repeat(255) },
    { slug: 'd', triggeredBy: '  admin@exemple.fr  ' },
  ]));
  assert.deepEqual(parsed.map((e) => e.triggeredBy), ['système', 'système', 'système', 'admin@exemple.fr']);
});
