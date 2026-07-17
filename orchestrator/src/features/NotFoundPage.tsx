import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <div className="glass-panel animate-slide" style={{ maxWidth: 560, margin: '80px auto' }}>
      <EmptyState
        icon="🧭"
        title="Page introuvable"
        description="L'adresse demandée n'existe pas ou a été déplacée."
        action={
          <Link to="/sites" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            ← Retour à mes sites
          </Link>
        }
      />
    </div>
  );
}
