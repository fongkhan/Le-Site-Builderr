import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filesUsingAstroAssets } from '../../../client-template/scripts/checks/garde-astro-assets.mjs';

// Garde de l'exception d'audit astro/sharp : l'optimisation d'images d'Astro (astro:assets,
// getImage) ne doit pas apparaître dans le template (contrôle de fixture du template).
test('garde astro:assets — template actuel conforme', () => {
  assert.deepEqual(filesUsingAstroAssets(), []);
});

test('garde astro:assets — import astro:assets ou appel getImage( signalé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-astro-'));
  try {
    fs.mkdirSync(path.join(dir, 'components'));
    fs.writeFileSync(path.join(dir, 'components', 'Ok.astro'), '---\nconst x = 1;\n---\n<img src="/a.png" alt="" />');
    assert.deepEqual(filesUsingAstroAssets(dir), []);
    fs.writeFileSync(path.join(dir, 'components', 'Hero.astro'), "---\nimport { Image } from 'astro:assets';\n---\n");
    fs.writeFileSync(path.join(dir, 'lib.ts'), 'export const img = await getImage({ src });');
    assert.deepEqual(filesUsingAstroAssets(dir).sort(), ['components/Hero.astro', 'lib.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
