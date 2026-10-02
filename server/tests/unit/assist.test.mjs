import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runAssist } = require('../../ai.js');

// Ces cas échouent AVANT tout appel réseau (validation en amont) : testables sans clé IA.

test('runAssist — action inconnue rejetée', async () => {
  await assert.rejects(() => runAssist('openai', { action: 'pirater', input: 'x' }), /inconnue/);
});

test('runAssist — rewrite sans texte rejeté', async () => {
  await assert.rejects(() => runAssist('openai', { action: 'rewrite', input: '   ' }), /améliorer/);
});

const { cleanAndParseJSON, parseBase64Image, normalizeOnboardResult } = require('../../ai.js');

test('cleanAndParseJSON — blocs markdown et texte autour', () => {
  assert.deepEqual(cleanAndParseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(cleanAndParseJSON('Voici le résultat : {"a":2} — bonne journée'), { a: 2 });
  assert.throws(() => cleanAndParseJSON('pas de json'));
});

test('parseBase64Image — formats web uniquement, taille bornée', () => {
  assert.deepEqual(parseBase64Image('data:image/png;base64,iVBORw0KGgo='), { mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' });
  assert.equal(parseBase64Image('data:application/pdf;base64,JVBERi0='), null);
  assert.equal(parseBase64Image('data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024)), null);
  assert.equal(parseBase64Image(''), null);
  assert.equal(parseBase64Image(42), null);
});

test('normalizeOnboardResult — sortie IA incomplète rendue exploitable', () => {
  const out = normalizeOnboardResult({}, { name: 'Coiffeur Lyon', features: { blog_or_news: true } });
  assert.equal(out.qualification.site_name, 'Coiffeur Lyon');
  assert.equal(out.qualification.features.blog_or_news, true);
  assert.equal(out.qualification.stack_requirements.astro_mode, 'ssg');
  assert.equal(out.pages, null); // → pages de départ côté appelant
  assert.equal(out.theme, null); // → thème par défaut côté appelant
});

test('normalizeOnboardResult — blocs inconnus écartés, thème invalide refusé', () => {
  const out = normalizeOnboardResult({
    qualification: { site_name: 'Mon site', stack_requirements: { astro_mode: 'hybrid', need_payload: 1 } },
    pages: { docs: [{ title: 'Accueil', slug: 'Accueil !', layout: [{ blockType: 'hero', title: 'Bonjour' }, { blockType: 'script', html: '<script>' }] }] },
    theme: { colors: { primary: 'red;}body{', secondary: '#fff', background: '#fff', text: '#000' }, fonts: { heading: 'Inter', body: 'Inter' }, radius: '8px' },
  });
  assert.equal(out.qualification.stack_requirements.astro_mode, 'hybrid');
  assert.equal(out.qualification.stack_requirements.need_payload, true);
  assert.deepEqual(out.pages.docs[0].layout.map((b) => b.blockType), ['hero']);
  assert.equal(out.pages.docs[0].slug, 'home');
  assert.equal(out.theme, null);
});

test('normalizeOnboardResult — slugs de pages dédoublonnés', () => {
  const block = { blockType: 'hero', title: 'x' };
  const out = normalizeOnboardResult({ pages: { docs: [
    { title: 'A', slug: 'home', layout: [block] },
    { title: 'B', slug: 'home', layout: [block] },
    { title: 'C', slug: 'home', layout: [block] },
  ] } }, { name: 'X' });
  assert.deepEqual(out.pages.docs.map((p) => p.slug), ['home', 'home-2', 'home-3']);
});
