import type { BlockEditorProps } from '../types';
import { setField } from '../blockFields';
import { AiTextField } from '../fields/AiText';
import { ImageField } from '../fields/ImageField';
import { TextField } from '../fields/TextField';

export function HeroEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <AiTextField label="Titre" siteSlug={siteSlug} value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <AiTextField label="Sous-titre" siteSlug={siteSlug} value={block.subtitle} onChange={(v) => setField(update, 'subtitle', v)} multiline />
      <TextField label="Texte du bouton" value={block.ctaText} onChange={(v) => setField(update, 'ctaText', v)} />
      <ImageField label="Image de fond" siteSlug={siteSlug} value={block.backgroundImage} onChange={(v) => setField(update, 'backgroundImage', v)} />
    </>
  );
}
