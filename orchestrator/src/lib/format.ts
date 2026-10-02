// Formatage partagé (dates, tailles) — affichage en français.

// Date ISO → « 01/10/2026 ». Une date seule (AAAA-MM-JJ) est lue en heure LOCALE :
// sinon elle s'afficherait la veille dans les fuseaux à l'ouest de UTC.
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
}

// Date ISO → « 01/10/2026 14:05 ».
export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// Octets → « 12,3 Ko ».
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  return `${(n / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

// Date du jour (heure locale) au format AAAA-MM-JJ, pour un <input type="date">.
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
