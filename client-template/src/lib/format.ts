// Formatage partagé des pages générées (dates des articles…).

/** Date ISO → « 12 mars 2026 » (français), ou '' si absente ou invalide. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Date ISO normalisée pour l'attribut datetime de <time>, ou undefined si invalide. */
export function isoDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
