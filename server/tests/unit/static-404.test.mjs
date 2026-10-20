import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { notFoundCandidates } = require('../../lib/static-404.js');

test('notFoundCandidates — du dossier le plus profond au site', () => {
  assert.deepEqual(notFoundCandidates('/site/en/x'), ['site/en/x/404.html', 'site/en/404.html', 'site/404.html']);
  assert.deepEqual(notFoundCandidates('/site/page.html'), ['site/page.html/404.html', 'site/404.html']);
  assert.deepEqual(notFoundCandidates('//site//x/'), ['site/x/404.html', 'site/404.html'], 'segments vides ignorés');
  assert.deepEqual(notFoundCandidates('/caf%C3%A9/x'), ['café/x/404.html', 'café/404.html'], 'chemin décodé');
});

test('notFoundCandidates — chemins hostiles ou illisibles : aucun candidat', () => {
  assert.deepEqual(notFoundCandidates('/..%2F..%2Fetc/passwd'), []);
  assert.deepEqual(notFoundCandidates('/site/../../etc'), []);
  assert.deepEqual(notFoundCandidates('/site/./x'), []);
  assert.deepEqual(notFoundCandidates('/site/a%5Cb'), [], 'barre oblique inverse');
  assert.deepEqual(notFoundCandidates('/site/a%00b'), [], 'caractère nul');
  assert.deepEqual(notFoundCandidates('/site.old-deploy/x'), [], 'copie de bascule');
  assert.deepEqual(notFoundCandidates('/site.tmp-draft/x'), []);
  assert.deepEqual(notFoundCandidates('%E0%A4%A'), [], 'encodage invalide');
  assert.deepEqual(notFoundCandidates('/'), []);
  assert.deepEqual(notFoundCandidates(''), []);
});

test('notFoundCandidates — profondeur bornée', () => {
  const deep = `/${Array.from({ length: 20 }, (_, i) => `d${i}`).join('/')}`;
  const out = notFoundCandidates(deep);
  assert.equal(out.length, 8);
  assert.equal(out[0], 'd0/d1/d2/d3/d4/d5/d6/d7/404.html');
  assert.equal(out[7], 'd0/404.html');
  assert.equal(notFoundCandidates(deep, 3).length, 3);
});
