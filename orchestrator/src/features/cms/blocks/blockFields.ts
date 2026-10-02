import type { Block } from '../../../types';
import type { BlockUpdater, UpdateOptions } from './types';

// Aides d'édition des champs d'un bloc (le type Block est une union « à plat » : les
// champs de liste sont typés ici une fois pour toutes).

/** Champs d'un bloc qui sont des listes d'éléments */
export type ListField = 'items' | 'products' | 'images' | 'testimonials' | 'plans' | 'services';
export type ItemOf<K extends ListField> = NonNullable<Block[K]>[number];

/** Modifie une liste à partir de sa DERNIÈRE version (ajout, suppression, édition d'élément) */
export type ListUpdater<T> = (recipe: (list: T[]) => void, options?: UpdateOptions) => void;

export function setField<K extends keyof Block>(update: BlockUpdater, field: K, value: Block[K], options?: UpdateOptions): void {
  update((draft) => {
    draft[field] = value;
  }, options);
}

// Lie une liste d'éléments du bloc à ItemListEditor.
export function blockList<K extends ListField>(update: BlockUpdater, field: K): ListUpdater<ItemOf<K>> {
  return (recipe, options) =>
    update((draft) => {
      const fields = draft as unknown as Record<string, unknown>;
      const list = (Array.isArray(fields[field]) ? fields[field] : []) as ItemOf<K>[];
      recipe(list);
      fields[field] = list;
    }, options);
}
