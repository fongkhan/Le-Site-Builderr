// Validation des formulaires de l'orchestrateur (fonctions pures). Les erreurs de saisie
// s'affichent sous le champ concerné (FieldError) et le focus va au premier champ
// invalide ; les erreurs du serveur restent signalées par un toast.

/** Message d'erreur par champ (absent : champ valide) */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export const SITE_NAME_REQUIRED = 'Le nom du site est requis.';
export const EMAIL_INVALID = 'Un email valide est requis.';
export const PASSWORD_TOO_SHORT = 'Le mot de passe doit contenir au moins 12 caractères.';
export const QUOTA_INVALID = 'Le quota IA doit être un entier positif ou nul.';
export const DESCRIPTION_REQUIRED = "Décrivez votre activité : c'est la base de la génération.";
export const IMAGE_REQUIRED = 'Ajoutez une image ou un logo, ou choisissez une ambiance prédéfinie.';

const MIN_PASSWORD_LENGTH = 12;

export function validateSiteName(name: string): string | undefined {
  return name.trim() ? undefined : SITE_NAME_REQUIRED;
}

export interface ClientAccountInput {
  email: string;
  password: string;
  quotaEnabled: boolean;
  quota: string;
}

export function validateClientAccount({ email, password, quotaEnabled, quota }: ClientAccountInput): FieldErrors<'email' | 'password' | 'quota'> {
  const errors: FieldErrors<'email' | 'password' | 'quota'> = {};
  if (!email.trim() || !/.+@.+\..+/.test(email)) errors.email = EMAIL_INVALID;
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = PASSWORD_TOO_SHORT;
  if (quotaEnabled) {
    const n = Number(quota.trim());
    if (quota.trim() === '' || !Number.isInteger(n) || n < 0) errors.quota = QUOTA_INVALID;
  }
  return errors;
}

export interface OnboardingInput {
  description: string;
  inspirationType: 'preset' | 'image';
  image: string | null;
}

export function validateOnboarding({ description, inspirationType, image }: OnboardingInput): FieldErrors<'description' | 'image'> {
  const errors: FieldErrors<'description' | 'image'> = {};
  if (!description.trim()) errors.description = DESCRIPTION_REQUIRED;
  if (inspirationType === 'image' && !image) errors.image = IMAGE_REQUIRED;
  return errors;
}

/** Premier champ en erreur dans l'ordre d'affichage (cible du focus), ou null */
export function firstInvalid<K extends string>(order: readonly K[], errors: FieldErrors<K>): K | null {
  return order.find((key) => Boolean(errors[key])) ?? null;
}

/** Attributs ARIA d'un champ : invalide et décrit par son message d'erreur, s'il y en a un */
export function invalidProps(errorId: string, message?: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return message ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
}

/**
 * Focus sur un champ (par son id) juste après le rendu en cours : son message d'erreur,
 * relié par aria-describedby, est alors annoncé avec lui.
 */
export function focusField(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}
