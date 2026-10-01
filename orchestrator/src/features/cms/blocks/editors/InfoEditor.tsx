import type { BlockEditorProps } from '../types';
import { setField } from '../blockFields';
import { TextField } from '../fields/TextField';

export function InfoEditor({ block, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <TextField label="Adresse" value={block.address} onChange={(v) => setField(update, 'address', v)} />
      <TextField label="Téléphone" value={block.phone} onChange={(v) => setField(update, 'phone', v)} />
      <TextField label="Email affiché" value={block.email} onChange={(v) => setField(update, 'email', v)} />
      <TextField label="Horaires (une ligne par jour)" multiline rows={3} value={block.hours} onChange={(v) => setField(update, 'hours', v)} />
      <TextField label="Fiche Google Business (lien https)" placeholder="https://g.page/…" value={block.googleBusinessUrl} onChange={(v) => setField(update, 'googleBusinessUrl', v)} />
    </>
  );
}
