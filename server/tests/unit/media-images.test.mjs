import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { indexMedia, mediaNameFromUrl, variantUrl, imageAttrs } from '../../../client-template/src/lib/media-images.mjs';

const require = createRequire(import.meta.url);
const { variantRelPath } = require('../../lib/media-variants.js');
const { buildMediaManifest } = require('../../lib/media-library.js');

const PREFIX = '/preview/demo/media/';
const media = indexMedia([
  { filename: 'four.jpg', alt: '  Four à céramique  ', width: 1600, height: 1067, variants: [960, 480, 480, 1600, 0, 2.5, 'x'] },
  { filename: 'tasse.jpg', alt: '', width: 1200, height: 1200, variants: [480, 960] },
  { filename: 'mon image.png', alt: 'Image', width: 2400, height: 1600, variants: [480, 960, 1600] },
  { filename: 'sans-largeur.png', alt: 'Sans', width: null, height: 10, variants: [480] },
  { filename: 'long.png', alt: 'x'.repeat(201), width: 10, height: 10 },
  { filename: 'a/b.png', alt: 'chemin' },
  { filename: 'a\\b.png', alt: 'chemin' },
  { filename: 'nul\0.png', alt: 'nul' },
  { filename: 42 },
  null,
]);

test('indexMedia — entrées nettoyées, noms dangereux ignorés', () => {
  assert.deepEqual(Object.keys(media).sort(), ['four.jpg', 'long.png', 'mon image.png', 'sans-largeur.png', 'tasse.jpg']);
  assert.deepEqual(media['four.jpg'], { alt: 'Four à céramique', width: 1600, height: 1067, variants: [480, 960] });
  assert.deepEqual(media['sans-largeur.png'], { alt: 'Sans', width: null, height: 10, variants: [] });
  assert.equal(media['long.png'].alt, '');
  assert.deepEqual(Object.keys(indexMedia(undefined)), []);
  // Aucune propriété héritée exploitable (« constructor », « __proto__ »)
  assert.equal(imageAttrs(`${PREFIX}constructor`, { media, mediaPrefix: PREFIX, fallbackAlt: 'repli' }).alt, 'repli');
  const hostile = indexMedia([{ filename: '__proto__', alt: 'piège', width: 10, height: 10 }]);
  assert.equal(Object.getPrototypeOf(hostile), null);
  assert.equal(imageAttrs(`${PREFIX}__proto__`, { media: hostile, mediaPrefix: PREFIX }).alt, 'piège');
});

test('mediaNameFromUrl — préfixe exact, nom encodé, sous-dossier et externe refusés, requête retirée', () => {
  assert.equal(mediaNameFromUrl('/preview/demo/media/four.jpg', PREFIX), 'four.jpg');
  assert.equal(mediaNameFromUrl('/preview/demo/media/mon%20image.png', PREFIX), 'mon image.png');
  assert.equal(mediaNameFromUrl('/preview/demo/media/four.jpg?v=2#x', PREFIX), 'four.jpg');
  assert.equal(mediaNameFromUrl('/preview/demo/media/w480/four.jpg', PREFIX), null);
  assert.equal(mediaNameFromUrl('https://cdn.example/media/four.jpg', PREFIX), null);
  assert.equal(mediaNameFromUrl('/media/four.jpg', PREFIX), null);
  assert.equal(mediaNameFromUrl('/preview/demo/media/%E0%A4%A.png', PREFIX), null);
  assert.equal(mediaNameFromUrl('/preview/demo/media/', PREFIX), null);
  assert.equal(mediaNameFromUrl(undefined, PREFIX), null);
});

test('imageAttrs — texte de la médiathèque prioritaire, repli, dimensions, srcset ordonné et préfixé', () => {
  assert.deepEqual(imageAttrs(`${PREFIX}four.jpg`, { media, mediaPrefix: PREFIX, fallbackAlt: 'Photo 1', sizes: '400px' }), {
    src: `${PREFIX}four.jpg`,
    alt: 'Four à céramique',
    width: 1600,
    height: 1067,
    srcset: `${PREFIX}w480/four.jpg 480w, ${PREFIX}w960/four.jpg 960w, ${PREFIX}four.jpg 1600w`,
    sizes: '400px',
  });
  // Texte vide dans la médiathèque : repli du bloc
  assert.equal(imageAttrs(`${PREFIX}tasse.jpg`, { media, mediaPrefix: PREFIX, fallbackAlt: 'Tasse expresso' }).alt, 'Tasse expresso');
  // Nom encodé dans le srcset
  assert.match(imageAttrs(`${PREFIX}mon%20image.png`, { media, mediaPrefix: PREFIX }).srcset, /\/w480\/mon%20image\.png 480w, .*mon%20image\.png 2400w$/);
  // Sans variante : dimensions, ni srcset ni sizes
  const plain = imageAttrs(`${PREFIX}sans-largeur.png`, { media, mediaPrefix: PREFIX, sizes: '400px' });
  assert.deepEqual(plain, { src: `${PREFIX}sans-largeur.png`, alt: 'Sans' });
  // Hors médiathèque (ou sans manifeste) : rien d'autre que src et le repli
  assert.deepEqual(imageAttrs('https://images.example/x.jpg', { media, mediaPrefix: PREFIX, fallbackAlt: 'Photo 2', sizes: '1px' }), { src: 'https://images.example/x.jpg', alt: 'Photo 2' });
  assert.deepEqual(imageAttrs(`${PREFIX}four.jpg`, { media: {}, mediaPrefix: PREFIX }), { src: `${PREFIX}four.jpg`, alt: '' });
});

test('variantUrl — variante annoncée seulement', () => {
  assert.equal(variantUrl(`${PREFIX}mon%20image.png`, 1600, { media, mediaPrefix: PREFIX }), `${PREFIX}w1600/mon%20image.png`);
  assert.equal(variantUrl(`${PREFIX}four.jpg`, 1600, { media, mediaPrefix: PREFIX }), `${PREFIX}four.jpg`);
  assert.equal(variantUrl('https://images.example/x.jpg', 1600, { media, mediaPrefix: PREFIX }), 'https://images.example/x.jpg');
});

test('cohérence avec le serveur — manifeste et chemins des variantes publiées', () => {
  const manifest = buildMediaManifest([{ filename: 'mon image.png', alt: 'Image', width: 2400, height: 1600 }], { sharp: () => {} });
  const index = indexMedia(manifest.docs);
  for (const w of index['mon image.png'].variants) {
    const url = variantUrl(`${PREFIX}mon%20image.png`, w, { media: index, mediaPrefix: PREFIX });
    // URL du site décodée = chemin écrit par le serveur sous dist/media/
    assert.equal(decodeURIComponent(url.slice(PREFIX.length)), variantRelPath(w, 'mon image.png'));
  }
});
