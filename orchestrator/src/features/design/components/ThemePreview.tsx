import { derivedColors, withAlpha } from '../../../lib/color';
import { initials } from '../../../lib/monogram';
import type { Theme } from '../../../types';
import { isValidLogo } from '../themeOptions';

// Aperçu des tokens du thème : en-tête de marque, icône d'onglet, titres, texte et
// boutons (texte des boutons calculé comme sur le site publié : clair ou foncé).
export function ThemePreview({ theme, siteName }: { theme: Theme; siteName: string }) {
  const { onPrimary, onSecondary } = derivedColors(theme.colors);
  // Logo affiché seulement s'il désigne une image de la médiathèque (jamais une URL saisie)
  const logo = (theme.logo ?? '').trim();
  const logoSrc = logo && isValidLogo(logo) ? logo : '';
  const headingFont = `'${theme.fonts.heading}', serif`;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>🎨 Aperçu en direct des tokens</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <span>Icône d'onglet</span>
        {logoSrc ? (
          <img src={logoSrc} alt="" width={32} height={32} style={{ objectFit: 'contain', borderRadius: 6, background: '#ffffff' }} />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: 7,
              backgroundColor: theme.colors.primary,
              color: onPrimary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.8rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {initials(siteName)}
          </span>
        )}
      </div>
      <div
        style={{
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          borderRadius: theme.radius,
          fontFamily: `'${theme.fonts.body}', sans-serif`,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid rgba(0,0,0,0.1)',
          minHeight: 350,
          overflow: 'hidden',
        }}
      >
        {/* En-tête du site publié : logo ou nom du site */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${withAlpha(theme.colors.text, 0.12)}`, display: 'flex', alignItems: 'center', minHeight: 56 }}>
          {logoSrc ? (
            <img src={logoSrc} alt={siteName} height={32} style={{ height: 32, width: 'auto', maxWidth: 160, objectFit: 'contain' }} />
          ) : (
            <span style={{ fontFamily: headingFont, fontWeight: 700, fontSize: '1.05rem' }}>{siteName}</span>
          )}
        </div>
        <div style={{ padding: 30, display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
          <h2 style={{ fontFamily: headingFont, color: theme.colors.text, border: 'none', padding: 0 }}>
            Aperçu de titre de page
          </h2>
          <p>
            Ce paragraphe utilise la police <strong>{theme.fonts.body}</strong>. Les composants du site généré respectent ces tokens.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 'auto', flexWrap: 'wrap' }}>
            <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.primary, color: onPrimary, border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
              Bouton primaire
            </button>
            <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.secondary, color: onSecondary, border: `1px solid ${withAlpha(theme.colors.primary, 0.2)}`, borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
              Bouton secondaire
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
