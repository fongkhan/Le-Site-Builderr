import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { ImageField } from '../fields/ImageField';
import { TextField } from '../fields/TextField';

export function ProductGridEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        items={block.products}
        onUpdate={blockList(update, 'products')}
        newItem={NEW_ITEMS['product-grid']}
        itemLabel="Produit"
        addLabel="Ajouter un produit"
        renderItem={(product, { update: updateItem }) => (
          <>
            <TextField compact label="Nom" value={product.name} onChange={(v) => updateItem((d) => { d.name = v; })} />
            <TextField compact label="Prix" value={product.price} onChange={(v) => updateItem((d) => { d.price = v; })} />
            <ImageField siteSlug={siteSlug} value={product.image} placeholder="Image du produit" onChange={(v) => updateItem((d) => { d.image = v; })} />
          </>
        )}
      />
    </>
  );
}
