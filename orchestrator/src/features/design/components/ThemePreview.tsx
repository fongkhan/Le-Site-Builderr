import { withAlpha } from '../../../lib/color';
import type { Theme } from '../../../types';

// Aperçu des tokens du thème (titres, texte, boutons).
export function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>🎨 Aperçu en direct des tokens</h3>
      <div
        style={{
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          borderRadius: theme.radius,
          fontFamily: `'${theme.fonts.body}', sans-serif`,
          padding: 30,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          border: '1px solid rgba(0,0,0,0.1)',
          minHeight: 350,
        }}
      >
        <h2 style={{ fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text, border: 'none', padding: 0 }}>
          Aperçu de titre de page
        </h2>
        <p>
          Ce paragraphe utilise la police <strong>{theme.fonts.body}</strong>. Les composants du site généré respectent ces tokens.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', flexWrap: 'wrap' }}>
          <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.primary, color: '#ffffff', border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
            Bouton primaire
          </button>
          <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.secondary, color: theme.colors.text, border: `1px solid ${withAlpha(theme.colors.primary, 0.2)}`, borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
            Bouton secondaire
          </button>
        </div>
      </div>
    </div>
  );
}
