import type { Block } from '../../../../types';
import type { BlockEditorProps } from '../types';
import { setField } from '../blockFields';
import { FieldHint, TextField } from '../fields/TextField';

type SocialNetwork = keyof NonNullable<Block['socials']>;

const NETWORKS: { key: SocialNetwork; label: string }[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X (Twitter)' },
];

export function FooterEditor({ block, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Texte du pied de page" value={block.text} onChange={(v) => setField(update, 'text', v)} />
      {NETWORKS.map(({ key, label }) => (
        <TextField
          key={key}
          label={label}
          placeholder="https://…"
          value={block.socials?.[key]}
          onChange={(v) => update((d) => { d.socials = { ...d.socials, [key]: v }; })}
        />
      ))}
      <FieldHint>Placez ce bloc en dernier : il est rendu tout en bas de la page.</FieldHint>
    </>
  );
}
