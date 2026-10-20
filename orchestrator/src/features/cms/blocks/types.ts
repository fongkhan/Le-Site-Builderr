import type { Block, Theme } from '../../../types';
import type { LinkTargets } from '../lib/ctaLink';

export interface UpdateOptions {
  /** true : enregistrement immédiat (changement de structure) ; débouncé sinon (frappe) */
  immediate?: boolean;
}

/**
 * Modifie un bloc. La recette reçoit une copie de la DERNIÈRE version du bloc (adressé par
 * son identifiant client) : un retour asynchrone (IA, téléversement) n'écrase jamais les
 * éditions faites pendant l'attente.
 */
export type BlockUpdater = (recipe: (draft: Block) => void, options?: UpdateOptions) => void;

export interface BlockEditorProps {
  block: Block;
  siteSlug: string;
  update: BlockUpdater;
  /** Pages et formulaires proposés pour le lien des boutons (facultatif : syntaxe seule) */
  linkTargets?: LinkTargets;
}

export interface BlockPreviewProps {
  block: Block;
  theme: Theme;
}
