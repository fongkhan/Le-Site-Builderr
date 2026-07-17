import { Outlet, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <div className="glass-panel animate-slide" style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: '2.5rem' }}>🔐</span>
        <h2>Accès réservé aux administrateurs</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Cette section permet de gérer l'ensemble des sites hébergés et les comptes utilisateurs.
          Votre compte n'a pas les droits nécessaires.
        </p>
        <Link to="/sites" className="btn btn-primary" style={{ textDecoration: 'none', alignSelf: 'center' }}>
          ← Retour à mes sites
        </Link>
      </div>
    );
  }

  return <Outlet />;
}
