import { useState } from 'react';
import { aiAssist, preferredProvider } from '../../api/ai';
import { ApiError, errorMessage } from '../../api/client';
import type { Post } from '../../api/posts';
import { ImageField } from '../cms/BlockEditor';
import { useToast } from '../../components/ui/ToastContext';
import { useConfig } from '../../state/ConfigContext';
import { todayIso } from '../../lib/format';
import type { Site } from '../../types';

// Formulaire d'édition d'un article (+ génération d'un brouillon par l'IA).
export function PostEditor({ site, post, onChange, onSave, onCancel, saving }: {
  site: Site;
  post: Post;
  onChange: (update: (p: Post) => Post) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const toast = useToast();
  const { config, refresh: refreshConfig } = useConfig();
  const [aiSubject, setAiSubject] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const set = (field: keyof Post, value: string) => onChange((p) => ({ ...p, [field]: value }));

  const handleGenerate = async () => {
    if (!aiSubject.trim()) {
      toast.error("Indiquez un sujet d'article.");
      return;
    }
    setAiLoading(true);
    try {
      const res = await aiAssist(site.slug, 'article', aiSubject.trim(), site.name, preferredProvider(config));
      // Mise à jour fonctionnelle : les champs saisis pendant la génération sont conservés
      onChange((p) => ({
        ...p,
        title: res.title || p.title,
        excerpt: res.excerpt || p.excerpt,
        body: res.body || p.body,
        publishedAt: p.publishedAt || todayIso(),
      }));
      toast.success('Brouillon généré par l’IA — relisez et ajustez avant de publier.');
      setAiSubject('');
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 429 ? errorMessage(err, 'Quota IA journalier atteint.') : errorMessage(err, 'Échec de la génération.'));
    } finally {
      setAiLoading(false);
      refreshConfig(); // quota IA restant
    }
  };

  return (
    <>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>✍️ {post.slug ? "Modifier l'article" : 'Nouvel article'}</h3>

      <div style={{ background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="field-label" style={{ margin: 0 }} htmlFor="post-ai-subject">✨ Générer un brouillon avec l'IA</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="post-ai-subject" type="text" className="input-text" placeholder="Sujet (ex. « nos pains bio de l'été »)" value={aiSubject} onChange={(e) => setAiSubject(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!aiLoading) handleGenerate(); } }} />
          <button className="btn btn-secondary" onClick={handleGenerate} disabled={aiLoading}>{aiLoading ? '…' : 'Générer'}</button>
        </div>
      </div>

      <label className="field-label" htmlFor="post-title">Titre *</label>
      <input id="post-title" type="text" className="input-text" value={post.title} onChange={(e) => set('title', e.target.value)} />
      <label className="field-label" htmlFor="post-excerpt">Extrait (résumé affiché dans la liste)</label>
      <textarea id="post-excerpt" className="input-text" style={{ padding: 8 }} rows={2} value={post.excerpt || ''} onChange={(e) => set('excerpt', e.target.value)} />
      <label className="field-label">Image de couverture</label>
      <ImageField siteSlug={site.slug} value={post.coverImage || ''} placeholder="URL ou téléversement…" onChange={(v) => set('coverImage', v)} />
      <label className="field-label" htmlFor="post-tags">Étiquettes (séparées par des virgules)</label>
      <input id="post-tags" type="text" className="input-text" placeholder="pain, bio, saison" value={post.tags || ''} onChange={(e) => set('tags', e.target.value)} />
      <label className="field-label" htmlFor="post-body">Contenu — mise en forme légère : **gras**, *italique*, # Titre, - liste, [lien](https://…)</label>
      <textarea id="post-body" className="input-text" style={{ padding: 8, minHeight: 180, fontFamily: 'inherit' }} value={post.body || ''} onChange={(e) => set('body', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="field-label" htmlFor="post-status">Statut</label>
          <select id="post-status" className="select-dark" value={post.status} onChange={(e) => set('status', e.target.value)}>
            <option value="draft">Brouillon</option>
            <option value="published">Publié</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="post-date">Date de publication</label>
          <input id="post-date" type="date" className="input-text" value={(post.publishedAt || '').slice(0, 10)} onChange={(e) => set('publishedAt', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSave} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Annuler</button>
      </div>
    </>
  );
}
