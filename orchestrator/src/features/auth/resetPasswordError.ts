import { ApiError } from '../../api/client';

export const INVALID_LINK_MESSAGE = 'Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.';
const REFUSED_PASSWORD_MESSAGE = 'Ce mot de passe est refusé : choisissez-en un autre.';

// Message affiché après l'échec de POST /api/users/reset-password. Un 400 est un mot de
// passe refusé par la politique du serveur (trop courant, identique à l'email…) : le lien
// reste valable, on affiche la raison. Un jeton invalide ou expiré répond 403 (ou 404).
export function resetPasswordErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    if (err.status === 400) return err.message && !/^Erreur HTTP \d+$/.test(err.message) ? err.message : REFUSED_PASSWORD_MESSAGE;
    if (err.status === 403 || err.status === 404) return INVALID_LINK_MESSAGE;
  }
  return 'Le serveur est injoignable pour le moment. Réessayez dans un instant.';
}
