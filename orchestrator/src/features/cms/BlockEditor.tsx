import { useRef, useState } from 'react';
import { uploadMedia } from '../../api/media';
import { aiAssist } from '../../api/ai';
import { useToast } from '../../components/ui/ToastContext';
import type { Block } from '../../types';

// Champ texte avec bouton « ✨ » : réécrit/améliore le contenu via l'assistant IA.
function AiText({ siteSlug, value, onChange, multiline, placeholder }: {
  siteSlug: string;
  value: string | undefined;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const improve = async () => {
    if (!value || !value.trim()) {
      toast.info('Écrivez d’abord un texte, puis ✨ l’améliore.');
      return;
    }
    setBusy(true);
    try {
      const { text } = await aiAssist(siteSlug, 'rewrite', value);
      if (text) {
        onChange(text);
        toast.success('Texte amélioré par l’IA.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "L'assistant IA n'a pas pu répondre.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: multiline ? 'flex-start' : 'center' }}>
      {multiline ? (
        <textarea className="input-text" style={{ padding: 6, fontSize: '0.875rem', flex: 1 }} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem', flex: 1 }} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      <button
        type="button"
        className="btn btn-secondary"
        style={{ padding: '4px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        onClick={improve}
        disabled={busy}
        title="Améliorer ce texte avec l'IA"
      >
        {busy ? '…' : '✨'}
      </button>
    </div>
  );
}

interface BlockEditorProps {
  block: Block;
  siteSlug: string;
  onChange: (field: string, value: unknown) => void;
  onNestedChange: (nestedField: string, index: number, field: string, value: unknown) => void;
  onArrayChange: (field: string, value: unknown[], immediate?: boolean) => void;
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Champ image : URL libre OU téléversement dans la médiathèque du site (bouton 📤).
function ImageField({ siteSlug, value, placeholder, onChange }: {
  siteSlug: string;
  value: string | undefined;
  placeholder?: string;
  onChange: (url: string) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez choisir un fichier image (PNG, JPEG, WebP…).');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Image trop volumineuse (4 Mo maximum).');
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadMedia(siteSlug, file);
      onChange(url);
      toast.success('Image téléversée dans la médiathèque.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du téléversement.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="text"
        className="input-text"
        style={{ padding: 4, fontSize: '0.825rem', flex: 1 }}
        placeholder={placeholder || 'URL de l’image ou 📤'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-secondary"
        style={{ padding: '4px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title="Téléverser une image dans la médiathèque du site"
      >
        {uploading ? '…' : '📤'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}

// Gabarit d'un nouvel item par type de bloc (pour le bouton « + ajouter »).
const NEW_ITEM: Record<string, unknown> = {
  features: { title: 'Nouveau service', description: 'Description.' },
  faq: { question: 'Nouvelle question ?', answer: 'Réponse.' },
  'product-grid': { name: 'Nouveau produit', price: '0.00 €', image: '' },
  testimonials: { quote: 'Un retour client.', author: 'Prénom Nom', role: 'Client', avatar: '' },
  pricing: { name: 'Nouvelle formule', price: '0.00 €', description: '', features: [], ctaText: 'Choisir', isPopular: false },
};

// Champs d'édition rapide d'un bloc (affichés quand le bloc est déplié)
export function BlockEditor({ block, siteSlug, onChange, onNestedChange, onArrayChange }: BlockEditorProps) {
  const input = (value: string | undefined, set: (v: string) => void, placeholder = '') => (
    <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={value || ''} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
  );

  // Accès générique au tableau d'un champ (block est une union : on lit via cast)
  const arr = (field: string): unknown[] => ((block as unknown as Record<string, unknown>)[field] as unknown[]) ?? [];

  const addItem = (field: string) => {
    const template = NEW_ITEM[block.blockType] ?? {};
    onArrayChange(field, [...arr(field), structuredClone(template)], true);
  };

  const removeItem = (field: string, index: number) => {
    onArrayChange(field, arr(field).filter((_, i) => i !== index), true);
  };

  // Petit en-tête d'item avec bouton de suppression
  const itemHeader = (label: string, field: string, index: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <label className="field-label">{label}</label>
      <button
        type="button"
        onClick={() => removeItem(field, index)}
        aria-label={`Supprimer ${label}`}
        style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 4px' }}
      >
        ✕
      </button>
    </div>
  );

  const addButton = (label: string, field: string) => (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ padding: '5px 10px', fontSize: '0.8rem', marginTop: 6, alignSelf: 'flex-start' }}
      onClick={() => addItem(field)}
    >
      + {label}
    </button>
  );

  return (
    <>
      {block.blockType === 'hero' && (
        <>
          <label className="field-label">Titre Hero</label>
          <AiText siteSlug={siteSlug} value={block.title} onChange={(v) => onChange('title', v)} />
          <label className="field-label">Sous-titre</label>
          <AiText siteSlug={siteSlug} value={block.subtitle} onChange={(v) => onChange('subtitle', v)} multiline />
          <label className="field-label">Texte du bouton</label>
          {input(block.ctaText, (v) => onChange('ctaText', v))}
          <label className="field-label">Image de fond</label>
          <ImageField siteSlug={siteSlug} value={block.backgroundImage} onChange={(v) => onChange('backgroundImage', v)} />
        </>
      )}

      {block.blockType === 'features' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.items?.map((item, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              {itemHeader(`Élément ${i + 1}`, 'items', i)}
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={item.title || ''} onChange={(e) => onNestedChange('items', i, 'title', e.target.value)} />
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} value={item.description || ''} onChange={(e) => onNestedChange('items', i, 'description', e.target.value)} />
            </div>
          ))}
          {addButton('Ajouter un élément', 'items')}
        </>
      )}

      {block.blockType === 'product-grid' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.products?.map((prod, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              {itemHeader(`Produit ${i + 1}`, 'products', i)}
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Nom" value={prod.name} onChange={(e) => onNestedChange('products', i, 'name', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Prix" value={prod.price} onChange={(e) => onNestedChange('products', i, 'price', e.target.value)} />
              <ImageField siteSlug={siteSlug} value={prod.image} placeholder="Image du produit" onChange={(v) => onNestedChange('products', i, 'image', v)} />
            </div>
          ))}
          {addButton('Ajouter un produit', 'products')}
        </>
      )}

      {block.blockType === 'gallery' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          <label className="field-label" style={{ marginTop: 4 }}>Images (URL)</label>
          {block.images?.map((url, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <ImageField
                  siteSlug={siteSlug}
                  value={url}
                  placeholder="https://…"
                  onChange={(v) => {
                    const next = [...(block.images ?? [])];
                    next[i] = v;
                    onArrayChange('images', next);
                  }}
                />
              </div>
              <button type="button" onClick={() => removeItem('images', i)} aria-label={`Supprimer l'image ${i + 1}`} style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '5px 10px', fontSize: '0.8rem', marginTop: 2, alignSelf: 'flex-start' }}
            onClick={() => onArrayChange('images', [...(block.images ?? []), ''], true)}
          >
            + Ajouter une image
          </button>
        </>
      )}

      {block.blockType === 'testimonials' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.testimonials?.map((testi, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              {itemHeader(`Témoignage ${i + 1}`, 'testimonials', i)}
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={testi.quote} onChange={(e) => onNestedChange('testimonials', i, 'quote', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Auteur" value={testi.author} onChange={(e) => onNestedChange('testimonials', i, 'author', e.target.value)} />
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Rôle" value={testi.role} onChange={(e) => onNestedChange('testimonials', i, 'role', e.target.value)} />
              <ImageField siteSlug={siteSlug} value={testi.avatar} placeholder="Avatar" onChange={(v) => onNestedChange('testimonials', i, 'avatar', v)} />
            </div>
          ))}
          {addButton('Ajouter un témoignage', 'testimonials')}
        </>
      )}

      {block.blockType === 'faq' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.items?.map((item, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              {itemHeader(`Question ${i + 1}`, 'items', i)}
              <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Question" value={item.question || ''} onChange={(e) => onNestedChange('items', i, 'question', e.target.value)} />
              <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} placeholder="Réponse" value={item.answer || ''} onChange={(e) => onNestedChange('items', i, 'answer', e.target.value)} />
            </div>
          ))}
          {addButton('Ajouter une question', 'items')}
        </>
      )}

      {block.blockType === 'pricing' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          {block.plans?.map((plan, i) => (
            <div key={i} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
              {itemHeader(`Plan ${i + 1}`, 'plans', i)}
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
          {addButton('Ajouter une formule', 'plans')}
        </>
      )}

      {block.blockType === 'contact' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          <label className="field-label">Texte d'introduction</label>
          <AiText siteSlug={siteSlug} value={block.subtitle} onChange={(v) => onChange('subtitle', v)} multiline />
          <label className="field-label">Texte du bouton d'envoi</label>
          {input(block.ctaText, (v) => onChange('ctaText', v))}
          <span className="field-label" style={{ fontStyle: 'italic' }}>
            Les messages envoyés depuis le site arrivent par email aux comptes rattachés au site.
          </span>
        </>
      )}

      {block.blockType === 'info' && (
        <>
          <label className="field-label">Titre du bloc</label>
          {input(block.title, (v) => onChange('title', v))}
          <label className="field-label">Adresse</label>
          {input(block.address, (v) => onChange('address', v))}
          <label className="field-label">Téléphone</label>
          {input(block.phone, (v) => onChange('phone', v))}
          <label className="field-label">Email affiché</label>
          {input(block.email, (v) => onChange('email', v))}
          <label className="field-label">Horaires (une ligne par jour)</label>
          <textarea className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} rows={3} value={block.hours || ''} onChange={(e) => onChange('hours', e.target.value)} />
        </>
      )}

      {block.blockType === 'footer' && (
        <>
          <label className="field-label">Texte du pied de page</label>
          {input(block.text, (v) => onChange('text', v))}
          {(['facebook', 'instagram', 'linkedin', 'x'] as const).map((network) => (
            <div key={network}>
              <label className="field-label" style={{ textTransform: 'capitalize' }}>{network === 'x' ? 'X (Twitter)' : network}</label>
              {input(block.socials?.[network], (v) => onChange('socials', { ...(block.socials || {}), [network]: v }))}
            </div>
          ))}
          <span className="field-label" style={{ fontStyle: 'italic' }}>
            Placez ce bloc en dernier : il est rendu tout en bas de la page.
          </span>
        </>
      )}
    </>
  );
}
