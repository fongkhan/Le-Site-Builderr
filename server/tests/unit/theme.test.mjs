import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateTheme, isHexColor, isCssDimension } = require('../../lib/theme.js');

const VALID = {
  colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' },
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  radius: '12px',
};

test('validateTheme — thème par défaut valide', () => {
  assert.equal(validateTheme(VALID).ok, true);
  assert.equal(validateTheme({ ...VALID, radius: '0' }).ok, true);
  assert.equal(validateTheme({ ...VALID, radius: '0.5rem' }).ok, true);
  assert.equal(validateTheme({ ...VALID, colors: { ...VALID.colors, primary: '#abc' } }).ok, true);
});

test('validateTheme — injection CSS via radius rejetée', () => {
  const r = validateTheme({ ...VALID, radius: '12px;} body{display:none}' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Rayon/);
});

test('validateTheme — couleur non-hex rejetée (bloque url()/nom/rgb)', () => {
  assert.equal(validateTheme({ ...VALID, colors: { ...VALID.colors, primary: 'red' } }).ok, false);
  assert.equal(validateTheme({ ...VALID, colors: { ...VALID.colors, text: 'url(evil)' } }).ok, false);
  assert.equal(validateTheme({ ...VALID, colors: { ...VALID.colors, background: '#12' } }).ok, false);
});

test('validateTheme — police hors allowlist rejetée', () => {
  assert.equal(validateTheme({ ...VALID, fonts: { heading: 'Comic Sans', body: 'Inter' } }).ok, false);
  assert.equal(validateTheme({ ...VALID, fonts: { heading: 'Inter', body: 'Wingdings' } }).ok, false);
});

test('validateTheme — structures manquantes rejetées', () => {
  assert.equal(validateTheme(null).ok, false);
  assert.equal(validateTheme({}).ok, false);
  assert.equal(validateTheme({ colors: VALID.colors, fonts: VALID.fonts }).ok, false); // radius manquant
});

test('isHexColor / isCssDimension', () => {
  assert.equal(isHexColor('#fff'), true);
  assert.equal(isHexColor('#FFFFFFFF'), true);
  assert.equal(isHexColor('white'), false);
  assert.equal(isCssDimension('0'), true);
  assert.equal(isCssDimension('8px'), true);
  assert.equal(isCssDimension('1.5rem'), true);
  assert.equal(isCssDimension('12'), false);
  assert.equal(isCssDimension('calc(1px + 2px)'), false);
});
