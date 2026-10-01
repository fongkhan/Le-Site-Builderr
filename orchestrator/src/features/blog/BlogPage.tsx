import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPosts, savePost, deletePost } from '../../api/posts';
import type { Post } from '../../api/posts';
import { errorMessage } from '../../api/client';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { PostEditor } from './PostEditor';
import { todayIso } from '../../lib/format';
import { PostList } from './PostList';

const EMPTY: Post = { title: '', slug: '', excerpt: '', coverImage: '', body: '', tags: '', status: 'draft', publishedAt: null };

export function BlogPage() {
  const site = useCurrentSite();
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Article en cours d'édition + sa version d'origine (pour détecter les modifications)
  const [editing, setEditing] = useState<Post | null>(null);
  const [original, setOriginal] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Post | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Action différée tant que l'utilisateur n'a pas confirmé l'abandon de ses modifications
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    fetchPosts(site.slug)
      .then((d) => { if (id === requestId.current) setPosts(d.docs || []); })
      .catch((err) => { if (id === requestId.current) setLoadError(errorMessage(err, 'Impossible de charger les articles.')); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [site.slug]);

  // Changement de site : on repart d'une page vierge (jamais l'article d'un autre site)
  useEffect(() => {
    setEditing(null);
    setOriginal(null);
    load();
  }, [load]);

  const dirty = editing !== null && JSON.stringify(editing) !== JSON.stringify(original);

  const openEditor = (post: Post) => {
    const run = () => {
      setEditing(post);
      setOriginal(post);
    };
    if (dirty) setPendingSwitch(() => run);
    else run();
  };
  const closeEditor = () => {
    const run = () => {
      setEditing(null);
      setOriginal(null);
    };
    if (dirty) setPendingSwitch(() => run);
    else run();
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("Le titre de l'article est requis.");
      return;
    }
    setSaving(true);
    try {
      const res = await savePost(site.slug, editing);
      toast.success(editing.slug ? 'Article enregistré.' : `Article créé (adresse : /blog/${res.slug}/).`);
      setEditing(null);
      setOriginal(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Erreur lors de l'enregistrement."));
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
      if (editing?.slug === toDelete.slug) {
        setEditing(null);
        setOriginal(null);
      }
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Erreur lors de la suppression.'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading && posts.length === 0) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner label="Chargement des articles…" /></div>;
  }

  if (loadError) {
    return (
      <div className="glass-panel" style={{ maxWidth: 560, margin: '40px auto' }}>
        <EmptyState icon="⚠️" title="Impossible de charger les articles" description={loadError} action={<button className="btn btn-primary" onClick={load}>Réessayer</button>} />
      </div>
    );
  }

  return (
    <div className="animate-slide grid-2col">
      <UnsavedChangesPrompt when={dirty} message="L'article en cours d'édition n'est pas enregistré. Si vous quittez maintenant, vos modifications seront perdues." />
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem' }}>Blog & actualités</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: 5 }}>
              Publiez des articles : excellent pour le référencement et pour informer vos clients.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => openEditor({ ...EMPTY, publishedAt: todayIso() })}>+ Nouvel article</button>
        </div>

        <PostList posts={posts} editingSlug={editing?.slug || null} onEdit={(p) => openEditor({ ...EMPTY, ...p })} onDelete={setToDelete} />
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {editing ? (
          <PostEditor
            site={site}
            post={editing}
            onChange={(update) => setEditing((p) => (p ? update(p) : p))}
            onSave={handleSave}
            onCancel={closeEditor}
            saving={saving}
          />
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
      {pendingSwitch && (
        <ConfirmDialog
          title="Abandonner les modifications ?"
          message="L'article en cours d'édition n'est pas enregistré."
          confirmLabel="Abandonner"
          cancelLabel="Continuer l'édition"
          danger
          onConfirm={() => { pendingSwitch(); setPendingSwitch(null); }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
