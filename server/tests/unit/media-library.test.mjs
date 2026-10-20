import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ALT_MAX,
  cleanAlt,
  isPayloadMediaId,
  mediaUsage,
  usageLabel,
  usageMessage,
  summarizeNames,
  toLibraryItem,
  buildMediaManifest,
} = require('../../lib/media-library.js');

test('cleanAlt — caractères de contrôle, blancs, 200 caractères, non-chaîne → null', () => {
  assert.equal(cleanAlt('  Pixel\n de\ttest  '), 'Pixel de test');
  assert.equal(cleanAlt('a\u0000b\u007fc'), 'a b c');
  assert.equal(cleanAlt(''), '');
  assert.equal(cleanAlt('x'.repeat(300)).length, ALT_MAX);
  // Troncature puis nettoyage : jamais d'espace final
  assert.equal(cleanAlt(`${'x'.repeat(199)} y`), 'x'.repeat(199));
  for (const v of [42, null, undefined, {}, ['a']]) assert.equal(cleanAlt(v), null);
});

test('isPayloadMediaId — entier de 1 à 15 chiffres', () => {
  assert.ok(isPayloadMediaId('1'));
  assert.ok(isPayloadMediaId('123456789012345'));
  for (const v of ['', 'abc', '1.5', '-1', '1234567890123456', ' 1', 12]) assert.equal(isPayloadMediaId(v), false, String(v));
});

