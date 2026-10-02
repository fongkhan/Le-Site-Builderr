import type { ComponentType } from 'react';
import type { BlockEditorProps, BlockPreviewProps } from './types';
import { BLOCK_DATA, BLOCK_TYPES, isBlockType, type BlockData, type BlockType } from './definitions';
import { HeroEditor } from './editors/HeroEditor';
import { FeaturesEditor } from './editors/FeaturesEditor';
import { ProductGridEditor } from './editors/ProductGridEditor';
import { GalleryEditor } from './editors/GalleryEditor';
import { TestimonialsEditor } from './editors/TestimonialsEditor';
import { FaqEditor } from './editors/FaqEditor';
import { PricingEditor } from './editors/PricingEditor';
import { ContactEditor } from './editors/ContactEditor';
import { AppointmentEditor } from './editors/AppointmentEditor';
import { InfoEditor } from './editors/InfoEditor';
import { FooterEditor } from './editors/FooterEditor';
import { HeroPreview } from './previews/HeroPreview';
import { FeaturesPreview } from './previews/FeaturesPreview';
import { ProductGridPreview } from './previews/ProductGridPreview';
import { GalleryPreview } from './previews/GalleryPreview';
import { TestimonialsPreview } from './previews/TestimonialsPreview';
import { FaqPreview } from './previews/FaqPreview';
import { PricingPreview } from './previews/PricingPreview';
import { ContactPreview } from './previews/ContactPreview';
import { AppointmentPreview } from './previews/AppointmentPreview';
import { InfoPreview } from './previews/InfoPreview';
import { FooterPreview } from './previews/FooterPreview';

// Registre des types de blocs : SEUL endroit qui associe un type à son libellé, ses
// valeurs par défaut, son gabarit d'élément, son éditeur et son aperçu.
// Ajouter un type : server/payload.config.ts + definitions.ts + un éditeur + un aperçu
// (le test registry.test.ts échoue tant qu'une pièce manque).

export interface BlockDefinition extends BlockData {
  type: BlockType;
  Editor: ComponentType<BlockEditorProps>;
  Preview: ComponentType<BlockPreviewProps>;
}

const COMPONENTS: Record<BlockType, Pick<BlockDefinition, 'Editor' | 'Preview'>> = {
  hero: { Editor: HeroEditor, Preview: HeroPreview },
  features: { Editor: FeaturesEditor, Preview: FeaturesPreview },
  'product-grid': { Editor: ProductGridEditor, Preview: ProductGridPreview },
  gallery: { Editor: GalleryEditor, Preview: GalleryPreview },
  testimonials: { Editor: TestimonialsEditor, Preview: TestimonialsPreview },
  faq: { Editor: FaqEditor, Preview: FaqPreview },
  pricing: { Editor: PricingEditor, Preview: PricingPreview },
  contact: { Editor: ContactEditor, Preview: ContactPreview },
  appointment: { Editor: AppointmentEditor, Preview: AppointmentPreview },
  info: { Editor: InfoEditor, Preview: InfoPreview },
  footer: { Editor: FooterEditor, Preview: FooterPreview },
};

export const BLOCK_REGISTRY = Object.fromEntries(
  BLOCK_TYPES.map((type) => [type, { type, ...BLOCK_DATA[type], ...COMPONENTS[type] }]),
) as Record<BlockType, BlockDefinition>;

/** Définitions dans l'ordre de la palette d'ajout */
export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = BLOCK_TYPES.map((type) => BLOCK_REGISTRY[type]);

// Définition d'un type lu depuis le serveur (undefined si le type est inconnu du front).
export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return isBlockType(type) ? BLOCK_REGISTRY[type] : undefined;
}
