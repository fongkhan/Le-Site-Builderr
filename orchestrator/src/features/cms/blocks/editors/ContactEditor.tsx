import type { BlockEditorProps } from '../types';
import { setField } from '../blockFields';
import { AiTextField } from '../fields/AiText';
import { FieldHint, TextField } from '../fields/TextField';

export function ContactEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <AiTextField label="Texte d'introduction" siteSlug={siteSlug} value={block.subtitle} onChange={(v) => setField(update, 'subtitle', v)} multiline />
      <TextField label="Texte du bouton d'envoi" value={block.ctaText} onChange={(v) => setField(update, 'ctaText', v)} />
      <FieldHint>Les messages envoyés depuis le site arrivent par email aux comptes rattachés au site.</FieldHint>
    </>
  );
}
