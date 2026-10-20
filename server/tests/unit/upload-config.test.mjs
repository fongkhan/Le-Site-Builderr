import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// payload.config.ts ne se charge pas sans base ni TypeScript : contrôle du source.
const configSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../payload.config.ts'),
  'utf-8'
);
const uploadBlock = (configSource.match(/\n {2}upload: \{([\s\S]*?)\n {2}\},/) || [])[1] || '';

test('payload.config — téléversements en mémoire : aucun fichier temporaire laissé par une requête refusée', () => {
  assert.ok(uploadBlock, 'clé racine upload trouvée');
  assert.match(uploadBlock, /useTempFiles:\s*false/);
  assert.doesNotMatch(uploadBlock, /tempFileDir/);
});

test('payload.config — un seul fichier par requête et taille bornée', () => {
  assert.match(uploadBlock, /limits:\s*\{[^}]*fileSize:[^}]*\bfiles:\s*1\b/);
  assert.match(uploadBlock, /abortOnLimit:\s*true/);
});

test('payload.config — médiathèque : AVIF accepté, jamais de SVG', () => {
  const mime = (configSource.match(/mimeTypes:\s*\[([^\]]*)\]/) || [])[1] || '';
  assert.match(mime, /'image\/avif'/);
  assert.doesNotMatch(mime, /svg|image\/\*/);
});
