import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { autoFitSizes } from '../../../client-template/src/lib/grid-sizes.mjs';

const GALLERY = { minWidth: 250, gap: 20 };
const PRODUCTS = { minWidth: 280, gap: 30 };

// Largeur d'une colonne de la grille auto-fit (CSS) pour `count` éléments à la largeur
// d'écran `vw` : conteneur min(1200, vw − 40), colonnes vides supprimées.
function columnWidth(count, vw, { minWidth, gap }) {
  const width = Math.min(1200, vw - 40);
  const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (minWidth + gap))));
  return (width - (columns - 1) * gap) / columns;
}

// Largeur annoncée par sizes à la largeur d'écran `vw` (première condition satisfaite).
function sizesWidth(sizes, vw) {
  for (const part of sizes.split(', ')) {
    const m = /^\(max-width: (\d+)px\) (.+)$/.exec(part);
    if (m && vw > Number(m[1])) continue;
    const length = m ? m[2] : part;
    if (/^\d+px$/.test(length)) return Number.parseInt(length, 10);
    const calc = /^calc\(\(?100vw - (\d+)px\)?(?: \/ (\d+))?\)$/.exec(length);
    assert.ok(calc, `longueur inattendue : ${length}`);
    return (vw - Number(calc[1])) / Number(calc[2] || 1);
  }
  throw new Error('aucune condition satisfaite');
}

test('autoFitSizes — une image seule occupe toute la largeur, deux images la moitié', () => {
  assert.equal(autoFitSizes(1, GALLERY), '(max-width: 1239px) calc(100vw - 40px), 1200px');
  assert.equal(autoFitSizes(2, GALLERY), '(max-width: 559px) calc(100vw - 40px), (max-width: 1239px) calc((100vw - 60px) / 2), 590px');
  assert.equal(autoFitSizes(1, PRODUCTS), '(max-width: 1239px) calc(100vw - 40px), 1200px');
  // Au-delà des colonnes qui tiennent dans 1200 px : même valeur quel que soit le nombre
  assert.equal(autoFitSizes(12, GALLERY), autoFitSizes(4, GALLERY));
  assert.equal(autoFitSizes(9, PRODUCTS), autoFitSizes(3, PRODUCTS));
  // Nombre absent ou nul : traité comme un élément
  assert.equal(autoFitSizes(0, GALLERY), autoFitSizes(1, GALLERY));
  assert.equal(autoFitSizes(undefined, GALLERY), autoFitSizes(1, GALLERY));
});

test('autoFitSizes — largeur annoncée égale à la colonne réelle, de 320 à 2560 px d’écran', () => {
  for (const grid of [GALLERY, PRODUCTS]) {
    for (let count = 1; count <= 6; count++) {
      const sizes = autoFitSizes(count, grid);
      for (let vw = 320; vw <= 2560; vw += 7) {
        const expected = columnWidth(count, vw, grid);
        const announced = sizesWidth(sizes, vw);
        assert.ok(announced >= expected - 0.01 && announced <= expected + 1, `${count} élément(s), écran ${vw}px : sizes ${announced} pour une colonne de ${expected} (${sizes})`);
      }
    }
  }
});

test('Gallery.astro / ProductGrid.astro — sizes calculé par autoFitSizes selon les éléments rendus', () => {
  const read = (name) => fs.readFileSync(new URL(`../../../client-template/src/components/blocks/${name}`, import.meta.url), 'utf-8');
  const gallery = read('Gallery.astro');
  assert.match(gallery, /autoFitSizes\(sources\.length, \{ minWidth: 250, gap: 20 \}\)/);
  assert.match(gallery, /repeat\(auto-fit, minmax\(250px, 1fr\)\);\s*gap: 20px;/);
  const products = read('ProductGrid.astro');
  assert.match(products, /autoFitSizes\(items\.length, \{ minWidth: 280, gap: 30 \}\)/);
  assert.match(products, /repeat\(auto-fit, minmax\(280px, 1fr\)\);\s*gap: 30px;/);
  for (const source of [gallery, products]) assert.doesNotMatch(source, /sizes: '\(max-width/);
});
