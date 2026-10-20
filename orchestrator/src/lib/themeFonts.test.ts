import { describe, expect, it, vi } from 'vitest';
import { BODY_FONTS, HEADING_FONTS } from '../features/design/themeOptions';
import { FONT_LOADERS, createFontLoader, fontStack } from './themeFonts';

describe('FONT_LOADERS — polices des thèmes auto-hébergées', () => {
  it('une feuille par famille proposée (HEADING_FONTS ∪ BODY_FONTS), ni plus ni moins', () => {
    const expected = [...new Set([...HEADING_FONTS, ...BODY_FONTS])].sort();
    expect(Object.keys(FONT_LOADERS).sort()).toEqual(expected);
    for (const loader of Object.values(FONT_LOADERS)) expect(typeof loader).toBe('function');
  });

  it('chemins littéraux vers @fontsource-variable/<id>/wght.css (découpés par Vite)', () => {
    for (const [family, loader] of Object.entries(FONT_LOADERS)) {
      const id = family.toLowerCase().replace(/ /g, '-');
      expect(loader.toString()).toContain(`@fontsource-variable/${id}/wght.css`);
    }
  });
});

describe('fontStack', () => {
  it('famille connue : version variable, nom d’origine, générique', () => {
    expect(fontStack('Lora', 'serif')).toBe("'Lora Variable', 'Lora', serif");
    expect(fontStack('Plus Jakarta Sans', 'sans-serif')).toBe("'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', sans-serif");
  });

  it('famille inconnue ou hostile : générique seule', () => {
    expect(fontStack('Comic Sans', 'serif')).toBe('serif');
    expect(fontStack("x', red; background: url(//evil)", 'serif')).toBe('serif');
    expect(fontStack('constructor', 'sans-serif')).toBe('sans-serif');
    expect(fontStack('', 'serif')).toBe('serif');
  });
});

describe('createFontLoader', () => {
  it('une famille n’est chargée qu’une fois, doublons de l’entrée compris', async () => {
    const inter = vi.fn(() => Promise.resolve());
    const load = createFontLoader({ Inter: inter });
    await load(['Inter', 'Inter']);
    expect(inter).toHaveBeenCalledTimes(1);
    await load(['Inter']);
    expect(inter).toHaveBeenCalledTimes(1);
  });

  it('chargement lancé dès l’appel, sans attendre', () => {
    const inter = vi.fn(() => Promise.resolve());
    void createFontLoader({ Inter: inter })(['Inter']);
    expect(inter).toHaveBeenCalledTimes(1);
  });

  it('famille inconnue ignorée (y compris les clés héritées d’Object)', async () => {
    const inter = vi.fn(() => Promise.resolve());
    const load = createFontLoader({ Inter: inter });
    await expect(load(['Comic Sans', 'toString', 'constructor', '__proto__'])).resolves.toBeUndefined();
    expect(inter).not.toHaveBeenCalled();
  });

  // Le préchargement de Vite ne redemande jamais une feuille en échec : un nouvel essai
  // serait résolu sans rien charger. La famille reste sur sa police de repli.
  it('échec absorbé (rejet ou exception), famille jamais redemandée', async () => {
    const lora = vi.fn(() => Promise.reject(new Error('réseau')));
    const karla = vi.fn(() => { throw new Error('module introuvable'); });
    const load = createFontLoader({ Lora: lora, Karla: karla });
    await expect(load(['Lora', 'Karla'])).resolves.toBeUndefined();
    await expect(load(['Lora', 'Karla'])).resolves.toBeUndefined();
    expect(lora).toHaveBeenCalledTimes(1);
    expect(karla).toHaveBeenCalledTimes(1);
  });

  it('un échec n’empêche pas le chargement des autres familles', async () => {
    const inter = vi.fn(() => Promise.resolve());
    const lora = vi.fn(() => Promise.reject(new Error('réseau')));
    const load = createFontLoader({ Inter: inter, Lora: lora });
    await load(['Lora', 'Inter']);
    expect(inter).toHaveBeenCalledTimes(1);
    expect(lora).toHaveBeenCalledTimes(1);
  });
});
