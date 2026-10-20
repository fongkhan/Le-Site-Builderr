import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  variantWidths,
  variantWidthsFor,
  variantRelPath,
  loadSharp,
  writeMediaVariants,
  publishMediaFiles,
} = require('../../lib/media-variants.js');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'media-variants-'));
const realSharp = loadSharp();

test('variantWidths — largeurs nettement plus petites que l’original, formats redimensionnables', () => {
  assert.deepEqual(variantWidths(2400, 'a.jpg'), [480, 960, 1600]);
  assert.deepEqual(variantWidths(1200, 'a.png'), [480, 960]);
  assert.deepEqual(variantWidths(1000, 'a.webp'), [480]);
  assert.deepEqual(variantWidths(500, 'a.jpg'), []);
  assert.deepEqual(variantWidths(2400, 'a.gif'), []);
  assert.deepEqual(variantWidths(2400, 'a.svg'), []);
  assert.deepEqual(variantWidths(null, 'a.jpg'), []);
  assert.deepEqual(variantWidths(2400.5, 'a.jpg'), []);
  assert.deepEqual(variantWidths(2400, 'A.JPEG'), [480, 960, 1600]);
});

test('variantWidthsFor — aucune variante annoncée sans sharp', () => {
  const doc = { filename: 'a.jpg', width: 2400 };
  assert.deepEqual(variantWidthsFor(doc, { sharp: null }), []);
  assert.deepEqual(variantWidthsFor(doc, { sharp: () => {} }), [480, 960, 1600]);
  assert.deepEqual(variantWidthsFor(null, { sharp: () => {} }), []);
});

test('variantRelPath — w<largeur>/<nom simple>', () => {
  assert.equal(variantRelPath(480, 'four.jpg'), 'w480/four.jpg');
  assert.equal(variantRelPath(960, '../../etc/x.png'), 'w960/x.png');
});

test('writeMediaVariants (vrai sharp) — PNG et JPEG redimensionnés, même format, plus légers', { skip: realSharp ? false : 'sharp indisponible' }, async () => {
  const dir = tmpDir();
  try {
    for (const [name, format] of [['photo.png', 'png'], ['photo.jpg', 'jpeg']]) {
      const src = path.join(dir, name);
      // Dégradé légèrement bruité (reproductible) : un aplat se compresserait trop bien
      // pour comparer les tailles
      const raw = Buffer.alloc(1200 * 800 * 3);
      let seed = 42;
      for (let y = 0; y < 800; y++) {
        for (let x = 0; x < 1200; x++) {
          const i = (y * 1200 + x) * 3;
          seed = (seed * 1103515245 + 12345) >>> 0;
          const noise = seed >>> 28;
          raw[i] = (Math.floor((x * 255) / 1200) + noise) & 255;
          raw[i + 1] = (Math.floor((y * 255) / 800) + noise) & 255;
          raw[i + 2] = (x + y) & 255;
        }
      }
      await realSharp(raw, { raw: { width: 1200, height: 800, channels: 3 } }).toFormat(format).toFile(src);
      const out = path.join(dir, 'out');
      const result = await writeMediaVariants(src, out, name, [480, 960], { sharp: realSharp });
      assert.deepEqual(result, { resized: 2, copied: 0 });
      for (const w of [480, 960]) {
        const file = path.join(out, `w${w}`, name);
        const meta = await realSharp(file).metadata();
        assert.equal(meta.width, w, `${name} w${w}`);
        assert.equal(meta.format, format);
        assert.ok(fs.statSync(file).size < fs.statSync(src).size, `${name} w${w} pas plus léger`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeMediaVariants — sans sharp, en échec ou image multipage : copies identiques', async () => {
  const dir = tmpDir();
  try {
    const src = path.join(dir, 'a.png');
    fs.writeFileSync(src, 'contenu-original');
    const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

    assert.deepEqual(await writeMediaVariants(src, path.join(dir, 'sans'), 'a.png', [480, 960], { sharp: null }), { resized: 0, copied: 2 });
    assert.equal(read('sans/w480/a.png'), 'contenu-original');
    assert.equal(read('sans/w960/a.png'), 'contenu-original');

    const failing = () => ({
      metadata: async () => ({ pages: 1 }),
      rotate() { return this; },
      resize() { return this; },
      toBuffer: async () => { throw new Error('format inconnu'); },
    });
    assert.deepEqual(await writeMediaVariants(src, path.join(dir, 'echec'), 'a.png', [480], { sharp: failing }), { resized: 0, copied: 1 });
    assert.equal(read('echec/w480/a.png'), 'contenu-original');

    let resizeCalls = 0;
    const animated = () => ({
      metadata: async () => ({ pages: 2 }),
      rotate() { return this; },
      resize() { resizeCalls++; return this; },
      toBuffer: async () => Buffer.from('redimensionne'),
    });
    assert.deepEqual(await writeMediaVariants(src, path.join(dir, 'anim'), 'a.png', [480], { sharp: animated }), { resized: 0, copied: 1 });
    assert.equal(resizeCalls, 0);
    assert.equal(read('anim/w480/a.png'), 'contenu-original');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publishMediaFiles — originaux copiés, variantes écrites, noms ignorés ou introuvables listés', async () => {
  const dir = tmpDir();
  try {
    const uploads = path.join(dir, 'uploads');
    const out = path.join(dir, 'dist', 'media');
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, 'grande.jpg'), 'G');
    fs.writeFileSync(path.join(uploads, 'petite.png'), 'P');
    fs.writeFileSync(path.join(uploads, 'autre-site.png'), 'X');
    const ownedDocs = new Map([
      ['grande.jpg', { filename: 'grande.jpg', width: 2400 }],
      ['petite.png', { filename: 'petite.png', width: 300 }],
      ['disparue.png', { filename: 'disparue.png', width: 2400 }],
    ]);
    const resizer = () => ({
      metadata: async () => ({ pages: 1 }),
      rotate() { return this; },
      resize() { return this; },
      toBuffer: async () => Buffer.from('R'),
    });
    const result = await publishMediaFiles({
      names: ['grande.jpg', 'petite.png', 'autre-site.png', 'disparue.png'],
      ownedDocs,
      uploadsDir: uploads,
      outDir: out,
      sharp: resizer,
    });
    assert.deepEqual(result, { copied: 2, ignored: ['autre-site.png'], missing: ['disparue.png'], resized: 3, variantCopies: 0 });
    assert.equal(fs.readFileSync(path.join(out, 'grande.jpg'), 'utf-8'), 'G');
    assert.equal(fs.readFileSync(path.join(out, 'w1600', 'grande.jpg'), 'utf-8'), 'R');
    assert.ok(!fs.existsSync(path.join(out, 'autre-site.png')), 'fichier d’un autre site publié');
    assert.ok(!fs.existsSync(path.join(out, 'w480', 'petite.png')), 'variante plus large que l’original');

    // Sans sharp : originaux seulement, aucune variante (aucune n'est annoncée non plus)
    const out2 = path.join(dir, 'dist2', 'media');
    const plain = await publishMediaFiles({ names: ['grande.jpg'], ownedDocs, uploadsDir: uploads, outDir: out2, sharp: null });
    assert.deepEqual(plain, { copied: 1, ignored: [], missing: [], resized: 0, variantCopies: 0 });
    assert.ok(!fs.existsSync(path.join(out2, 'w480')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
