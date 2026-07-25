import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../../../client-template/src/lib/markdown.mjs';

test('markdownToHtml — paragraphes, titres, listes', () => {
  assert.equal(markdownToHtml('Bonjour le monde.'), '<p>Bonjour le monde.</p>');
  assert.equal(markdownToHtml('# Titre'), '<h2>Titre</h2>');
  assert.equal(markdownToHtml('## Sous-titre'), '<h3>Sous-titre</h3>');
  assert.equal(markdownToHtml('- un\n- deux'), '<ul><li>un</li><li>deux</li></ul>');
  assert.equal(markdownToHtml('a\n\nb'), '<p>a</p>\n<p>b</p>');
});

test('markdownToHtml — gras, italique, liens', () => {
  assert.equal(markdownToHtml('**gras** et *italique*'), '<p><strong>gras</strong> et <em>italique</em></p>');
  assert.equal(
    markdownToHtml('[site](https://exemple.fr)'),
    '<p><a href="https://exemple.fr" target="_blank" rel="noopener noreferrer">site</a></p>'
  );
});

test('markdownToHtml — sûr : échappe tout HTML brut (anti-XSS)', () => {
  const out = markdownToHtml('<script>alert(1)</script> **ok**');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('<strong>ok</strong>'));
});

test('markdownToHtml — lien javascript: NON transformé (reste texte échappé)', () => {
  const out = markdownToHtml('[x](javascript:alert(1))');
  assert.ok(!out.includes('href="javascript'));
  assert.ok(out.includes('[x]'));
});

test('markdownToHtml — entrée vide', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(undefined), '');
});
