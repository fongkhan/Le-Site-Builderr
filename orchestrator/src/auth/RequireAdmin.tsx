import { Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { EmptyState } from '../components/ui/EmptyState';
import { BackToSitesLink } from '../components/ui/BackToSitesLink';

export function RequireAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <div className="glass-panel animate-slide" style={{ maxWidth: 560, margin: '80px auto' }}>
        <EmptyState
          icon="🔐"
          title="Accès réservé aux administrateurs"
          description="Cette section permet de gérer l'ensemble des sites hébergés et les comptes utilisateurs. Votre compte n'a pas les droits nécessaires."
          action={<BackToSitesLink />}
        />
      </div>
    );
  }

  return <Outlet />;
}
