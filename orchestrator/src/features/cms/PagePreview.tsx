import { memo } from 'react';
import type { Block, Theme } from '../../types';
import { getBlockDefinition } from './blocks/registry';

type PreviewBlock = Block & { id?: string };

// Aperçu WYSIWYG de la page telle qu'elle sera rendue par le template Astro. Chaque bloc
// est rendu par l'aperçu de son type (registre) ; un bloc inchangé n'est pas recalculé.
export function PagePreview({ page, theme }: { page: { layout: readonly PreviewBlock[] }; theme: Theme }) {
  return (
    <div
      style={{
        backgroundColor: theme.colors.background,
        color: theme.colors.text,
        borderRadius: 12,
        fontFamily: `'${theme.fonts.body}', sans-serif`,
        border: '1px solid rgba(0,0,0,0.15)',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        minHeight: 500,
      }}
    >
      {page.layout.map((block, index) => (
        <BlockPreview key={block.id ?? index} block={block} theme={theme} />
      ))}
    </div>
  );
}

const BlockPreview = memo(function BlockPreview({ block, theme }: { block: Block; theme: Theme }) {
  const definition = getBlockDefinition(block.blockType);
  if (!definition) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontSize: '0.85rem', opacity: 0.6 }}>
        Bloc « {block.blockType} » non pris en charge par l'aperçu.
      </div>
    );
  }
  return <definition.Preview block={block} theme={theme} />;
});
