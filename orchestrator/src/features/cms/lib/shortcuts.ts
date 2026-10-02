// Raccourcis clavier de l'éditeur (Ctrl/Cmd+Z…) : laissés au champ qui a le focus quand
// celui-ci a sa propre annulation (saisie de texte). Une case à cocher, un bouton radio
// ou un curseur n'en ont pas : l'annuler de l'éditeur s'applique.

/** Types d'<input> sans saisie de texte (pas d'annulation native du navigateur) */
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

export interface ShortcutTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Vrai si l'élément gère lui-même Ctrl+Z (champ de saisie de texte) */
export function hasNativeUndo(target: ShortcutTarget): boolean {
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
}
