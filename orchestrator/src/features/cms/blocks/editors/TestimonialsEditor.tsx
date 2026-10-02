import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { ImageField } from '../fields/ImageField';
import { TextField } from '../fields/TextField';

export function TestimonialsEditor({ block, siteSlug, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        items={block.testimonials}
        onUpdate={blockList(update, 'testimonials')}
        newItem={NEW_ITEMS.testimonials}
        itemLabel="Témoignage"
        addLabel="Ajouter un témoignage"
        renderItem={(testimonial, { update: updateItem }) => (
          <>
            <TextField compact multiline label="Témoignage" value={testimonial.quote} onChange={(v) => updateItem((d) => { d.quote = v; })} />
            <TextField compact label="Auteur" value={testimonial.author} onChange={(v) => updateItem((d) => { d.author = v; })} />
            <TextField compact label="Rôle" value={testimonial.role} onChange={(v) => updateItem((d) => { d.role = v; })} />
            <ImageField siteSlug={siteSlug} value={testimonial.avatar} placeholder="Photo (avatar)" onChange={(v) => updateItem((d) => { d.avatar = v; })} />
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 0' }}>
              Note
              <select
                className="select-dark"
                style={{ padding: 4, fontSize: '0.8rem', width: 'auto' }}
                value={testimonial.rating ?? 0}
                onChange={(e) => updateItem((d) => { d.rating = Number(e.target.value); })}
              >
                <option value={0}>Sans note</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n}/5)</option>)}
              </select>
            </label>
          </>
        )}
      />
    </>
  );
}
