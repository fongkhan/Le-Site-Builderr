// Libellés et options partagés par les écrans d'administration.

export const SITE_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  active: { label: 'Actif (déployé)', color: 'var(--accent-emerald)' },
  error: { label: 'Erreur build', color: 'var(--accent-rose)' },
  draft: { label: 'Brouillon', color: 'var(--amber-400)' },
};

export const SSL_DISPLAY: Record<string, { label: string; color: string }> = {
  active: { label: '🔒 Actif', color: 'var(--accent-emerald)' },
  pending: { label: '⏳ En cours d’émission', color: 'var(--amber-400)' },
};
export const SSL_UNKNOWN = { label: '⚠ Non sécurisé', color: 'var(--accent-rose)' };

export const DOMAIN_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  none: { label: 'Sous-domaine par défaut', color: 'var(--text-muted)' },
  pending: { label: 'En attente de vérification', color: 'var(--amber-400)' },
  active: { label: '🔒 Domaine actif', color: 'var(--accent-emerald)' },
  error: { label: '⚠ Erreur de rattachement', color: 'var(--accent-rose)' },
};

// Stacks proposées (valeurs identiques à celles produites par le serveur : création,
// onboarding, scan et import).
export const STACK_OPTIONS: { value: string; label: string }[] = [
  { value: 'Astro SSG', label: 'Astro SSG (recommandé)' },
  { value: 'Astro SSG + Payload CMS', label: 'Astro SSG + Payload CMS' },
  { value: 'Astro Hybride + Payload + Medusa', label: 'Astro Hybride + CMS' },
  { value: 'Static HTML', label: 'HTML/CSS statique' },
  { value: 'Static Build / HTML', label: 'Build statique (HTML)' },
  { value: 'Astro Site (Source + Build)', label: 'Astro (sources + build)' },
  { value: 'Node.js / CMS Repository', label: 'Dépôt Node.js / CMS' },
  { value: 'Plain HTML (Importé)', label: 'HTML importé' },
];
