import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Icône d'onglet générée par le template (site sans logo) : initiales, couleur lue dans
// theme.css, SVG et favicon.ico (PNG dans un conteneur ICO).
const { initials, themeCssColor, monogramSvg } = await import('../../../client-template/src/lib/monogram.mjs');
const { solidIconPng, icoFromPng } = await import('../../../client-template/src/lib/ico.mjs');

test('initials — deux premiers mots, Unicode, jamais de balisage', () => {
  assert.equal(initials('Demo'), 'D');
  assert.equal(initials('Boulangerie Artisanale Clamart'), 'BA');
  assert.equal(initials(' école du Port'), 'ÉD');
  assert.equal(initials('école du Port'), 'ÉD'); // forme décomposée : marque conservée
  assert.equal(initials("l'Atelier 3 Fours"), 'L3');
  assert.ok(!initials('<script>x</script>').includes('<'));
  assert.equal(initials(''), '•');
  assert.equal(initials('🥖'), '•');
  assert.equal(initials(undefined), '•');
});

test('themeCssColor — variable exacte, jamais --color-primary-deep à la place de --color-primary', () => {
  const css = ':root {\n  --color-primary-deep: #5a3b1c;\n  --color-primary: #8B5A2B;\n  --color-on-primary: #ffffff;\n}';
  assert.equal(themeCssColor(css, 'primary'), '#8B5A2B');
  assert.equal(themeCssColor(css, 'primary-deep'), '#5a3b1c');
  assert.equal(themeCssColor(css, 'on-primary'), '#ffffff');
  assert.equal(themeCssColor(':root { --color-primary-deep: #5a3b1c; }', 'primary'), null);
  assert.equal(themeCssColor(':root { --color-primary: url(x); }', 'primary'), null);
  assert.equal(themeCssColor(':root { --color-primary: #12; }', 'primary'), null);
  assert.equal(themeCssColor(css, 'primary)|(.'), null);
  assert.equal(themeCssColor(null, 'primary'), null);
});

test('monogramSvg — couleurs du thème, initiales échappées, replis sûrs', () => {
  const svg = monogramSvg({ name: 'Demo', background: '#8B5A2B', foreground: '#111111' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('fill="#8B5A2B"'));
  assert.ok(svg.includes('fill="#111111"'));
  assert.ok(svg.includes('>D<'));
  assert.ok(svg.includes('font-size="36"'));
  assert.ok(monogramSvg({ name: 'Atelier Démo' }).includes('font-size="28"'));
  const fallback = monogramSvg({ name: '<b>', background: 'red" onload="x', foreground: 'url(x)' });
  assert.ok(fallback.includes('fill="#3b82f6"'));
  assert.ok(fallback.includes('fill="#ffffff"'));
  assert.ok(!fallback.includes('onload'));
  assert.ok(!fallback.includes('<b>'));
  assert.ok(monogramSvg({ name: '' }).includes('>•<'));
});

// Lit un PNG RGBA non entrelacé (filtre « None » sur chaque ligne, comme solidIconPng).
function decodePng(png) {
  let offset = 8;
  let width = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') width = data.readUInt32BE(0);
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  return (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)];
}

test('favicon.ico — conteneur ICO valide, PNG à la couleur primaire aux coins transparents', () => {
  const png = solidIconPng('#8B5A2B');
  const ico = icoFromPng(png, 32);
  assert.deepEqual([...ico.subarray(0, 6)], [0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
  assert.equal(ico[6], 32);
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.deepEqual([...ico.subarray(22, 30)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pixel = decodePng(ico.subarray(22));
  assert.deepEqual(pixel(16, 16), [0x8b, 0x5a, 0x2b, 255]);
  assert.equal(pixel(0, 0)[3], 0);
  assert.equal(pixel(31, 31)[3], 0);
  assert.equal(pixel(16, 0)[3], 255); // bord droit : opaque hors des coins
  // Couleur invalide : bleu par défaut, jamais d'exception
  assert.deepEqual(decodePng(solidIconPng('pas-une-couleur'))(16, 16), [0x3b, 0x82, 0xf6, 255]);
});
