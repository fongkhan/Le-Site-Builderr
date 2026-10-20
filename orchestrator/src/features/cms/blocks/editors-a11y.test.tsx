import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToastProvider } from '../../../components/ui/ToastContext';
import type { Block, PageDoc } from '../../../types';
import { auditFormControls } from '../../../test-utils/a11yAudit';
import { BlockList } from '../components/BlockList';
import { linkTargetsFor } from '../lib/ctaLink';
import { withClientId } from '../lib/editorModel';
import { BLOCK_DEFINITIONS, BLOCK_REGISTRY } from './registry';

// Chaque éditeur de bloc, avec et sans cibles de lien : tous les champs ont un nom
// accessible et aucune référence (for, aria-describedby) ne vise un id absent.
vi.mock('../../../state/ConfigContext', () => ({
  useConfig: () => ({ config: null, refresh: async () => {} }),
}));

const noop = () => {};
const home: PageDoc = { title: 'Accueil', slug: 'home', locale: 'fr', layout: [{ blockType: 'hero' }, { blockType: 'contact' }] };
const tarifs: PageDoc = { title: 'Tarifs', slug: 'tarifs', locale: 'fr', layout: [{ blockType: 'pricing' }] };
const targets = linkTargetsFor([home, tarifs], home);

const render = (block: Block, withTargets: boolean) => {
  const definition = BLOCK_REGISTRY[block.blockType as keyof typeof BLOCK_REGISTRY];
  return renderToString(
    <ToastProvider>
      <definition.Editor block={block} siteSlug="mon-site" update={noop} linkTargets={withTargets ? targets : undefined} />
    </ToastProvider>,
  );
};

describe('éditeurs de blocs accessibles', () => {
  it.each(BLOCK_DEFINITIONS.flatMap((d) => [[d.type, true], [d.type, false]] as const))('« %s » (cibles de lien : %s)', (type, withTargets) => {
    const definition = BLOCK_REGISTRY[type];
    expect(auditFormControls(render(definition.defaults, withTargets))).toEqual([]);
    expect(auditFormControls(render({ blockType: type }, withTargets))).toEqual([]);
  });

  it('liens des boutons : bannière, formules et produits, valeurs relues', () => {
    const hero = render({ ...BLOCK_REGISTRY.hero.defaults, ctaLink: '/tarifs/' }, true);
    expect(hero).toMatch(/<label class="field-label" for="[^"]+"[^>]*>Lien du bouton<\/label>/);
    expect(hero).toContain('<option value="/tarifs/" selected=""');

    const pricing = BLOCK_REGISTRY.pricing.defaults;
    const plans = (pricing.plans ?? []).map((plan, i) => (i === 0 ? { ...plan, ctaLink: 'https://exemple.fr/reserver' } : plan));
    const pricingHtml = render({ ...pricing, plans }, true);
    expect(pricingHtml).toContain('aria-label="Lien du bouton"');
    expect(pricingHtml).toMatch(/<input type="url"[^>]*value="https:\/\/exemple\.fr\/reserver"/);

    const grid = BLOCK_REGISTRY['product-grid'].defaults;
    const products = (grid.products ?? []).map((p, i) => (i === 0 ? { ...p, ctaLink: 'tel:+33478000000' } : p));
    const gridHtml = render({ ...grid, products }, true);
    expect(gridHtml).toContain('aria-label="Lien du bouton « Commander »"');
    expect(gridHtml).toMatch(/<input type="tel"[^>]*value="\+33478000000"/);
    expect(auditFormControls(gridHtml)).toEqual([]);
  });

  it('lien enregistré à null (ancien contenu) : mode Automatique', () => {
    const html = render({ blockType: 'hero', ctaLink: null as unknown as string }, true);
    expect(html).toContain('<option value="" selected="">Automatique');
  });

  it('BlockList transmet les cibles de lien à l’éditeur ouvert', () => {
    const block = withClientId({ blockType: 'hero', title: 'A', ctaLink: '/tarifs/' });
    const list = (linkTargets?: typeof targets) =>
      renderToString(
        <ToastProvider>
          <BlockList
            blocks={[block]}
            siteSlug="mon-site"
            editingId={block.id}
            onEdit={noop}
            onMove={noop}
            onReorder={noop}
            onRemove={noop}
            onDuplicate={noop}
            updateBlock={noop}
            linkTargets={linkTargets}
          />
        </ToastProvider>,
      );
    expect(list(targets)).toContain('<optgroup label="Pages du site">');
    expect(list(targets)).toContain('<option value="/tarifs/" selected=""');
    expect(list()).not.toContain('Pages du site');
  });
});
