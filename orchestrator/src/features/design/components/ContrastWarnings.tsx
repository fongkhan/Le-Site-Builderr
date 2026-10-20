import type { Theme } from '../../../types';
import { contrastWarnings } from '../themeOptions';

// Avertissements de lisibilité du thème (WCAG AA), recalculés à chaque modification.
// Pas de zone « live » : la liste change à chaque frappe dans un champ de couleur.
export function ContrastWarnings({ theme }: { theme: Theme }) {
  const warnings = contrastWarnings(theme);
  if (warnings.length === 0) return null;
  return (
    <div
      style={{
        border: '1px solid rgba(245, 158, 11, 0.45)',
        background: 'rgba(245, 158, 11, 0.1)',
        color: '#fcd34d',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: '0.85rem',
      }}
    >
      <p style={{ fontWeight: 600, margin: 0 }}>⚠️ Lisibilité insuffisante (WCAG AA)</p>
      <ul style={{ margin: '6px 0 6px 18px', padding: 0 }}>
        {warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>
        Le thème reste enregistrable. Le texte des boutons s'adapte automatiquement (clair ou foncé) aux couleurs primaire et secondaire.
      </p>
    </div>
  );
}
