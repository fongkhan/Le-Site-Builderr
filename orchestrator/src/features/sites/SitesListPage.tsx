import { Link, Navigate } from 'react-router-dom';
import { useSites } from '../../state/SitesContext';
import { useAuth } from '../../auth/AuthContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import type { Site } from '../../types';

export function SitesListPage() {
  const { sites, loading } = useSites();
  const { isAdmin } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement de vos sites…" />
      </div>
    );
  }

  // Un client sans site n'a rien à voir ici : on l'emmène directement créer son premier site
  if (!isAdmin && sites.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  if (sites.length === 0) {
    return (
      <div className="glass-panel animate-slide" style={{ maxWidth: 640, margin: '40px auto' }}>
        <EmptyState
          icon="🌐"
          title="Aucun site pour le moment"
          description="Créez votre premier site avec l'assistant IA : décrivez votre activité et obtenez une ébauche complète (structure, contenu, design) en quelques secondes."
          action={
            <Link to="/onboarding" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              ✨ Créer mon premier site
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.75rem' }}>Mes sites</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Sélectionnez un site pour personnaliser son design, son contenu, ou le publier.
          </p>
        </div>
        <Link to="/onboarding" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          ✨ Nouveau site avec l'IA
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {sites.map((site) => (
          <SiteCard key={site.slug} site={site} />
        ))}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'En ligne', color: 'var(--accent-emerald)' },
  error: { label: 'Erreur de build', color: 'var(--accent-rose)' },
  draft: { label: 'Brouillon — jamais déployé', color: 'var(--amber-400)' },
};

function SiteCard({ site }: { site: Site }) {
  const status = STATUS_LABELS[site.status] ?? STATUS_LABELS.draft;
  const deployed = site.status === 'active';

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h3 style={{ fontSize: '1.15rem' }}>{site.name}</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{site.domain}</span>
        </div>
        <span className="badge" style={{ whiteSpace: 'nowrap' }}>{site.stack}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
        <span className="status-dot" style={{ background: status.color }} />
        <span style={{ color: status.color }}>{status.label}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        <Link to={`/sites/${site.slug}/design`} className="btn btn-primary" style={{ textDecoration: 'none', flex: 1, justifyContent: 'center', padding: '9px 12px', fontSize: '0.85rem' }}>
          Gérer le site →
        </Link>
        {deployed && (
          <a href={`/preview/${site.slug}/index.html`} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none', padding: '9px 12px', fontSize: '0.85rem' }}>
            Voir en ligne ↗
          </a>
        )}
      </div>
    </div>
  );
}
