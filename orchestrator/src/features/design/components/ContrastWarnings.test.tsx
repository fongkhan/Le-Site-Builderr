import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DEFAULT_THEME } from '../../../types';
import { ContrastWarnings } from './ContrastWarnings';

describe('ContrastWarnings', () => {
  it('rien pour un thème lisible', () => {
    expect(renderToString(<ContrastWarnings theme={DEFAULT_THEME} />)).toBe('');
  });

  it('liste des avertissements pour un thème peu contrasté, sans zone live', () => {
    const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, background: '#ffffff', text: '#999999' } };
    const html = renderToString(<ContrastWarnings theme={theme} />);
    expect(html).toContain('Lisibilité insuffisante (WCAG AA)');
    expect(html).toContain('<li>Texte peu lisible sur le fond : contraste 2,8:1, 4,5:1 minimum recommandé.</li>');
    expect(html).toContain('Le thème reste enregistrable.');
    expect(html).not.toContain('role=');
    expect(html).not.toContain('aria-live');
  });
});
