import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rewriteMediaUrls, collectMediaFilenames } = require('../../lib/media.js');

test('rewriteMediaUrls — réécrit les URLs API en URLs statiques, sans muter l’entrée', () => {
  const input = {
    docs: [{
      layout: [
        { blockType: 'hero', backgroundImage: '/api/media/file/photo.jpg' },
        { blockType: 'gallery', images: ['/api/media/file/a.png', 'https://exemple.fr/externe.jpg'] },
      ],
    }],
  };
  const out = rewriteMediaUrls(input);
  assert.equal(out.docs[0].layout[0].backgroundImage, '/media/photo.jpg');
  assert.equal(out.docs[0].layout[1].images[0], '/media/a.png');
  assert.equal(out.docs[0].layout[1].images[1], 'https://exemple.fr/externe.jpg');
  // l'entrée n'a pas bougé
  assert.equal(input.docs[0].layout[0].backgroundImage, '/api/media/file/photo.jpg');
});

test('collectMediaFilenames — trouve les deux formes, ignore les URLs externes', () => {
  const names = collectMediaFilenames({
    a: '/api/media/file/logo.webp',
    b: 'texte avec /media/banner.jpg au milieu',
    c: 'https://images.unsplash.com/photo-123',
    d: ['/media/dup.png', '/api/media/file/dup.png'],
  });
  assert.deepEqual(names.sort(), ['banner.jpg', 'dup.png', 'logo.webp']);
});

test('collectMediaFilenames — neutralise les traversées de chemin et l’encodage', () => {
  const names = collectMediaFilenames({
    evil: '/api/media/file/..%2F..%2Fetc%2Fpasswd',
    evil2: '/media/../../secret.txt',
  });
  for (const n of names) {
    assert.ok(!n.includes('/') && !n.includes('..'), `nom non confiné : ${n}`);
  }
});

test('rewriteMediaUrls — préfixe de publication sous un sous-chemin', async () => {
  const { rewriteMediaUrls, mediaPrefixFor } = require('../../lib/media.js');
  assert.equal(mediaPrefixFor('/'), '/media/');
  assert.equal(mediaPrefixFor('/preview/mon-site'), '/preview/mon-site/media/');
  assert.equal(mediaPrefixFor('/preview/mon-site/'), '/preview/mon-site/media/');
  const out = rewriteMediaUrls({ a: ['/api/media/file/x.png'] }, mediaPrefixFor('/draft/s'));
  assert.deepEqual(out, { a: ['/draft/s/media/x.png'] });
});

test('remapMediaFilenames — renomme les deux formes, noms encodés et objets imbriqués, sans muter l’entrée', () => {
  const { remapMediaFilenames } = require('../../lib/media.js');
  const input = {
    docs: [{
      layout: [
        { blockType: 'hero', backgroundImage: '/api/media/file/photo.jpg' },
        { blockType: 'gallery', images: ['/media/a.png', '/api/media/file/mon%20image.png?w=2', 'https://exemple.fr/media/autre.png'] },
        { blockType: 'text', body: 'Voir <img src="/api/media/file/photo.jpg"> et /media/inconnu.png' },
      ],
    }],
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = remapMediaFilenames(input, { 'photo.jpg': 'photo-1.jpg', 'a.png': 'a-1.png', 'mon image.png': 'mon image-1.png' });
  assert.equal(out.docs[0].layout[0].backgroundImage, '/api/media/file/photo-1.jpg');
  assert.equal(out.docs[0].layout[1].images[0], '/media/a-1.png');
  assert.equal(out.docs[0].layout[1].images[1], '/api/media/file/mon%20image-1.png?w=2');
  assert.equal(out.docs[0].layout[1].images[2], 'https://exemple.fr/media/autre.png');
  assert.equal(out.docs[0].layout[2].body, 'Voir <img src="/api/media/file/photo-1.jpg"> et /media/inconnu.png');
  assert.deepEqual(input, snapshot, 'entrée intacte');
  assert.notEqual(out, input);
});

test('remapMediaFilenames — table vide ou Map, valeurs non textuelles inchangées', () => {
  const { remapMediaFilenames } = require('../../lib/media.js');
  assert.deepEqual(remapMediaFilenames({ a: '/media/x.png', n: 3, b: null }, {}), { a: '/media/x.png', n: 3, b: null });
  assert.deepEqual(remapMediaFilenames(['/media/x.png', true], new Map([['x.png', 'y.png']])), ['/media/y.png', true]);
});
