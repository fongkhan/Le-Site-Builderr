import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPublishableMediaName } = require('../../lib/media-policy.js');

test('isPublishableMediaName — images matricielles acceptées, casse ignorée', () => {
  for (const name of ['photo.png', 'a.JPG', 'b.jpeg', 'c.webp', 'd.gif']) {
    assert.equal(isPublishableMediaName(name), true, name);
  }
});

test('isPublishableMediaName — SVG et formats interprétables refusés, sur la dernière extension', () => {
  for (const name of ['logo.svg', 'x.svgz', 'a.png.svg', 'page.html', 'f.xml', 'x.xsl', 'sans-extension', 'fin.', '.png', '']) {
    assert.equal(isPublishableMediaName(name), false, name);
  }
});

test('isPublishableMediaName — jamais de chemin ni de valeur non textuelle', () => {
  for (const name of ['../a.png', 'dir/a.png', 'dir\\a.png', null, undefined, 42, {}]) {
    assert.equal(isPublishableMediaName(name), false, String(name));
  }
});
