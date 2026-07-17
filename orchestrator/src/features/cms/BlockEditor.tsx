import type { Block } from '../../types';

interface BlockEditorProps {
  block: Block;
  onChange: (field: string, value: unknown) => void;
  onNestedChange: (nestedField: string, index: number, field: string, value: unknown) => void;
}

// Champs d'édition rapide d'un bloc (affichés quand le bloc est déplié)
export function BlockEditor({ block, onChange, onNestedChange }: BlockEditorProps) {
  const input = (value: string | undefined, set: (v: string) => void, placeholder = '') => (
    <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={value || ''} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
  );

  return (
    <>
      {block.blockType === 'hero' && (
        <>
          <label className="field-label">Titre Hero</label>
          {input(block.title, (v) => onChange('title', v))}
          <label className="field-label">Sous-titre</label>
          <textarea className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.subtitle || ''} onChange={(e) => onChange('subtitle', e.target.value)} />
          <label className="field-label">Texte du bouton</label>
          {input(block.ctaText, (v) => onChange('ctaText', v))}
          <label className="field-label">Image de fond (URL)</label>
          {input(block.backgroundImage, (v) => onChange('backgroundImage', v))}
        </>
      )}

      {block.blockType === 'features' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.items?.map((item, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              <label className="field-label">Élément {i + 1}</label>
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={item.title || ''} onChange={(e) => onNestedChange('items', i, 'title', e.target.value)} />
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} value={item.description || ''} onChange={(e) => onNestedChange('items', i, 'description', e.target.value)} />
            </div>
          ))}
        </>
      )}

      {block.blockType === 'product-grid' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.products?.map((prod, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              <label className="field-label">Produit {i + 1}</label>
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={prod.name} onChange={(e) => onNestedChange('products', i, 'name', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} value={prod.price} onChange={(e) => onNestedChange('products', i, 'price', e.target.value)} />
            </div>
          ))}
        </>
      )}

      {block.blockType === 'gallery' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          <span className="field-label">Images pré-chargées.</span>
        </>
      )}

      {block.blockType === 'testimonials' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.testimonials?.map((testi, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              <label className="field-label">Témoignage {i + 1}</label>
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={testi.quote} onChange={(e) => onNestedChange('testimonials', i, 'quote', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Auteur" value={testi.author} onChange={(e) => onNestedChange('testimonials', i, 'author', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Rôle" value={testi.role} onChange={(e) => onNestedChange('testimonials', i, 'role', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} placeholder="Avatar (URL)" value={testi.avatar} onChange={(e) => onNestedChange('testimonials', i, 'avatar', e.target.value)} />
            </div>
          ))}
        </>
      )}

      {block.blockType === 'faq' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.items?.map((item, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              <label className="field-label">Question {i + 1}</label>
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Question" value={item.question || ''} onChange={(e) => onNestedChange('items', i, 'question', e.target.value)} />
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} placeholder="Réponse" value={item.answer || ''} onChange={(e) => onNestedChange('items', i, 'answer', e.target.value)} />
            </div>
          ))}
        </>
      )}

      {block.blockType === 'pricing' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.plans?.map((plan, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              <label className="field-label">Plan {i + 1}</label>
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Nom du plan" value={plan.name} onChange={(e) => onNestedChange('plans', i, 'name', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Prix" value={plan.price} onChange={(e) => onNestedChange('plans', i, 'price', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Description" value={plan.description} onChange={(e) => onNestedChange('plans', i, 'description', e.target.value)} />
              <label className="field-label" style={{ marginTop: 4 }}>Caractéristiques (séparées par des virgules)</label>
              <input
                type="text"
                className="input-text"
                style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }}
                value={plan.features ? plan.features.map((f) => f.feature).join(', ') : ''}
                onChange={(e) => {
                  const feats = e.target.value.split(',').map((s) => ({ feature: s.trim() })).filter((f) => f.feature.length > 0);
                  onNestedChange('plans', i, 'features', feats);
                }}
              />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Texte CTA" value={plan.ctaText} onChange={(e) => onNestedChange('plans', i, 'ctaText', e.target.value)} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <input type="checkbox" id={`popular-${i}`} checked={plan.isPopular || false} onChange={(e) => onNestedChange('plans', i, 'isPopular', e.target.checked)} />
                <label htmlFor={`popular-${i}`} style={{ fontSize: '0.75rem', color: 'white', cursor: 'pointer' }}>Plan populaire</label>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
