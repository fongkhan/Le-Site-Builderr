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

test('payload.config — médiathèque : texte alternatif borné, suppression REST réservée aux admins', () => {
  // Bloc de la collection « media » : de son slug à la collection suivante
  const start = configSource.indexOf("slug: 'media'");
  assert.ok(start > 0, 'collection media trouvée');
  const next = configSource.indexOf('slug:', start + 1);
  const mediaBlock = configSource.slice(start, next > 0 ? next : undefined);
  assert.match(mediaBlock, /\{\s*name:\s*'alt',\s*type:\s*'text',\s*maxLength:\s*200\s*\}/);
  assert.match(mediaBlock, /\bdelete:\s*isAdmin\b/);
  assert.doesNotMatch(mediaBlock, /\bdelete:\s*isAdminOrSiteClient\b/);
  // Remplacement du fichier par PATCH REST : il effacerait l'ancien, encore cité
  assert.match(mediaBlock, /\bupdate:\s*isAdmin\b/);
  assert.doesNotMatch(mediaBlock, /\bupdate:\s*isAdminOrSiteClient\b/);
});

test('payload.config — thème : logo ramené à sa forme canonique avant validation (panel, PATCH REST)', () => {
  const start = configSource.indexOf("slug: 'themes'");
  assert.ok(start > 0, 'collection themes trouvée');
  const logo = configSource.slice(configSource.indexOf("name: 'logo'", start), configSource.indexOf("slug: 'audit_logs'"));
  assert.match(logo, /hooks:\s*\{\s*beforeValidate:\s*\[\s*\(\{ value \}: any\) => \{\s*const logo = themeLib\.normalizeLogo\(value\)/);
});
