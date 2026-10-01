import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { BackToSitesLink } from '../components/ui/BackToSitesLink';

// Écran affiché quand une page plante au rendu ou ne peut pas être chargée (ex. nouvelle
// version déployée pendant la session) : message en français et moyens de repartir.
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  console.error(error);
  return (
    <div className="glass-panel animate-slide" style={{ maxWidth: 560, margin: '80px auto' }}>
      <EmptyState
        icon={notFound ? '🧭' : '⚠️'}
        title={notFound ? 'Page introuvable' : 'Une erreur inattendue est survenue'}
        description={notFound
          ? "L'adresse demandée n'existe pas ou a été déplacée."
          : 'Rechargez la page pour réessayer. Si le problème persiste, contactez votre administrateur.'}
        action={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {!notFound && (
              <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                Recharger
              </button>
            )}
            <BackToSitesLink />
          </div>
        }
      />
    </div>
  );
}
