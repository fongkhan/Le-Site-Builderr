import type { BlockPreviewProps } from '../types';
import { cssUrl } from './previewStyles';

export function HeroPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div
      style={{
        backgroundColor: theme.colors.primary,
        color: '#ffffff',
        backgroundImage: block.backgroundImage ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), ${cssUrl(block.backgroundImage)}` : 'none',
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
      <h1 style={{ color: '#ffffff', fontFamily: `'${theme.fonts.heading}', serif`, fontSize: '2.5rem', marginBottom: 12 }}>{block.title}</h1>
      <p style={{ color: theme.colors.secondary, fontSize: '1.1rem', maxWidth: 600, marginBottom: 20 }}>{block.subtitle}</p>
      {block.ctaText && (
        <button type="button" tabIndex={-1} style={{ backgroundColor: theme.colors.secondary, color: theme.colors.text, border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
          {block.ctaText}
        </button>
      )}
    </div>
  );
}
