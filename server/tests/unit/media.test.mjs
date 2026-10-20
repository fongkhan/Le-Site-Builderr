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

test('remapMediaFilenames — nouveau nom avec parenthèses ou apostrophe : encodé en entier, relu sans troncature', () => {
  const { remapMediaFilenames, collectMediaFilenames, encodeMediaName } = require('../../lib/media.js');
  const out = remapMediaFilenames({ logo: '/api/media/file/logo.png', md: '![x](/media/logo.png)' }, { 'logo.png': "logo (1)-l'ancien.png" });
  assert.equal(out.logo, '/api/media/file/logo%20%281%29-l%27ancien.png');
  assert.equal(out.md, '![x](/media/logo%20%281%29-l%27ancien.png)');
  assert.deepEqual(collectMediaFilenames(out), ["logo (1)-l'ancien.png"]);
  assert.equal(encodeMediaName("a(b)'c*!.png"), 'a%28b%29%27c%2A%21.png');
  // Même encodage que le logo du thème (lib/theme.js le réexporte)
  assert.equal(require('../../lib/theme.js').encodeMediaName, encodeMediaName);
});

// Ancienne forme (encodeURIComponent, doc.url de Payload) : ( ) ' en clair dans le nom
test('collectMediaFilenames — ancienne forme : parenthèses et apostrophe lues en entier, délimiteurs respectés', () => {
  assert.deepEqual(collectMediaFilenames('/api/media/file/photo%20(1).png'), ['photo (1).png']);
  assert.deepEqual(collectMediaFilenames("/api/media/file/l'atelier.png"), ["l'atelier.png"]);
  assert.deepEqual(collectMediaFilenames("/media/Capture%20d'%C3%A9cran%20(2).jpg"), ["Capture d'écran (2).jpg"]);
  assert.deepEqual(collectMediaFilenames('/api/media/file/photo%20%281%29.png'), ['photo (1).png']);
  // Lien Markdown, attributs HTML, url('…'), texte entre parenthèses : le délimiteur reste dehors
  assert.deepEqual(collectMediaFilenames('![Four](/api/media/file/photo%20(2).jpg) et (voir /media/c.png)').sort(), ['c.png', 'photo (2).jpg']);
  assert.deepEqual(collectMediaFilenames("<img src='/media/a.png'> <div style=\"background:url('/media/b.png')\">").sort(), ['a.png', 'b.png']);
  assert.deepEqual(collectMediaFilenames('[x](/media/l%27atelier.png)'), ["l'atelier.png"]);
});

test('remapMediaFilenames — ancienne forme : nom complet renommé (duplication, restauration)', () => {
  const { remapMediaFilenames } = require('../../lib/media.js');
  const out = remapMediaFilenames(
    { hero: '/api/media/file/photo%20(1).png', md: "![x](/media/l'atelier.png)" },
    { 'photo (1).png': 'photo (1)-1.png', "l'atelier.png": "l'atelier-1.png" },
  );
  assert.deepEqual(out, { hero: '/api/media/file/photo%20%281%29-1.png', md: '![x](/media/l%27atelier-1.png)' });
});

test('citedMediaNames — noms connus reconnus sous toutes les formes, même avec une parenthèse fermante seule', () => {
  const { citedMediaNames } = require('../../lib/media.js');
  const names = ['smiley :).png', 'photo (1).png', 'libre.png'];
  const value = { a: '/api/media/file/smiley%20%3A).png', b: ['![x](/media/photo%20(1).png)'], c: 'https://cdn.example/x.png' };
  assert.deepEqual([...citedMediaNames(value, names)].sort(), ['photo (1).png', 'smiley :).png']);
  assert.deepEqual([...citedMediaNames(value, [])], []);
  assert.deepEqual([...citedMediaNames(null, names)], []);
  // L'extraction seule tronque ce nom : citedMediaNames le retrouve
  assert.deepEqual(collectMediaFilenames(value.a), ['smiley :']);
  // Contenu hostile (une URL suivie de 50 000 « ) ») : travail borné, réponse immédiate
  const started = Date.now();
  assert.deepEqual([...citedMediaNames({ a: `/media/x${')'.repeat(50000)}`, b: `/media/${"'".repeat(50000)}` }, names)], []);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

test('canonicalMediaUrls — URL relatives /api/media/file réencodées (encodeMediaName), le reste inchangé, sans muter l’entrée', () => {
  const { canonicalMediaUrls } = require('../../lib/media.js');
  const input = {
    hero: '/api/media/file/photo%20(1).png',
    body: "Texte ![Atelier](/api/media/file/l'atelier.png) et <img src=\"/api/media/file/caf%c3%a9.png\">",
    images: [{ url: '/api/media/file/photo%20%281%29.png' }, 'https://cdn.example/api/media/file/x(1).png', '/media/y(1).png'],
    invalid: '/api/media/file/100%.png',
    n: 3,
    nul: null,
  };
  const snapshot = JSON.stringify(input);
  const out = canonicalMediaUrls(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(out, {
    hero: '/api/media/file/photo%20%281%29.png',
    body: 'Texte ![Atelier](/api/media/file/l%27atelier.png) et <img src="/api/media/file/caf%C3%A9.png">',
    images: [{ url: '/api/media/file/photo%20%281%29.png' }, 'https://cdn.example/api/media/file/x(1).png', '/media/y(1).png'],
    invalid: '/api/media/file/100%.png',
    n: 3,
    nul: null,
  });
  // Idempotent
  assert.deepEqual(canonicalMediaUrls(out), out);
});
