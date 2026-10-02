import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToastProvider } from '../../../components/ui/ToastContext';
import { withClientId } from '../lib/editorModel';
import { BlockList } from './BlockList';

const noop = () => {};

describe('BlockList', () => {
  it('région d’annonce polie, vide au chargement ; poignée masquée ; bouton Dupliquer', () => {
    const blocks = [withClientId({ blockType: 'hero', title: 'A' }), withClientId({ blockType: 'faq', title: 'B' })];
    const html = renderToString(
      <ToastProvider>
        <BlockList
          blocks={blocks}
          siteSlug="mon-site"
          editingId={null}
          onEdit={noop}
          onMove={noop}
          onReorder={noop}
          onRemove={noop}
          onDuplicate={noop}
          updateBlock={noop}
        />
      </ToastProvider>,
    );
    expect(html).toMatch(/<div role="status" aria-live="polite" class="cms-sr-only"><\/div>/);
    expect(html).not.toContain('déplacée en position');
    expect(html).toContain('aria-hidden="true" style="cursor:grab');
    expect(html).toContain('⧉ Dupliquer');
  });
});
