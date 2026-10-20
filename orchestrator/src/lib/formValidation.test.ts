import { describe, expect, it } from 'vitest';
import { firstInvalid, invalidProps, validateClientAccount, validateOnboarding, validateSiteName } from './formValidation';

const account = (extra: Partial<Parameters<typeof validateClientAccount>[0]> = {}) =>
  validateClientAccount({ email: 'client@exemple.fr', password: 'x'.repeat(12), quotaEnabled: false, quota: '10', ...extra });

describe('validateSiteName', () => {
  it('nom requis (blancs seuls refusés)', () => {
    expect(validateSiteName('')).toBe('Le nom du site est requis.');
    expect(validateSiteName('   ')).toBe('Le nom du site est requis.');
    expect(validateSiteName('Coiffeur Lyon')).toBeUndefined();
  });
});

describe('validateClientAccount', () => {
  it('compte valide : aucune erreur', () => {
    expect(account()).toEqual({});
  });

  it('email', () => {
    expect(account({ email: '' }).email).toBe('Un email valide est requis.');
    expect(account({ email: 'pas-un-email' }).email).toBe('Un email valide est requis.');
  });

  it('mot de passe : 12 caractères au moins', () => {
    expect(account({ password: 'x'.repeat(11) }).password).toBe('Le mot de passe doit contenir au moins 12 caractères.');
    expect(account({ password: 'x'.repeat(12) }).password).toBeUndefined();
  });

  it('quota contrôlé seulement s’il est activé', () => {
    for (const quota of ['', '-1', '1.5', 'abc']) {
      expect(account({ quotaEnabled: true, quota }).quota, quota).toBe('Le quota IA doit être un entier positif ou nul.');
      expect(account({ quotaEnabled: false, quota }).quota, quota).toBeUndefined();
    }
    expect(account({ quotaEnabled: true, quota: '0' }).quota).toBeUndefined();
    expect(account({ quotaEnabled: true, quota: ' 25 ' }).quota).toBeUndefined();
  });

  it('plusieurs erreurs à la fois', () => {
    expect(Object.keys(account({ email: '', password: '', quotaEnabled: true, quota: '' })).sort()).toEqual(['email', 'password', 'quota']);
  });
});

describe('validateOnboarding', () => {
  it('description requise', () => {
    expect(validateOnboarding({ description: ' ', inspirationType: 'preset', image: null })).toEqual({
      description: "Décrivez votre activité : c'est la base de la génération.",
    });
  });

  it('image exigée seulement pour une inspiration par image', () => {
    expect(validateOnboarding({ description: 'Boulangerie', inspirationType: 'preset', image: null })).toEqual({});
    expect(validateOnboarding({ description: 'Boulangerie', inspirationType: 'image', image: null })).toEqual({
      image: 'Ajoutez une image ou un logo, ou choisissez une ambiance prédéfinie.',
    });
    expect(validateOnboarding({ description: 'Boulangerie', inspirationType: 'image', image: 'data:image/png;base64,AA' })).toEqual({});
  });
});

describe('firstInvalid et invalidProps', () => {
  it('premier champ en erreur dans l’ordre donné', () => {
    expect(firstInvalid(['email', 'password', 'quota'], { quota: 'x', password: 'y' })).toBe('password');
    expect(firstInvalid(['email', 'password'], {})).toBeNull();
  });

  it('attributs ARIA seulement s’il y a un message', () => {
    expect(invalidProps('e1', 'Requis')).toEqual({ 'aria-invalid': true, 'aria-describedby': 'e1' });
    expect(invalidProps('e1')).toEqual({});
    expect(invalidProps('e1', '')).toEqual({});
  });
});
