import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { TextField } from '../fields/TextField';

export function FeaturesEditor({ block, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        items={block.items}
        onUpdate={blockList(update, 'items')}
        newItem={NEW_ITEMS.features}
        itemLabel="Élément"
        addLabel="Ajouter un élément"
        renderItem={(item, { update: updateItem }) => (
          <>
            <TextField compact label="Titre" value={item.title} onChange={(v) => updateItem((d) => { d.title = v; })} />
            <TextField compact multiline label="Description" value={item.description} onChange={(v) => updateItem((d) => { d.description = v; })} />
          </>
        )}
      />
    </>
  );
}
