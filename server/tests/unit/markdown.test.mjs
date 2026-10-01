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

test('markdownToHtml — les URLs de liens ne sont jamais touchées par gras/italique', () => {
  assert.equal(
    markdownToHtml('[lien](https://exemple.fr/a*b*c) et *ok*'),
    '<p><a href="https://exemple.fr/a*b*c" target="_blank" rel="noopener noreferrer">lien</a> et <em>ok</em></p>'
  );
  const two = markdownToHtml('[a](https://a.fr/**x**) [b](mailto:b@c.fr)');
  assert.ok(two.includes('href="https://a.fr/**x**"'));
  assert.ok(two.includes('href="mailto:b@c.fr"'));
  assert.ok(!two.includes('<strong>'));
});

test('markdownToHtml — texte de lien formaté', () => {
  assert.equal(
    markdownToHtml('[**gras**](https://x.fr)'),
    '<p><a href="https://x.fr" target="_blank" rel="noopener noreferrer"><strong>gras</strong></a></p>'
  );
});

test('markdownToHtml — italique imbriqué dans le gras (et inversement)', () => {
  assert.equal(markdownToHtml('**gras *italique* gras**'), '<p><strong>gras <em>italique</em> gras</strong></p>');
  assert.equal(markdownToHtml('***les deux***'), '<p><strong><em>les deux</em></strong></p>');
  assert.equal(markdownToHtml('*un **deux** trois*'), '<p><em>un <strong>deux</strong> trois</em></p>');
  // Chevauchement : laissé tel quel plutôt que produire du HTML mal imbriqué
  assert.equal(markdownToHtml('**a *b** c*'), '<p><strong>a *b</strong> c*</p>');
});

test('markdownToHtml — astérisques entourées de blancs ou dans un mot : pas de mise en forme', () => {
  assert.equal(markdownToHtml('5 * 3 * 2'), '<p>5 * 3 * 2</p>');
  assert.equal(markdownToHtml('2*3*4'), '<p>2*3*4</p>');
  assert.equal(markdownToHtml('** pas gras **'), '<p>** pas gras **</p>');
  assert.equal(markdownToHtml('x *a* *b* y'), '<p>x <em>a</em> <em>b</em> y</p>');
  assert.equal(markdownToHtml("l'*accent*"), '<p>l&#39;<em>accent</em></p>');
});

test('markdownToHtml — caractère NUL de l’entrée ignoré (pas de faux jeton de lien)', () => {
  const out = markdownToHtml('texte \u00000\u0000 [a](https://a.fr)');
  assert.ok(!out.includes('\u0000'));
  assert.equal((out.match(/<a /g) || []).length, 1);
});
