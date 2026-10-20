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

test('polices — chaque police autorisée est auto-hébergée par le template', async () => {
  const { HEADING_FONTS, BODY_FONTS } = require('../../lib/theme.js');
  const { FONT_PACKAGES } = await import('../../../client-template/integrations/theme-fonts.mjs');
  for (const font of new Set([...HEADING_FONTS, ...BODY_FONTS])) {
    assert.ok(FONT_PACKAGES[font], `police « ${font} » sans paquet @fontsource-variable dans le template`);
  }
});

// --- Contraste (WCAG AA) et couleurs dérivées ---

const themeLib = require('../../lib/theme.js');
const DARK = { primary: '#C9A227', secondary: '#2A2A2A', background: '#111111', text: '#F2F2F2' };

test('contrastRatio — bornes WCAG et formats hex acceptés', () => {
  const { contrastRatio, hex6 } = themeLib;
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(contrastRatio('#abc', '#aabbcc'), 1);
  assert.equal(contrastRatio('#FFFFFF80', '#000'), 21); // alpha ignoré
  assert.equal(hex6('#ABC'), '#aabbcc');
  assert.equal(hex6('#11223344'), '#112233');
  assert.equal(hex6('red'), null);
});

test('readableOn — blanc d’abord, sinon gris très foncé ; AA garanti sur les 4096 #RGB', () => {
  const { readableOn, contrastRatio } = themeLib;
  assert.equal(readableOn('#8B5A2B'), '#ffffff');
  assert.equal(readableOn('#FACC15'), '#111111');
  assert.equal(readableOn('#C9A227'), '#111111');
  assert.equal(readableOn('#F5E6CC', ['#2D241E']), '#2D241E');
  for (let i = 0; i < 4096; i++) {
    const c = `#${i.toString(16).padStart(3, '0')}`;
    assert.ok(contrastRatio(readableOn(c), c) >= 4.5, c);
  }
});

test('derivedColors — thème par défaut et palette sombre', () => {
  const { derivedColors, contrastRatio } = themeLib;
  const { DEFAULT_THEME } = require('../../services/defaults.js');
  const d = derivedColors(DEFAULT_THEME.theme.colors);
  assert.equal(d.onPrimary, '#ffffff');
  assert.equal(d.onSecondary, '#2D241E');
  assert.equal(d.primaryDeep, '#5a3b1c');
  assert.equal(d.surface, '#ffffff');

  const dark = derivedColors(DARK);
  assert.equal(dark.onPrimary, '#111111');
  assert.equal(dark.onSecondary, '#F2F2F2');
  assert.equal(dark.surface, '#1f1f1f');
  assert.ok(contrastRatio(DARK.text, dark.surface) >= 4.5);

  for (const [colors, out] of [[DEFAULT_THEME.theme.colors, d], [DARK, dark]]) {
    const mutedOk = contrastRatio(out.textMuted, out.surface) >= 4.5 && contrastRatio(out.textMuted, colors.background) >= 4.5;
    assert.ok(mutedOk || out.textMuted === themeLib.hex6(colors.text), out.textMuted);
    // Le second ton du dégradé du Hero est au moins aussi lisible que la couleur primaire
    assert.ok(contrastRatio(out.onPrimary, out.primaryDeep) >= contrastRatio(out.onPrimary, colors.primary));
  }
});

test('themeContrastWarnings — seuil 4,5:1, ratio arrondi vers le bas avec virgule', () => {
  const { themeContrastWarnings } = themeLib;
  assert.deepEqual(themeContrastWarnings(VALID), []);
  assert.deepEqual(themeContrastWarnings(undefined), []);
  const grey = themeContrastWarnings({ ...VALID, colors: { ...VALID.colors, background: '#ffffff', text: '#999999' } });
  const textBg = grey.find((w) => w.code === 'text-background');
  assert.ok(textBg);
  assert.equal(textBg.ratio, 2.8);
  assert.match(textBg.message, /2,8:1/);
  assert.match(textBg.message, /4,5:1 minimum recommandé/);
  const blue = themeContrastWarnings({ ...VALID, colors: { ...VALID.colors, primary: '#3b82f6', background: '#ffffff' } });
  assert.deepEqual(blue.map((w) => w.code), ['primary-background']);
  const sec = themeContrastWarnings({ ...VALID, colors: { ...VALID.colors, secondary: '#333333' } });
  assert.deepEqual(sec.map((w) => w.code), ['text-secondary']);
});

test('themeCss — identique au theme.css suivi du template (thème par défaut)', async () => {
  const fs = await import('node:fs');
  const { DEFAULT_THEME } = require('../../services/defaults.js');
  const css = themeLib.themeCss(DEFAULT_THEME.theme);
  const tracked = fs.readFileSync(new URL('../../../client-template/src/styles/theme.css', import.meta.url), 'utf-8');
  assert.equal(css, tracked);
  assert.ok(css.includes('--color-on-primary: #ffffff;'));
  assert.ok(css.includes('--color-primary-deep: #5a3b1c;'));
  assert.ok(css.indexOf('--color-primary:') < css.indexOf('--color-primary-deep:'));
});

