import { EmptyState } from '../components/ui/EmptyState';
import { BackToSitesLink } from '../components/ui/BackToSitesLink';

export function NotFoundPage() {
  return (
    <div className="glass-panel animate-slide" style={{ maxWidth: 560, margin: '80px auto' }}>
      <EmptyState
        icon="🧭"
        title="Page introuvable"
        description="L'adresse demandée n'existe pas ou a été déplacée."
        action={<BackToSitesLink />}
      />
    </div>
  );
}
