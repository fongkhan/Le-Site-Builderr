import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { generateSlug, assertSafePath, assertStrictlyInside, isValidSlug, previewPathFor } = require('../../lib/paths.js');

test('generateSlug — noms valides', () => {
  assert.equal(generateSlug('Boulangerie Artisanale'), 'boulangerie-artisanale');
  assert.equal(generateSlug('Coiffeur Lyon 3'), 'coiffeur-lyon-3');
  assert.equal(generateSlug('Site123'), 'site123');
});

test('generateSlug — translittération des accents et ligatures', () => {
  assert.equal(generateSlug('déjà-vu'), 'deja-vu');
  assert.equal(generateSlug('Notre nouvelle fournée d’été'), 'notre-nouvelle-fournee-d-ete');
  assert.equal(generateSlug('Cœur & Forêt'), 'coeur-foret');
  assert.equal(generateSlug('Château Bœuf'), 'chateau-boeuf');
  assert.equal(generateSlug('Niño Señor'), 'nino-senor');
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

test('assertStrictlyInside — la racine partagée elle-même est refusée', () => {
  const base = path.resolve('/srv/public');
  assert.throws(() => assertStrictlyInside('/srv/public', base));
  assert.throws(() => assertStrictlyInside('/srv/public/', base));
  assert.throws(() => assertStrictlyInside('/srv/public/a/..', base));
  assert.throws(() => assertStrictlyInside('/srv/public-evil/x', base));
  assert.equal(assertStrictlyInside('/srv/public/mon-site', base), path.resolve('/srv/public/mon-site'));
});

test('isValidSlug — uniquement des slugs canoniques', () => {
  assert.ok(isValidSlug('boulangerie-artisanale'));
  assert.ok(isValidSlug('site2'));
  for (const bad of ['', '../x', 'A', '-x', 'a b', 'a/b', 'é', null, undefined, 42, 'a'.repeat(201)]) {
    assert.ok(!isValidSlug(bad), String(bad));
  }
});

test('previewPathFor — suit le dossier réel du site sous la racine publique', () => {
  const root = path.join(path.sep, 'srv', 'public_html');
  assert.equal(previewPathFor(path.join(root, 'mon-site'), root, 'mon-site'), '/preview/mon-site');
  assert.equal(previewPathFor(path.join(root, 'Site_Client'), root, 'site-client'), '/preview/Site_Client');
  assert.equal(previewPathFor(path.join(root, 'clients', 'foo bar'), root, 'foo'), '/preview/clients/foo%20bar');
  // Hors de la racine, racine elle-même ou chemin absent : repli sur le slug
  assert.equal(previewPathFor(path.join(path.sep, 'ailleurs', 'x'), root, 'x'), '/preview/x');
  assert.equal(previewPathFor(root, root, 'x'), '/preview/x');
  assert.equal(previewPathFor('', root, 'x'), '/preview/x');
});