test('themeCss — replis de base.css égaux aux couleurs dérivées de ses couleurs', async () => {
  const fs = await import('node:fs');
  const base = fs.readFileSync(new URL('../../../client-template/src/styles/base.css', import.meta.url), 'utf-8');
  const read = (name) => (base.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]+);`)) || [])[1];
  const d = themeLib.derivedColors({ primary: read('primary'), secondary: read('secondary'), background: read('bg'), text: read('text') });
  assert.equal(read('on-primary'), d.onPrimary);
  assert.equal(read('on-secondary'), d.onSecondary);
  assert.equal(read('primary-deep'), d.primaryDeep);
  assert.equal(read('surface'), d.surface);
  assert.equal(read('text-muted'), d.textMuted);
});

// --- Logo (médiathèque du site) ---

test('normalizeLogo / logoFilename — seule une image de la médiathèque est acceptée', () => {
  const { normalizeLogo, logoFilename } = themeLib;
  assert.equal(normalizeLogo(''), '');
  assert.equal(normalizeLogo(undefined), '');
  assert.equal(normalizeLogo(null), '');
  assert.equal(normalizeLogo('/api/media/file/logo.png'), '/api/media/file/logo.png');
  assert.equal(normalizeLogo('/api/media/file/logo%20(1).png'), '/api/media/file/logo%20%281%29.png');
  assert.equal(logoFilename('/api/media/file/logo%20(1).png'), 'logo (1).png');
  assert.equal(normalizeLogo('/api/media/file/caf%C3%A9.WEBP'), '/api/media/file/caf%C3%A9.WEBP');
  for (const bad of [
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    'https://cdn.example/logo.png',
    '//evil.example/l.png',
    '/api/media/file/../x.png',
    '/api/media/file/..%2Fx.png',
    '/api/media/file/.htaccess',
    '/api/media/file/%2Ehtaccess.png',
    '/api/media/file/logo.svg',
    '/api/media/file/logo.png.svg',
    '/api/media/file/a%ZZ.png',
    '/api/media/file/logo.png?x=1',
    '/api/media/file/a%5Cb.png',
    '/api/media/file/a%00.png',
    '/api/media/file/',
    `/api/media/file/${'a'.repeat(300)}.png`,
    42,
    {},
  ]) {
    assert.equal(normalizeLogo(bad), null, String(bad));
    assert.equal(logoFilename(bad), null, String(bad));
  }
});

test('validateTheme — logo invalide refusé, absent / vide / valide accepté', () => {
  const r = validateTheme({ ...VALID, logo: 'https://cdn.example/logo.png' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Logo/);
  assert.equal(validateTheme({ ...VALID, logo: '/api/media/file/logo.svg' }).ok, false);
  assert.equal(validateTheme(VALID).ok, true);
  assert.equal(validateTheme({ ...VALID, logo: '' }).ok, true);
  assert.equal(validateTheme({ ...VALID, logo: null }).ok, true);
  assert.equal(validateTheme({ ...VALID, logo: '/api/media/file/logo.png' }).ok, true);
});

test('publishableLogo — seulement un fichier de la médiathèque du site', () => {
  const { publishableLogo } = themeLib;
  const theme = { ...VALID, logo: '/api/media/file/logo%20(1).png' };
  assert.deepEqual(publishableLogo(theme, new Set(['logo (1).png'])), {
    name: 'logo (1).png',
    apiUrl: '/api/media/file/logo%20%281%29.png',
    staticPath: '/media/logo%20%281%29.png',
  });
  assert.equal(publishableLogo(theme, new Set(['autre.png'])), null);
  assert.equal(publishableLogo({ ...VALID, logo: 'https://x/l.png' }, new Set(['l.png'])), null);
  assert.equal(publishableLogo(VALID, new Set()), null);
  assert.equal(publishableLogo(undefined, new Set(['logo.png'])), null);
});

test('canonicalTheme — clés inconnues et logo invalide retirés', () => {
  const { canonicalTheme } = themeLib;
  const out = canonicalTheme({ ...VALID, extra: '<script>', colors: { ...VALID.colors, evil: 'x' }, logo: 'javascript:alert(1)' });
  assert.deepEqual(out, { colors: VALID.colors, fonts: VALID.fonts, radius: '12px' });
  assert.ok(!('logo' in canonicalTheme({ ...VALID, logo: '' })));
  assert.equal(canonicalTheme({ ...VALID, logo: '/api/media/file/a(b).png' }).logo, '/api/media/file/a%28b%29.png');
});
