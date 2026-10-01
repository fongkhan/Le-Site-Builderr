import { useState } from 'react';
import type { Block } from '../../../types';
import { blockLabel } from '../blocks/definitions';
import { getBlockDefinition } from '../blocks/registry';
import type { UpdateOptions } from '../blocks/types';
import type { EditorBlock } from '../lib/editorModel';

const ICON_BUTTON = { padding: 4, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' } as const;

interface BlockListProps {
  blocks: EditorBlock[];
  siteSlug: string;
  /** Bloc dont l'éditeur est ouvert (identifiant stable : ne « saute » pas au déplacement) */
  editingId: string | null;
  onEdit: (blockId: string | null) => void;
  onMove: (blockId: string, delta: -1 | 1) => void;
  onReorder: (fromId: string, toId: string) => void;
  onRemove: (blockId: string) => void;
  updateBlock: (blockId: string, recipe: (draft: Block) => void, options?: UpdateOptions) => void;
}

// Sections de la page : ordre (flèches, glisser-déposer), suppression, éditeur du bloc.
export function BlockList({ blocks, siteSlug, editingId, onEdit, onMove, onReorder, onRemove, updateBlock }: BlockListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const endDrag = () => {
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((block, idx) => {
        const editing = editingId === block.id;
        const definition = getBlockDefinition(block.blockType);
        const label = blockLabel(block.blockType);
        return (
          <div
            key={block.id}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              if (dragOverId !== block.id) setDragOverId(block.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId !== null) onReorder(dragId, block.id);
              endDrag();
            }}
            style={{
              background: editing ? 'var(--accent-blue-soft)' : 'rgba(255,255,255,0.02)',
              border: dragOverId === block.id && dragId !== null && dragId !== block.id
                ? '1px dashed var(--accent-blue)'
                : editing ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 12,
              opacity: dragId === block.id ? 0.5 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragId(block.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={endDrag}
                  title="Glisser pour réordonner"
                  aria-label={`Déplacer la section ${idx + 1}`}
                  style={{ cursor: 'grab', color: 'var(--text-muted)', userSelect: 'none' }}
                >
                  ⠿
                </span>
                {idx + 1}. {definition && <span aria-hidden>{definition.icon}</span>} {label}
              </strong>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => onMove(block.id, -1)} disabled={idx === 0} style={ICON_BUTTON} aria-label={`Monter la section ${label}`}>▲</button>
                <button type="button" onClick={() => onMove(block.id, 1)} disabled={idx === blocks.length - 1} style={ICON_BUTTON} aria-label={`Descendre la section ${label}`}>▼</button>
                <button type="button" onClick={() => onRemove(block.id)} style={{ ...ICON_BUTTON, color: 'var(--accent-rose)' }} aria-label={`Supprimer la section ${label}`}>✕</button>
              </div>
            </div>

            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                {definition ? (
                  <definition.Editor
                    block={block}
                    siteSlug={siteSlug}
                    update={(recipe, options) => updateBlock(block.id, recipe, options)}
                  />
                ) : (
                  <span className="field-label">Ce type de section (« {block.blockType} ») n'est pas modifiable ici : il est conservé tel quel.</span>
                )}
                <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.875rem', marginTop: 5 }} onClick={() => onEdit(null)}>
                  Fermer
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.8rem', display: 'block', textAlign: 'center', marginTop: 6 }}
                onClick={() => onEdit(block.id)}
              >
                Éditer le contenu
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