test('mediaUsage — deux formes d’URL, nom encodé, page anglaise, article brouillon, sans mutation', () => {
  const pages = [
    { title: 'Accueil', slug: 'home', locale: 'fr', layout: [{ blockType: 'hero', backgroundImage: '/api/media/file/four.jpg' }] },
    { title: 'Home', slug: 'home', locale: 'en', layout: [{ blockType: 'gallery', images: ['/media/mon%20image.png', 'https://cdn.example/x.jpg'] }] },
    { title: '', slug: 'vide', layout: [] },
  ];
  const posts = [
    { title: 'Noël', slug: 'noel', status: 'draft', coverImage: '/api/media/file/four.jpg' },
    { title: 'Ouverture', slug: 'ouverture', status: 'published', body: '![x](/api/media/file/mon%20image.png)' },
  ];
  const snapshot = JSON.stringify({ pages, posts });
  const usage = mediaUsage(['four.jpg', 'mon image.png', 'inutile.png'], pages, posts);
  assert.equal(JSON.stringify({ pages, posts }), snapshot, 'entrées modifiées');
  assert.deepEqual(usage.get('four.jpg'), [
    { type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' },
    { type: 'post', title: 'Noël', slug: 'noel', draft: true },
  ]);
  assert.deepEqual(usage.get('mon image.png'), [
    { type: 'page', title: 'Home', slug: 'home', locale: 'en' },
    { type: 'post', title: 'Ouverture', slug: 'ouverture', draft: false },
  ]);
  assert.deepEqual(usage.get('inutile.png'), []);
  // Un nom non demandé n'apparaît jamais
  assert.equal(usage.has('x.jpg'), false);
});

test('mediaUsage — logo du thème : usage « Logo du site » (nom encodé), thème absent ou sans logo ignoré', () => {
  const pages = [{ title: 'Accueil', slug: 'home', locale: 'fr', layout: [{ blockType: 'hero', backgroundImage: '/api/media/file/four.jpg' }] }];
  const theme = { colors: {}, logo: '/api/media/file/logo%20%281%29.png' };
  const usage = mediaUsage(['four.jpg', 'logo (1).png', 'libre.png'], pages, [], theme);
  assert.deepEqual(usage.get('logo (1).png'), [{ type: 'theme', title: 'Logo du site', slug: '' }]);
  assert.deepEqual(usage.get('four.jpg'), [{ type: 'page', title: 'Accueil', slug: 'home', locale: 'fr' }]);
  assert.deepEqual(usage.get('libre.png'), []);
  // Le logo cite aussi une image d'une page : deux usages
  assert.equal(mediaUsage(['four.jpg'], pages, [], { logo: '/api/media/file/four.jpg' }).get('four.jpg').length, 2);
  for (const t of [undefined, null, {}, { logo: '' }, { logo: 42 }]) {
    assert.deepEqual(mediaUsage(['logo (1).png'], [], [], t).get('logo (1).png'), [], JSON.stringify(t));
  }
});

test('usageLabel / usageMessage — libellés et troncature à 5 usages', () => {
  assert.equal(usageLabel({ type: 'theme', title: 'Logo du site', slug: '' }), 'thème (logo)');
  assert.equal(usageMessage([{ type: 'theme', title: 'Logo du site', slug: '' }]), 'Image utilisée dans : thème (logo). Retirez-la de ces contenus avant de la supprimer.');
  assert.equal(usageLabel({ type: 'page', title: 'Accueil', locale: 'fr' }), 'page « Accueil »');
  assert.equal(usageLabel({ type: 'page', title: 'Home', locale: 'en' }), 'page « Home » (EN)');
  assert.equal(usageLabel({ type: 'post', title: 'Noël', draft: true }), 'article « Noël » (brouillon)');
  assert.equal(usageLabel({ type: 'post', title: 'Ouverture', draft: false }), 'article « Ouverture »');
  const usedIn = Array.from({ length: 7 }, (_, i) => ({ type: 'page', title: `P${i + 1}`, locale: 'fr' }));
  assert.equal(
    usageMessage(usedIn),
    'Image utilisée dans : page « P1 », page « P2 », page « P3 », page « P4 », page « P5 » et 2 autre(s). Retirez-la de ces contenus avant de la supprimer.',
  );
  assert.equal(usageMessage(usedIn.slice(0, 1)), 'Image utilisée dans : page « P1 ». Retirez-la de ces contenus avant de la supprimer.');
});

test('summarizeNames — contrôles neutralisés, 80 caractères, 10 noms au plus', () => {
  assert.equal(summarizeNames(['a.png', 'b\nc.png']), 'a.png, b?c.png');
  const twelve = Array.from({ length: 12 }, (_, i) => `n${i}.png`);
  const out = summarizeNames(twelve);
  assert.ok(out.endsWith(' … et 2 autre(s)'), out);
  assert.ok(out.includes('n9.png') && !out.includes('n10.png'), out);
  assert.equal(summarizeNames(['x'.repeat(200)]).length, 80);
  assert.equal(summarizeNames([]), '');
});

test('toLibraryItem — URL encodée et valeurs par défaut', () => {
  const item = toLibraryItem({ id: 12, filename: 'mon image.png', alt: 'Un four', width: 1600, height: 1067, filesize: 2048, mimeType: 'image/png', createdAt: '2026-10-01T00:00:00.000Z' }, [{ type: 'page' }]);
  assert.deepEqual(item, {
    id: '12',
    filename: 'mon image.png',
    url: '/api/media/file/mon%20image.png',
    alt: 'Un four',
    width: 1600,
    height: 1067,
    filesize: 2048,
    mimeType: 'image/png',
    createdAt: '2026-10-01T00:00:00.000Z',
    usedIn: [{ type: 'page' }],
  });
  const bare = toLibraryItem({ id: 3, filename: 'x.gif', alt: null, width: 0, height: 1.5, filesize: -1 });
  assert.deepEqual(
    { alt: bare.alt, width: bare.width, height: bare.height, filesize: bare.filesize, mimeType: bare.mimeType, createdAt: bare.createdAt, usedIn: bare.usedIn },
    { alt: '', width: null, height: null, filesize: null, mimeType: '', createdAt: null, usedIn: [] },
  );
});

test('buildMediaManifest — SVG exclu, sans sharp aucune variante, avec sharp les largeurs utiles', () => {
  const docs = [
    { filename: 'atelier.jpg', alt: '  Atelier\n de poterie ', width: 2400, height: 1600 },
    { filename: 'logo.svg', alt: 'Logo', width: 100, height: 100 },
    { filename: 'anim.gif', alt: '', width: 2000, height: 1000 },
    { filename: '../x.png', width: 2000, height: 1000 },
  ];
  assert.deepEqual(buildMediaManifest(docs, { sharp: null }), {
    docs: [
      { filename: 'atelier.jpg', alt: 'Atelier de poterie', width: 2400, height: 1600, variants: [] },
      { filename: 'anim.gif', alt: '', width: 2000, height: 1000, variants: [] },
    ],
  });
  const fakeSharp = () => {};
  const withSharp = buildMediaManifest(docs, { sharp: fakeSharp });
  assert.deepEqual(withSharp.docs.map((d) => [d.filename, d.variants]), [['atelier.jpg', [480, 960, 1600]], ['anim.gif', []]]);
});
