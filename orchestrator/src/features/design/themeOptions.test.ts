import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, type Theme } from '../../types';
import { BODY_FONTS, HEADING_FONTS, THEME_PRESETS, coerceTheme, contrastWarnings, isCssDimension, normalizeTheme, validateTheme } from './themeOptions';

describe('options du thème', () => {
  it('polices identiques à server/lib/theme.js', () => {
    expect(HEADING_FONTS).toEqual(['Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter']);
    expect(BODY_FONTS).toEqual(['Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans']);
  });

  it('le thème par défaut et toutes les palettes sont valides', () => {
    expect(validateTheme(DEFAULT_THEME)).toBeNull();
    for (const preset of THEME_PRESETS) expect(validateTheme(preset.theme), preset.name).toBeNull();
  });

  it('signale chaque champ refusé par le serveur', () => {
    const theme: Theme = {
      colors: { primary: 'red', secondary: '#abc', background: '#11223344', text: 'url(x)' },
      fonts: { heading: 'Comic Sans MS', body: 'Inter' },
      radius: '12px; }',
    };
    const errors = validateTheme(theme);
    expect(errors).not.toBeNull();
    expect(Object.keys(errors!.colors).sort()).toEqual(['primary', 'text']);
    expect(errors!.heading).toBeDefined();
    expect(errors!.body).toBeUndefined();
    expect(errors!.radius).toBeDefined();
  });

  it('rayon : mêmes unités que le serveur', () => {
    for (const ok of ['0', '12px', '0.5rem', '1em', '50%', ' 8px ']) expect(isCssDimension(ok), ok).toBe(true);
    for (const ko of ['', '12', 'px', '12vh', '-4px', 'calc(1px)']) expect(isCssDimension(ko), ko).toBe(false);
  });

  it('normalizeTheme retire les espaces', () => {
    const theme = normalizeTheme({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: ' #fff ' }, radius: ' 4px' });
    expect(theme.colors.primary).toBe('#fff');
    expect(theme.radius).toBe('4px');
  });
});

describe('coerceTheme', () => {
  it('thème absent : thème par défaut ; champ manquant : chaîne vide signalée', () => {
    expect(coerceTheme(undefined)).toEqual(DEFAULT_THEME);
    const theme = coerceTheme({ colors: { primary: '#fff', secondary: null }, fonts: { heading: 'Lora' }, radius: '4px' });
    expect(theme.colors).toEqual({ primary: '#fff', secondary: '', background: '', text: '' });
    expect(theme.fonts).toEqual({ heading: 'Lora', body: '' });
    expect(Object.keys(validateTheme(theme)!.colors).sort()).toEqual(['background', 'secondary', 'text']);
  });

  it('logo gardé (sans espaces) seulement s’il est renseigné', () => {
    expect(coerceTheme({ ...DEFAULT_THEME, logo: ' /api/media/file/logo.png ' }).logo).toBe('/api/media/file/logo.png');
    expect('logo' in coerceTheme({ ...DEFAULT_THEME, logo: '' })).toBe(false);
    expect('logo' in coerceTheme({ ...DEFAULT_THEME, logo: 42 })).toBe(false);
    expect(normalizeTheme({ ...DEFAULT_THEME, logo: ' /api/media/file/logo.png' }).logo).toBe('/api/media/file/logo.png');
    expect('logo' in normalizeTheme({ ...DEFAULT_THEME, logo: '   ' })).toBe(false);
  });
});

describe('logo', () => {
  it('seule une image de la médiathèque est acceptée (mêmes règles que le serveur)', () => {
    for (const logo of ['https://cdn.example/logo.png', 'javascript:alert(1)', '/api/media/file/logo.svg', '/api/media/file/..%2Fx.png', '/api/media/file/.htaccess', '/api/media/file/a%ZZ.png']) {
      expect(validateTheme({ ...DEFAULT_THEME, logo })?.logo, logo).toMatch(/Logo invalide/);
    }
    for (const logo of ['', '/api/media/file/logo.png', '/api/media/file/logo%20(1).webp']) {
      expect(validateTheme({ ...DEFAULT_THEME, logo }), logo).toBeNull();
    }
  });
});

describe('contrastWarnings', () => {
  it('aucun avertissement pour le thème par défaut et les palettes proposées', () => {
    expect(contrastWarnings(DEFAULT_THEME)).toEqual([]);
    for (const preset of THEME_PRESETS) expect(contrastWarnings(preset.theme), preset.name).toEqual([]);
  });

  it('mêmes codes et messages que le serveur', () => {
    const warnings = contrastWarnings({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, background: '#ffffff', text: '#999999' } });
    const textBg = warnings.find((w) => w.code === 'text-background');
    expect(textBg?.ratio).toBe(2.8);
    expect(textBg?.message).toBe('Texte peu lisible sur le fond : contraste 2,8:1, 4,5:1 minimum recommandé.');
    const blue = contrastWarnings({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#3b82f6', background: '#ffffff' } });
    expect(blue.map((w) => w.code)).toEqual(['primary-background']);
    // Couleur en cours de saisie (invalide) : pas d'avertissement trompeur
    expect(contrastWarnings({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#99' } })).toEqual([]);
  });
});
