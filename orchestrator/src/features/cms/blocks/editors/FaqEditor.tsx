import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { TextField } from '../fields/TextField';

export function FaqEditor({ block, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        items={block.items}
        onUpdate={blockList(update, 'items')}
        newItem={NEW_ITEMS.faq}
        itemLabel="Question"
        addLabel="Ajouter une question"
        renderItem={(item, { update: updateItem }) => (
          <>
            <TextField compact label="Question" value={item.question} onChange={(v) => updateItem((d) => { d.question = v; })} />
            <TextField compact multiline label="Réponse" value={item.answer} onChange={(v) => updateItem((d) => { d.answer = v; })} />
          </>
        )}
      />
    </>
  );
}
