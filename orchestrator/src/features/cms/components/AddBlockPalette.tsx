import type { BlockType } from '../blocks/definitions';
import { BLOCK_DEFINITIONS } from '../blocks/registry';

// Boutons d'ajout d'un bloc à la page courante (un par type du registre).
export function AddBlockPalette({ onAdd, disabled }: { onAdd: (type: BlockType) => void; disabled?: boolean }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 15, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ajouter un bloc :</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {BLOCK_DEFINITIONS.map((definition) => (
          <button
            key={definition.type}
            type="button"
            className="btn btn-secondary"
            style={{ padding: 8, fontSize: '0.8rem', justifyContent: 'flex-start' }}
            onClick={() => onAdd(definition.type)}
            disabled={disabled}
            title={definition.description}
          >
            <span aria-hidden>{definition.icon}</span> {definition.label}
          </button>
        ))}
      </div>
    </div>
  );
}
