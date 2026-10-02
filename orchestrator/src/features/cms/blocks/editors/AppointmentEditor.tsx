import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { AiTextField } from '../fields/AiText';
import { FieldHint, TextField } from '../fields/TextField';

export function AppointmentEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <AiTextField label="Texte d'introduction" siteSlug={siteSlug} value={block.subtitle} onChange={(v) => setField(update, 'subtitle', v)} multiline />
      <TextField label="Texte du bouton" value={block.ctaText} onChange={(v) => setField(update, 'ctaText', v)} />
      <ItemListEditor
        title="Prestations proposées"
        variant="inline"
        items={block.services}
        onUpdate={blockList(update, 'services')}
        newItem={NEW_ITEMS.appointment}
        itemLabel="Prestation"
        addLabel="Ajouter une prestation"
        renderItem={(service, { update: updateItem, index }) => (
          <TextField compact label={`Prestation ${index + 1}`} placeholder="Nom de la prestation" value={service.name} onChange={(v) => updateItem((d) => { d.name = v; })} />
        )}
      />
      <FieldHint>Les demandes de rendez-vous arrivent par email aux comptes rattachés au site.</FieldHint>
    </>
  );
}
