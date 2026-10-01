import type { Post } from '../../api/posts';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateFr } from '../../lib/format';

export function PostList({ posts, editingSlug, onEdit, onDelete }: {
  posts: Post[];
  editingSlug: string | null;
  onEdit: (p: Post) => void;
  onDelete: (p: Post) => void;
}) {
  if (posts.length === 0) {
    return <EmptyState icon="📰" title="Aucun article" description="Créez votre premier article pour lancer le blog du site." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {posts.map((p) => (
        <div
          key={p.slug}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: editingSlug === p.slug ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border-color)', borderRadius: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span className="badge" style={{ fontSize: '0.68rem', color: p.status === 'published' ? 'var(--accent-emerald)' : 'var(--amber-400)' }}>
                {p.status === 'published' ? 'Publié' : 'Brouillon'}
              </span>{' '}
              /blog/{p.slug}{p.publishedAt ? ` · ${formatDateFr(p.publishedAt.slice(0, 10))}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => onEdit(p)}>Éditer</button>
            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', color: 'var(--accent-rose)' }} onClick={() => onDelete(p)}>Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
}
