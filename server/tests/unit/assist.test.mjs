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
