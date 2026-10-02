import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, type Theme } from '../../types';
import { BODY_FONTS, HEADING_FONTS, THEME_PRESETS, coerceTheme, isCssDimension, normalizeTheme, validateTheme } from './themeOptions';

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
});
