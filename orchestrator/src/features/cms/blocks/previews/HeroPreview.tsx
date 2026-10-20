import { derivedColors } from '../../../../lib/color';
import type { BlockPreviewProps } from '../types';
import { cssUrl } from './previewStyles';

// Reproduit Hero.astro : sans image, dégradé primaire et texte lisible sur primaire ;
// avec image (assombrie), texte blanc.
export function HeroPreview({ block, theme }: BlockPreviewProps) {
  const { onPrimary, onSecondary, primaryDeep } = derivedColors(theme.colors);
  const textColor = block.backgroundImage ? '#ffffff' : onPrimary;
  return (
    <div
      style={{
        backgroundColor: theme.colors.primary,
        color: textColor,
        backgroundImage: block.backgroundImage
          ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), ${cssUrl(block.backgroundImage)}`
          : `linear-gradient(135deg, ${theme.colors.primary} 0%, ${primaryDeep} 100%)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        padding: '60px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 280,
      }}
    >
      <h1 style={{ color: textColor, fontFamily: `'${theme.fonts.heading}', serif`, fontSize: '2.5rem', marginBottom: 12 }}>{block.title}</h1>
      <p style={{ color: textColor, fontSize: '1.1rem', maxWidth: 600, marginBottom: 20 }}>{block.subtitle}</p>
      {block.ctaText && (
        <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.secondary, color: onSecondary, border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
          {block.ctaText}
        </button>
      )}
    </div>
  );
}
