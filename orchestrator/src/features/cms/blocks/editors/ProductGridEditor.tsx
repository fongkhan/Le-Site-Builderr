import type { BlockEditorProps } from '../types';
import { blockList, setField, type ItemOf } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { ImageField } from '../fields/ImageField';
import { LinkField } from '../fields/LinkField';
import { TextField } from '../fields/TextField';

export function ProductGridEditor({ block, siteSlug, update, linkTargets }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      {/* Type explicite : le gabarit (NEW_ITEMS) n'a pas de lien, un produit peut en avoir un */}
      <ItemListEditor<ItemOf<'products'>>
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
            <LinkField
              compact
              label="Lien du bouton « Commander »"
              value={product.ctaLink}
              targets={linkTargets}
              onChange={(v, o) => updateItem((d) => { if (v === undefined) delete d.ctaLink; else d.ctaLink = v; }, o)}
            />
          </>
        )}
      />
    </>
  );
}
