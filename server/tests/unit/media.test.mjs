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
