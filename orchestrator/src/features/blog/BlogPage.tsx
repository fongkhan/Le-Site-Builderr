import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { fetchPosts, savePost, deletePost } from '../../api/posts';
import type { Post } from '../../api/posts';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import type { Site } from '../../types';

const EMPTY: Post = { title: '', slug: '', excerpt: '', coverImage: '', body: '', status: 'draft', publishedAt: null };

const todayIso = () => new Date().toISOString().slice(0, 10);

export function BlogPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Post | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetchPosts(site.slug)
      .then((d) => setPosts(d.docs || []))
      .catch(() => toast.error('Impossible de charger les articles.'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [site.slug]);

  const startNew = () => setEditing({ ...EMPTY, publishedAt: todayIso() });
  const startEdit = (p: Post) => setEditing({ ...EMPTY, ...p });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("Le titre de l'article est requis.");
      return;
    }
    setSaving(true);
    try {
      await savePost(site.slug, editing);
      toast.success('Article enregistré.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deletePost(site.slug, toDelete.slug);
      toast.success('Article supprimé.');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    } finally {
      setDeleting(false);
    }
  };

  const set = (field: keyof Post, value: string) => setEditing((e) => (e ? { ...e, [field]: value } : e));

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner label="Chargement des articles…" /></div>;
  }

  return (
    <div className="animate-slide grid-2col">
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem' }}>Blog & actualités</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: 5 }}>
              Publiez des articles : excellent pour le référencement et pour informer vos clients.
            </p>
          </div>
          <button className="btn btn-primary" onClick={startNew}>+ Nouvel article</button>
        </div>

        {posts.length === 0 ? (
          <EmptyState icon="📰" title="Aucun article" description="Créez votre premier article pour lancer le blog du site." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {posts.map((p) => (
              <div key={p.slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span className="badge" style={{ fontSize: '0.68rem', color: p.status === 'published' ? 'var(--accent-emerald)' : 'var(--amber-400)' }}>
                      {p.status === 'published' ? 'Publié' : 'Brouillon'}
                    </span>{' '}
                    /blog/{p.slug}{p.publishedAt ? ` · ${new Date(p.publishedAt).toLocaleDateString('fr-FR')}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => startEdit(p)}>Éditer</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', color: 'var(--accent-rose)' }} onClick={() => setToDelete(p)}>Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {editing ? (
          <>
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>✍️ {editing.slug ? "Modifier l'article" : 'Nouvel article'}</h3>
            <label className="field-label">Titre *</label>
            <input type="text" className="input-text" value={editing.title} onChange={(e) => set('title', e.target.value)} />
            <label className="field-label">Extrait (résumé affiché dans la liste)</label>
            <textarea className="input-text" style={{ padding: 8 }} rows={2} value={editing.excerpt || ''} onChange={(e) => set('excerpt', e.target.value)} />
            <label className="field-label">Image de couverture (URL)</label>
            <input type="text" className="input-text" placeholder="https://…" value={editing.coverImage || ''} onChange={(e) => set('coverImage', e.target.value)} />
            <label className="field-label">Contenu (une ligne vide = nouveau paragraphe)</label>
            <textarea className="input-text" style={{ padding: 8, minHeight: 180, fontFamily: 'inherit' }} value={editing.body || ''} onChange={(e) => set('body', e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">Statut</label>
                <select className="select-dark" value={editing.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="draft">Brouillon</option>
                  <option value="published">Publié</option>
                </select>
              </div>
              <div>
                <label className="field-label">Date de publication</label>
                <input type="date" className="input-text" value={(editing.publishedAt || '').slice(0, 10)} onChange={(e) => set('publishedAt', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 10px' }}>
            Sélectionnez un article à éditer, ou créez-en un nouveau.
            <div style={{ fontSize: '0.85rem', marginTop: 8 }}>Seuls les articles <strong>publiés</strong> apparaissent sur le site au prochain déploiement.</div>
          </div>
        )}
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Supprimer cet article ?"
          message={`« ${toDelete.title} » sera retiré du blog au prochain déploiement.`}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
