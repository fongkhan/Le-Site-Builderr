// Historique annuler/rétablir de l'éditeur — module pur, sans React. Les instantanés sont
// des valeurs immuables (listes de pages) : on les garde par référence, sans copie.
// La frappe est regroupée : des modifications successives du même champ (même clé de
// regroupement) à moins de GROUP_WINDOW_MS d'intervalle forment une seule étape.

export const GROUP_WINDOW_MS = 1000;

export interface History<T> {
  /** Mémorise l'état AVANT une modification ; vide la pile de rétablissement. */
  push: (snapshot: T, groupKey?: string, now?: number) => void;
  /** État précédent (current part dans la pile de rétablissement), ou undefined */
  undo: (current: T) => T | undefined;
  /** État suivant (current repart dans la pile d'annulation), ou undefined */
  redo: (current: T) => T | undefined;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export function createHistory<T>(limit = 50): History<T> {
  const past: T[] = [];
  let future: T[] = [];
  let lastKey: string | undefined;
  let lastAt = -Infinity;

  const breakGroup = () => {
    lastKey = undefined;
    lastAt = -Infinity;
  };

  return {
    push(snapshot, groupKey, now = Date.now()) {
      future = [];
      const grouped = groupKey !== undefined && groupKey === lastKey && now - lastAt < GROUP_WINDOW_MS;
      lastKey = groupKey;
      lastAt = now;
      // Même rafale de frappe : l'état d'avant la rafale est déjà mémorisé
      if (grouped && past.length > 0) return;
      past.push(snapshot);
      if (past.length > limit) past.splice(0, past.length - limit);
    },
    undo(current) {
      if (past.length === 0) return undefined;
      breakGroup();
      future.push(current);
      return past.pop();
    },
    redo(current) {
      if (future.length === 0) return undefined;
      breakGroup();
      past.push(current);
      return future.pop();
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past.length = 0;
      future = [];
      breakGroup();
    },
  };
}
