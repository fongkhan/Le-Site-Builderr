import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DEFAULT_THEME } from '../../../types';
import { ThemePreview } from './ThemePreview';

describe('ThemePreview', () => {
  it('logo de la médiathèque : en-tête et icône d’onglet', () => {
    const html = renderToString(<ThemePreview theme={{ ...DEFAULT_THEME, logo: '/api/media/file/logo.png' }} siteName="Atelier Démo" />);
    expect(html).toMatch(/<img src="\/api\/media\/file\/logo\.png" alt="Atelier Démo"/);
    expect(html).not.toContain('>AD<');
  });

  it('sans logo (ou logo refusé) : nom du site et initiales sur la couleur primaire', () => {
    for (const logo of [undefined, 'https://pisteur.example/logo.png']) {
      const html = renderToString(<ThemePreview theme={{ ...DEFAULT_THEME, ...(logo ? { logo } : {}) }} siteName="Atelier Démo" />);
      expect(html).not.toContain('<img');
      expect(html).toContain('>Atelier Démo<');
      expect(html).toContain('>AD<');
    }
  });

  it('texte des boutons lisible : foncé sur un primaire clair', () => {
    const html = renderToString(<ThemePreview theme={{ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#FACC15' } }} siteName="Demo" />);
    expect(html).toMatch(/background-color:#FACC15;color:#111111[^"]*">Bouton primaire/);
    const dark = renderToString(<ThemePreview theme={DEFAULT_THEME} siteName="Demo" />);
    expect(dark).toMatch(/background-color:#8b5a2b;color:#ffffff[^"]*">Bouton primaire/);
  });
});
