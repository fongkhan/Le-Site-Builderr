import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { INVALID_LINK_MESSAGE, resetPasswordErrorMessage } from './resetPasswordError';

describe('réinitialisation du mot de passe : message d’erreur', () => {
  it('400 : la raison du refus de la politique est affichée (le lien reste valable)', () => {
    const msg = 'Ce mot de passe est trop courant : choisissez-en un autre.';
    expect(resetPasswordErrorMessage(new ApiError(400, msg))).toBe(msg);
    expect(resetPasswordErrorMessage(new ApiError(400, msg))).not.toBe(INVALID_LINK_MESSAGE);
  });

  it('400 sans message exploitable : refus du mot de passe, pas « lien expiré »', () => {
    const out = resetPasswordErrorMessage(new ApiError(400, 'Erreur HTTP 400'));
    expect(out).not.toBe(INVALID_LINK_MESSAGE);
    expect(out).toContain('mot de passe');
  });

  it('403 et 404 : lien invalide ou expiré', () => {
    expect(resetPasswordErrorMessage(new ApiError(403, 'Token is either invalid or has expired.'))).toBe(INVALID_LINK_MESSAGE);
    expect(resetPasswordErrorMessage(new ApiError(404, 'Not Found'))).toBe(INVALID_LINK_MESSAGE);
  });

  it('429 et erreurs réseau : messages dédiés', () => {
    expect(resetPasswordErrorMessage(new ApiError(429, 'x'))).toContain('Trop de tentatives');
    expect(resetPasswordErrorMessage(new ApiError(0, 'x'))).toContain('injoignable');
    expect(resetPasswordErrorMessage(new Error('boom'))).toContain('injoignable');
  });
});
