import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog';

// Empêche de perdre des modifications non enregistrées : bloque la navigation interne
// (react-router) avec un ConfirmDialog, et arme l'avertissement natif du navigateur
// à la fermeture/rechargement de l'onglet. Actif seulement quand `when` est vrai.
export function UnsavedChangesPrompt({ when }: { when: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);

  if (blocker.state !== 'blocked') return null;

  return (
    <ConfirmDialog
      title="Modifications non enregistrées"
      message="Des modifications ne sont pas encore enregistrées. Si vous quittez maintenant, elles seront perdues."
      confirmLabel="Quitter sans enregistrer"
      cancelLabel="Rester sur la page"
      danger
      onConfirm={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    />
  );
}
