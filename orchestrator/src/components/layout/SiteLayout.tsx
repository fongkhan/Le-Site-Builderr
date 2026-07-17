import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useSites } from '../../state/SitesContext';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import type { Site } from '../../types';

const STEPS = [
  { path: 'design', num: 1, label: 'Design' },
  { path: 'cms', num: 2, label: 'Contenu' },
  { path: 'deploy', num: 3, label: 'Déploiement' },
];

// Sous-navigation d'un site : stepper Design -> Contenu -> Déploiement.
// Vérifie que le slug de l'URL correspond bien à un site accessible par l'utilisateur.
export function SiteLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { sites, loading, getSite } = useSites();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement de vos sites…" />
      </div>
    );
  }

  const site = slug ? getSite(slug) : undefined;

  if (!site) {
    return (
      <div className="glass-panel" style={{ maxWidth: 560, margin: '60px auto' }}>
        <EmptyState
          icon="🔍"
          title="Site introuvable ou accès refusé"
          description={
            sites.length > 0
              ? "Ce site n'existe pas ou n'est pas rattaché à votre compte."
              : "Aucun site n'est rattaché à votre compte pour le moment."
          }
          action={
            <Link to="/sites" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              ← Retour à mes sites
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SiteHeader site={site} />
      <Outlet context={{ site }} />
    </div>
  );
}

function SiteHeader({ site }: { site: Site }) {
  const deployed = site.status === 'active';
  return (
    <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 15, padding: '16px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: '1.3rem' }}>{site.name}</h2>
          {deployed ? (
            <a
              href={`/preview/${site.slug}/index.html`}
              target="_blank"
              rel="noreferrer"
              className="badge"
              style={{ color: 'var(--accent-emerald)', textDecoration: 'none', borderColor: 'rgba(16,185,129,0.4)' }}
            >
              ● En ligne — voir le site ↗
            </a>
          ) : (
            <span
              className="badge"
              style={{ color: 'var(--amber-400)', borderColor: 'rgba(251,191,36,0.35)' }}
              title="Lancez un déploiement (étape 3) pour générer et publier le site."
            >
              ○ Jamais déployé
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{site.domain} · {site.stack}</span>
      </div>
      <nav className="site-stepper" aria-label="Étapes du site">
        {STEPS.map((step, i) => (
          <span key={step.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span className="site-step-sep">→</span>}
            <NavLink to={step.path} className={({ isActive }) => `site-step ${isActive ? 'active' : ''}`}>
              <span className="site-step-num">{step.num}</span>
              {step.label}
            </NavLink>
          </span>
        ))}
      </nav>
    </div>
  );
}
