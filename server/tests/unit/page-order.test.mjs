import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sortPages } = require('../../lib/page-order.js');

const slugs = (docs) => sortPages(docs).map((p) => p.slug);

test('sortPages — navOrder croissant, pages sans ordre en dernier', () => {
  assert.deepEqual(slugs([
    { slug: 'c', navOrder: 2 },
    { slug: 'sans-ordre', navOrder: null, createdAt: '2020-01-01' },
    { slug: 'a', navOrder: 0 },
    { slug: 'b', navOrder: 1 },
  ]), ['a', 'b', 'c', 'sans-ordre']);
});

test('sortPages — trous et égalités départagés par createdAt puis id', () => {
  assert.deepEqual(slugs([
    { id: 9, slug: 'meme-date-9', navOrder: 5, createdAt: '2024-01-01' },
    { id: 3, slug: 'meme-date-3', navOrder: 5, createdAt: '2024-01-01' },
    { id: 1, slug: 'plus-recent', navOrder: 5, createdAt: '2024-06-01' },
    { id: 2, slug: 'premier', navOrder: -1 },
    { id: 4, slug: 'loin', navOrder: 40 },
  ]), ['premier', 'meme-date-3', 'meme-date-9', 'plus-recent', 'loin']);
  // Plusieurs pages sans ordre : par date de création
  assert.deepEqual(slugs([
    { id: 'b', slug: 'y', createdAt: '2024-02-01' },
    { id: 'a', slug: 'x', createdAt: '2024-01-01' },
  ]), ['x', 'y']);
});

test('sortPages — neutre sans aucun champ de tri (fichier JSON), sans muter l’entrée', () => {
  const docs = [{ slug: 'home' }, { slug: 'contact' }, { slug: 'about' }];
  assert.deepEqual(slugs(docs), ['home', 'contact', 'about']);
  assert.deepEqual(docs.map((p) => p.slug), ['home', 'contact', 'about']);
  assert.deepEqual(sortPages(undefined), []);
});
