import { useEffect, useRef, useState } from 'react';
import type { Block } from '../../../types';
import { blockLabel } from '../blocks/definitions';
import { getBlockDefinition } from '../blocks/registry';
import type { UpdateOptions } from '../blocks/types';
import { moveAnnouncement, type EditorBlock } from '../lib/editorModel';
import '../cms-editor.css';

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
  onDuplicate: (blockId: string) => void;
  updateBlock: (blockId: string, recipe: (draft: Block) => void, options?: UpdateOptions) => void;
}

// Sections de la page : ordre (flèches, glisser-déposer), duplication, suppression,
// éditeur du bloc. Chaque déplacement est annoncé aux lecteurs d'écran (jamais au
// chargement) et le focus reste sur une flèche utilisable.
export function BlockList({ blocks, siteSlug, editingId, onEdit, onMove, onReorder, onRemove, onDuplicate, updateBlock }: BlockListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Dernière flèche utilisée : si elle devient inactive (bloc arrivé en haut ou en bas),
  // le focus passe sur la flèche opposée au lieu de se perdre.
  const lastMove = useRef<{ id: string; delta: -1 | 1 } | null>(null);
  const arrows = useRef(new Map<string, HTMLButtonElement>());

  // Après le rendu qui suit un déplacement (nouvelle position du bloc), une seule fois
  useEffect(() => {
    const move = lastMove.current;
    if (!move) return;
    lastMove.current = null;
    const used = arrows.current.get(`${move.id}:${move.delta}`);
    const opposite = arrows.current.get(`${move.id}:${-move.delta}`);
    if (used?.disabled && opposite && !opposite.disabled) opposite.focus();
  }, [blocks]);

  const arrowRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) arrows.current.set(key, el);
    else arrows.current.delete(key);
  };

  const announce = (blockId: string, newIndex: number) => {
    const block = blocks.find((b) => b.id === blockId);
    if (block) setAnnouncement(moveAnnouncement(blockLabel(block.blockType), newIndex, blocks.length));
  };

  const move = (blockId: string, index: number, delta: -1 | 1) => {
    lastMove.current = { id: blockId, delta };
    onMove(blockId, delta);
    announce(blockId, index + delta);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    onReorder(fromId, toId);
    announce(fromId, blocks.findIndex((b) => b.id === toId));
  };

  const endDrag = () => {
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="status" aria-live="polite" className="cms-sr-only">{announcement}</div>
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
              if (dragId !== null) reorder(dragId, block.id);
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
                  aria-hidden="true"
                  style={{ cursor: 'grab', color: 'var(--text-muted)', userSelect: 'none' }}
                >
                  ⠿
                </span>
                {idx + 1}. {definition && <span aria-hidden>{definition.icon}</span>} {label}
              </strong>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" ref={arrowRef(`${block.id}:-1`)} onClick={() => move(block.id, idx, -1)} disabled={idx === 0} style={ICON_BUTTON} aria-label={`Monter la section ${label}`}>▲</button>
                <button type="button" ref={arrowRef(`${block.id}:1`)} onClick={() => move(block.id, idx, 1)} disabled={idx === blocks.length - 1} style={ICON_BUTTON} aria-label={`Descendre la section ${label}`}>▼</button>
                <button type="button" className="cms-duplicate" onClick={() => onDuplicate(block.id)} title="Dupliquer la section (copie insérée juste après)" aria-label={`Dupliquer la section ${label}`}>⧉ Dupliquer</button>
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
