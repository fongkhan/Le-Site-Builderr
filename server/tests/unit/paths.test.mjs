import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { generateSlug, assertSafePath } = require('../../lib/paths.js');

test('generateSlug — noms valides', () => {
  assert.equal(generateSlug('Boulangerie Artisanale'), 'boulangerie-artisanale');
  assert.equal(generateSlug('Coiffeur Lyon 3'), 'coiffeur-lyon-3');
  assert.equal(generateSlug('déjà-vu'), 'd-j-vu'); // accents non alphanumériques ASCII
  assert.equal(generateSlug('Site123'), 'site123');
});

test('generateSlug — noms invalides renvoient null (anti-slug-vide)', () => {
  assert.equal(generateSlug('!!!'), null);
  assert.equal(generateSlug('---'), null);
  assert.equal(generateSlug('🎉'), null);
  assert.equal(generateSlug(''), null);
  assert.equal(generateSlug('   '), null);
  assert.equal(generateSlug(null), null);
  assert.equal(generateSlug(undefined), null);
  assert.equal(generateSlug(42), null);
});

test('assertSafePath — chemins confinés acceptés', () => {
  const base = path.resolve('/srv/public');
  assert.doesNotThrow(() => assertSafePath('/srv/public', base));
  assert.doesNotThrow(() => assertSafePath('/srv/public/mon-site', base));
  assert.doesNotThrow(() => assertSafePath('/srv/public/a/b/c', base));
});

test('assertSafePath — évasions rejetées', () => {
  const base = path.resolve('/srv/public');
  assert.throws(() => assertSafePath('/etc', base));
  assert.throws(() => assertSafePath('/srv/public/../evil', base));
  assert.throws(() => assertSafePath('/', base));
  // Piège du préfixe : /srv/public-evil ne doit PAS passer
  assert.throws(() => assertSafePath('/srv/public-evil', base));
});
