import { Link } from 'react-router-dom';

// Appel à l'action commun des écrans d'erreur et d'accès refusé.
export function BackToSitesLink() {
  return (
    <Link to="/sites" className="btn btn-primary" style={{ textDecoration: 'none' }}>
      ← Retour à mes sites
    </Link>
  );
}
