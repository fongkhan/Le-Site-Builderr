import { describe, expect, it } from 'vitest';
import { contrastRatio, derivedColors, mixHex, readableOn, toHex6 } from './color';
import { initials } from './monogram';

// Mêmes vecteurs que server/tests/unit/theme.test.mjs et monogram.test.mjs : l'aperçu de
// la page Design doit calculer exactement les couleurs du site publié.
const DEFAULT_COLORS = { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' };
const DARK = { primary: '#C9A227', secondary: '#2A2A2A', background: '#111111', text: '#F2F2F2' };

describe('readableOn', () => {
  it('blanc d’abord, sinon gris très foncé', () => {
    expect(readableOn('#8B5A2B')).toBe('#ffffff');
    expect(readableOn('#FACC15')).toBe('#111111');
    expect(readableOn('#C9A227')).toBe('#111111');
    expect(readableOn('#F5E6CC', ['#2D241E'])).toBe('#2D241E');
  });

  it('contraste AA garanti sur les 4096 couleurs #RGB', () => {
    for (let i = 0; i < 4096; i++) {
      const c = `#${i.toString(16).padStart(3, '0')}`;
      expect(contrastRatio(readableOn(c), c), c).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('derivedColors', () => {
  it('thème par défaut', () => {
    expect(derivedColors(DEFAULT_COLORS)).toEqual({
      onPrimary: '#ffffff',
      onSecondary: '#2D241E',
      primaryDeep: '#5a3b1c',
      surface: '#ffffff',
      textMuted: '#6c6662',
    });
  });

  it('palette sombre : texte foncé sur primaire clair, surface éclaircie', () => {
    const d = derivedColors(DARK);
    expect(d.onPrimary).toBe('#111111');
    expect(d.onSecondary).toBe('#F2F2F2');
    expect(d.surface).toBe('#1f1f1f');
    expect(contrastRatio(DARK.text, d.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(d.textMuted, d.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(d.onPrimary, d.primaryDeep)).toBeGreaterThanOrEqual(contrastRatio(d.onPrimary, DARK.primary));
  });

  it('thème incomplet (couleur absente ou en cours de saisie) : jamais d’exception', () => {
    const partial = { primary: '#8B5A2B', secondary: undefined, background: ' #fafafa ', text: '#12' } as unknown as typeof DEFAULT_COLORS;
    const d = derivedColors(partial);
    expect(d.onPrimary).toBe('#ffffff');
    expect(d.onSecondary).toBe('#ffffff'); // secondaire absente : traitée comme du noir
    expect(d.surface).toBe('#ffffff');
  });

  it('mixHex : interpolation sRGB arrondie', () => {
    expect(mixHex('#8B5A2B', '#000000', 0.35)).toBe('#5a3b1c');
    expect(mixHex('#111111', '#ffffff', 0.06)).toBe('#1f1f1f');
    expect(toHex6('#abc')).toBe('#aabbcc');
  });
});

describe('initials (mêmes règles que le template)', () => {
  it('deux premiers mots, Unicode, jamais de balisage', () => {
    expect(initials('Demo')).toBe('D');
    expect(initials('Boulangerie Artisanale Clamart')).toBe('BA');
    expect(initials(' école du Port')).toBe('ÉD');
    expect(initials('<script>x</script>')).not.toContain('<');
    expect(initials('')).toBe('•');
    expect(initials('🥖')).toBe('•');
  });
});
