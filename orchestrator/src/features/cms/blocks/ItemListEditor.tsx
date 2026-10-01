import type { ReactNode } from 'react';
import type { ListUpdater } from './blockFields';
import type { UpdateOptions } from './types';

export interface ItemControls<T> {
  index: number;
  /** Modifie l'élément (objet) dans la DERNIÈRE version de la liste */
  update: (recipe: (draft: T) => void, options?: UpdateOptions) => void;
  /** Remplace l'élément (valeur simple : URL d'image…) */
  set: (value: T) => void;
}

interface ItemListEditorProps<T> {
  items: readonly T[] | undefined;
  onUpdate: ListUpdater<T>;
  /** Gabarit cloné à chaque ajout */
  newItem: T;
  /** « Produit » → en-têtes « Produit 1 », « Produit 2 »… */
  itemLabel: string;
  /** « Ajouter un produit » */
  addLabel: string;
  renderItem: (item: T, controls: ItemControls<T>) => ReactNode;
  /** card : élément encadré avec en-tête ; inline : une ligne avec ✕ à droite */
  variant?: 'card' | 'inline';
  /** Libellé affiché au-dessus de la liste */
  title?: string;
}

const REMOVE_STYLE = { background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 4px' } as const;

// Éditeur générique d'une liste d'éléments : ajout (gabarit), suppression, édition.
// Toutes les modifications passent par onUpdate, appliqué à la dernière version de la liste.
export function ItemListEditor<T>({ items, onUpdate, newItem, itemLabel, addLabel, renderItem, variant = 'card', title }: ItemListEditorProps<T>) {
  const list = items ?? [];

  const add = () => onUpdate((draft) => {
    draft.push(structuredClone(newItem));
  }, { immediate: true });

  const remove = (index: number) => onUpdate((draft) => {
    if (index < draft.length) draft.splice(index, 1);
  }, { immediate: true });

  const controls = (index: number): ItemControls<T> => ({
    index,
    update: (recipe, options) => onUpdate((draft) => {
      if (index < draft.length) recipe(draft[index]);
    }, options),
    set: (value) => onUpdate((draft) => {
      if (index < draft.length) draft[index] = value;
    }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {title && <span className="field-label" style={{ marginTop: 4 }}>{title}</span>}
      {list.map((item, index) => {
        const label = `${itemLabel} ${index + 1}`;
        const removeButton = (
          <button type="button" onClick={() => remove(index)} aria-label={`Supprimer : ${label}`} title={`Supprimer : ${label}`} style={REMOVE_STYLE}>
            ✕
          </button>
        );
        if (variant === 'inline') {
          return (
            <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>{renderItem(item, controls(index))}</div>
              {removeButton}
            </div>
          );
        }
        return (
          <div key={index} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="field-label" style={{ margin: 0 }}>{label}</span>
              {removeButton}
            </div>
            {renderItem(item, controls(index))}
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-secondary"
        style={{ padding: '5px 10px', fontSize: '0.8rem', marginTop: 4, alignSelf: 'flex-start' }}
        onClick={add}
      >
        + {addLabel}
      </button>
    </div>
  );
}
