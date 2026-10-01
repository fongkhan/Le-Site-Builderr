import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { ImageField } from '../fields/ImageField';
import { TextField } from '../fields/TextField';

export function GalleryEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        title="Images (URL ou téléversement)"
        variant="inline"
        items={block.images}
        onUpdate={blockList(update, 'images')}
        newItem={NEW_ITEMS.gallery}
        itemLabel="Image"
        addLabel="Ajouter une image"
        renderItem={(url, { set, index }) => (
          <ImageField siteSlug={siteSlug} value={url} placeholder="https://…" ariaLabel={`Image ${index + 1}`} onChange={set} />
        )}
      />
    </>
  );
}
