import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../../../components/ui/ToastContext';
import { restoreItem } from '../lib/editorModel';
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

let keySeq = 0;
const newItemKey = () => `item-${++keySeq}`;

const REMOVE_STYLE = { background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 4px' } as const;

// Éditeur générique d'une liste d'éléments : ajout (gabarit), suppression, édition.
// Toutes les modifications passent par onUpdate, appliqué à la dernière version de la liste.
// Chaque élément a une clé locale (jamais envoyée au serveur) : un retour asynchrone
// (téléversement d'image) vise l'élément qui l'a lancé, même si un autre a été supprimé
// entre-temps, et il est ignoré si cet élément a lui-même été supprimé.
export function ItemListEditor<T>({ items, onUpdate, newItem, itemLabel, addLabel, renderItem, variant = 'card', title }: ItemListEditorProps<T>) {
  const toast = useToast();
  const list = items ?? [];
  const [keys, setKeys] = useState<string[]>(() => list.map(newItemKey));
  const keysRef = useRef(keys);
  // Liste modifiée hors de cet éditeur (IA, rechargement) : nouvelles clés, et les retours
  // asynchrones en attente sont ignorés plutôt qu'appliqués au mauvais élément.
  if (keys.length !== list.length) setKeys(list.map(newItemKey));
  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  const setKeysNow = (next: string[]) => {
    keysRef.current = next;
    setKeys(next);
  };

  const add = () => {
    setKeysNow([...keysRef.current, newItemKey()]);
    onUpdate((draft) => {
      draft.push(structuredClone(newItem));
    }, { immediate: true });
  };

  // Suppression annulable : l'élément et sa position sont mémorisés, « Annuler » le
  // réinsère (position bornée à la longueur actuelle) avec une clé neuve au même rang.
  const remove = (key: string, label: string) => {
    const index = keysRef.current.indexOf(key);
    if (index === -1) return;
    let removed: { item: T } | null = null;
    setKeysNow(keysRef.current.filter((k) => k !== key));
    onUpdate((draft) => {
      if (index < draft.length) removed = { item: draft.splice(index, 1)[0] };
    }, { immediate: true });
    toast.info(`Élément « ${label} » supprimé.`, {
      action: {
        label: 'Annuler',
        onClick: () => {
          if (!removed) return;
          const { item } = removed;
          onUpdate((draft) => {
            const at = Math.min(index, draft.length);
            const restored = restoreItem(draft, at, structuredClone(item));
            draft.splice(0, draft.length, ...restored);
            setKeysNow(restoreItem(keysRef.current, at, newItemKey()));
          }, { immediate: true });
        },
      },
    });
  };

  // Position ACTUELLE de l'élément (ou -1 s'il a été supprimé)
  const indexOfKey = (key: string, length: number) => {
    const index = keysRef.current.indexOf(key);
    return index < length ? index : -1;
  };

  const controls = (index: number, key: string): ItemControls<T> => ({
    index,
    update: (recipe, options) => onUpdate((draft) => {
      const current = indexOfKey(key, draft.length);
      if (current !== -1) recipe(draft[current]);
    }, options),
    set: (value) => onUpdate((draft) => {
      const current = indexOfKey(key, draft.length);
      if (current !== -1) draft[current] = value;
    }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {title && <span className="field-label" style={{ marginTop: 4 }}>{title}</span>}
      {/* eslint-disable-next-line react-hooks/refs -- controls() ne lit keysRef qu'à l'exécution des rappels (événement, retour asynchrone), jamais pendant le rendu */}
      {list.map((item, index) => {
        const key = keys[index] ?? `pending-${index}`;
        const label = `${itemLabel} ${index + 1}`;
        const removeButton = (
          <button type="button" onClick={() => remove(key, label)} aria-label={`Supprimer : ${label}`} title={`Supprimer : ${label}`} style={REMOVE_STYLE}>
            ✕
          </button>
        );
        if (variant === 'inline') {
          return (
            <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>{renderItem(item, controls(index, key))}</div>
              {removeButton}
            </div>
          );
        }
        return (
          <div key={key} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="field-label" style={{ margin: 0 }}>{label}</span>
              {removeButton}
            </div>
            {renderItem(item, controls(index, key))}
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
