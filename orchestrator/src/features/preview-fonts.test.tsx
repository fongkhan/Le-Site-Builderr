import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DEFAULT_THEME, type Theme } from '../types';
import { ThemePreview } from './design/components/ThemePreview';
import { PagePreview } from './cms/PagePreview';

// Aperçus Design et CMS : polices du thème auto-hébergées (pile « <famille> Variable ») et
// chargées à la demande (useThemeFonts appelé avec les polices du thème affiché).
const { useThemeFonts } = vi.hoisted(() => ({ useThemeFonts: vi.fn() }));
vi.mock('../lib/themeFonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/themeFonts')>()),
  useThemeFonts,
}));

const THEME: Theme = { ...DEFAULT_THEME, fonts: { heading: 'Lora', body: 'Karla' } };

describe('polices des aperçus', () => {
  it('ThemePreview : charge et applique les polices du thème', () => {
    useThemeFonts.mockClear();
    const html = renderToString(<ThemePreview theme={THEME} siteName="Demo" />);
    expect(useThemeFonts).toHaveBeenCalledWith('Lora', 'Karla');
    expect(html).toContain('font-family:&#x27;Karla Variable&#x27;, &#x27;Karla&#x27;, sans-serif');
    expect(html).toContain('font-family:&#x27;Lora Variable&#x27;, &#x27;Lora&#x27;, serif');
  });

  it('PagePreview : charge les polices, corps et titres de section du thème', () => {
    useThemeFonts.mockClear();
    const page = { layout: [{ blockType: 'features', title: 'Nos services', items: [] }] };
    const html = renderToString(<PagePreview page={page} theme={THEME} />);
    expect(useThemeFonts).toHaveBeenCalledWith('Lora', 'Karla');
    expect(html).toContain('font-family:&#x27;Karla Variable&#x27;, &#x27;Karla&#x27;, sans-serif');
    expect(html).toContain('font-family:&#x27;Lora Variable&#x27;, &#x27;Lora&#x27;, serif');
  });

  it('police inconnue (ancien thème) : famille générique seule', () => {
    const html = renderToString(<ThemePreview theme={{ ...THEME, fonts: { heading: 'Comic Sans', body: 'Papyrus' } }} siteName="Demo" />);
    expect(html).not.toMatch(/Comic Sans['&]|Papyrus Variable/);
    expect(html).toContain('font-family:sans-serif');
  });
});
