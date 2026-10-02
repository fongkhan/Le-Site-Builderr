import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToastProvider } from '../../../components/ui/ToastContext';
import { DEFAULT_THEME, type Block } from '../../../types';
import { BLOCK_DEFINITIONS } from './registry';

// Rendu sans DOM (renderToString) : chaque éditeur et chaque aperçu s'affiche avec les
// valeurs par défaut ET avec un bloc incomplet (champs absents, tel qu'un ancien contenu).
vi.mock('../../../state/ConfigContext', () => ({
  useConfig: () => ({ config: null, refresh: async () => {} }),
}));

const noop = () => {};

describe('rendu des blocs', () => {
  it.each(BLOCK_DEFINITIONS.map((d) => [d.type, d] as const))('aperçu « %s »', (_type, definition) => {
    const html = renderToString(<definition.Preview block={definition.defaults} theme={DEFAULT_THEME} />);
    const firstText = definition.defaults.title ?? definition.defaults.text ?? '';
    expect(html).toContain(firstText.replace(/'/g, '&#x27;'));
    expect(() => renderToString(<definition.Preview block={{ blockType: definition.type } as Block} theme={DEFAULT_THEME} />)).not.toThrow();
  });

  it.each(BLOCK_DEFINITIONS.map((d) => [d.type, d] as const))('éditeur « %s »', (_type, definition) => {
    const render = (block: Block) =>
      renderToString(
        <ToastProvider>
          <definition.Editor block={block} siteSlug="mon-site" update={noop} />
        </ToastProvider>,
      );
    expect(render(definition.defaults)).toContain('<input');
    expect(() => render({ blockType: definition.type })).not.toThrow();
  });

  it("l'aperçu du bloc Prise de RDV liste les prestations", () => {
    const appointment = BLOCK_DEFINITIONS.find((d) => d.type === 'appointment')!;
    const html = renderToString(<appointment.Preview block={appointment.defaults} theme={DEFAULT_THEME} />);
    expect(html).toContain('Prestation 1');
    expect(html).toContain('Demander un rendez-vous');
  });

  it('couleurs translucides valides même pour #RGB', () => {
    const faq = BLOCK_DEFINITIONS.find((d) => d.type === 'faq')!;
    const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, secondary: '#abc' } };
    const html = renderToString(<faq.Preview block={faq.defaults} theme={theme} />);
    expect(html).toContain('#aabbcc12');
    expect(html).not.toContain('#abc11');
  });
});
