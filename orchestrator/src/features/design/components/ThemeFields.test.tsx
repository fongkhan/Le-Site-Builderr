import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToastProvider } from '../../../components/ui/ToastContext';
import { DEFAULT_THEME, type Theme } from '../../../types';
import { validateTheme } from '../themeOptions';
import { ThemeFields } from './ThemeFields';

// Rendu sans DOM (comme render.test.tsx) : contexte de configuration simulé.
vi.mock('../../../state/ConfigContext', () => ({
  useConfig: () => ({ config: null, refresh: async () => {} }),
}));

const render = (theme: Theme) =>
  renderToString(
    <ToastProvider>
      <ThemeFields siteSlug="demo" theme={theme} errors={validateTheme(theme)} isModified={false} setTheme={() => {}} />
    </ToastProvider>,
  );

describe('page Design : champs du thème', () => {
  it('chaque erreur est reliée à son champ (aria-describedby + aria-invalid)', () => {
    const html = render({
      colors: { ...DEFAULT_THEME.colors, primary: 'rouge' },
      fonts: { heading: 'Comic Sans MS', body: 'Arial' },
      radius: '12',
      logo: 'https://pisteur.example/logo.png',
    });
    for (const id of ['theme-color-primary-erreur', 'theme-font-heading-erreur', 'theme-font-body-erreur', 'theme-radius-erreur', 'theme-logo-erreur']) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/id="theme-color-primary" type="text" aria-invalid="true" aria-describedby="theme-color-primary-erreur"[^>]*value="rouge"/);
    expect(html).toMatch(/<select id="theme-font-heading"[^>]*aria-invalid="true" aria-describedby="theme-font-heading-erreur"/);
    expect(html).toMatch(/<select id="theme-font-body"[^>]*aria-invalid="true" aria-describedby="theme-font-body-erreur"/);
    expect(html).toMatch(/id="theme-radius"[^>]*aria-invalid="true" aria-describedby="theme-radius-erreur"/);
    expect(html).toMatch(/aria-invalid="true" aria-describedby="theme-logo-erreur theme-logo-aide"/);
    expect(html).toContain('Logo invalide');
    // Les couleurs valides ne sont pas signalées
    expect(html).not.toContain('theme-color-secondary-erreur');
    expect(html).not.toMatch(/id="theme-color-secondary"[^>]*aria-invalid/);
  });

  it('thème valide : aucune erreur, aide du logo reliée, libellés et groupe des palettes', () => {
    const html = render(DEFAULT_THEME);
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('-erreur"');
    expect(html).toContain('aria-describedby="theme-logo-aide"');
    expect(html).toContain('id="theme-palettes"');
    expect(html).toContain('role="group" aria-labelledby="theme-palettes"');
    // Libellé du logo relié à son champ
    const logoLabel = html.match(/<label class="field-label" for="([^"]+)">Logo \(en-tête du site et icône d&#x27;onglet\)<\/label>/);
    expect(logoLabel).not.toBeNull();
    expect(html).toContain(`id="${logoLabel![1]}"`);
    for (const id of ['theme-color-primary', 'theme-font-heading', 'theme-font-body', 'theme-radius']) {
      expect(html).toContain(`for="${id}"`);
    }
    // Tous les boutons sont de type « button » (aucun envoi de formulaire implicite)
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) expect(b).toContain('type="button"');
    expect(html).not.toContain('Retirer le logo');
    expect(html).not.toContain('Lisibilité insuffisante');
  });

  it('logo renseigné : bouton « Retirer le logo » ; couleurs peu contrastées : avertissement', () => {
    const html = render({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#dddddd' }, logo: '/api/media/file/logo.png' });
    expect(html).toContain('Retirer le logo');
    expect(html).toContain('value="/api/media/file/logo.png"');
    expect(html).toContain('Lisibilité insuffisante (WCAG AA)');
  });
});
