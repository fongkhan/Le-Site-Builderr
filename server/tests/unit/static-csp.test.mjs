import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { staticCspFor } = require('../../lib/static-csp.js');

const SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

test('staticCspFor — SVG, XML et XSL dans un bac à sable sans script', () => {
  for (const file of ['x.svg', 'x.XML', '/srv/site/logo.svgz', 'feuille.xsl', 'sitemap.xml']) {
    assert.equal(staticCspFor(file), SANDBOX, file);
  }
});

test('staticCspFor — pages HTML : ni plugin, ni <base> externe, ni cadre étranger', () => {
  for (const file of ['index.html', '/srv/site/contact/index.HTML']) {
    const csp = staticCspFor(file);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /sandbox/);
    // Scripts et styles du template jamais bloqués : aucune directive script/style/default
    assert.doesNotMatch(csp, /default-src|script-src|style-src/);
  }
});

test('staticCspFor — autres fichiers : aucune politique', () => {
  for (const file of ['a.css', 'img.png', 'app.js', 'robots.txt', 'page.html.png', undefined]) {
    assert.equal(staticCspFor(file), null, String(file));
  }
});
