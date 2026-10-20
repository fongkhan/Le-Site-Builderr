import type { BlockEditorProps } from '../types';
import { setField } from '../blockFields';
import { AiTextField } from '../fields/AiText';
import { ImageField } from '../fields/ImageField';
import { LinkField } from '../fields/LinkField';
import { TextField } from '../fields/TextField';

export function HeroEditor({ block, siteSlug, update, linkTargets }: BlockEditorProps) {
  return (
    <>
      <AiTextField label="Titre" siteSlug={siteSlug} value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <AiTextField label="Sous-titre" siteSlug={siteSlug} value={block.subtitle} onChange={(v) => setField(update, 'subtitle', v)} multiline />
      <TextField label="Texte du bouton" value={block.ctaText} onChange={(v) => setField(update, 'ctaText', v)} />
      <LinkField label="Lien du bouton" value={block.ctaLink} targets={linkTargets} onChange={(v, o) => setField(update, 'ctaLink', v, o)} />
      <ImageField label="Image de fond" siteSlug={siteSlug} value={block.backgroundImage} onChange={(v) => setField(update, 'backgroundImage', v)} />
    </>
  );
}
