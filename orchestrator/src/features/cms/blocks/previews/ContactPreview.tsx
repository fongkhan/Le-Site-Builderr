import type { BlockPreviewProps } from '../types';
import { formFieldStyle, headingStyle } from './previewStyles';

export function ContactPreview({ block, theme }: BlockPreviewProps) {
  const field = formFieldStyle(theme);
  return (
    <div style={{ padding: '50px 20px' }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      {block.subtitle && <p style={{ textAlign: 'center', marginBottom: 20, opacity: 0.85 }}>{block.subtitle}</p>}
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input disabled placeholder="Votre nom" aria-label="Votre nom" style={field} />
        <input disabled placeholder="Votre email" aria-label="Votre email" style={field} />
        <textarea disabled placeholder="Votre message…" aria-label="Votre message" rows={3} style={field} />
        <button type="button" disabled style={{ backgroundColor: theme.colors.primary, color: '#fff', border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
          {block.ctaText || 'Envoyer'}
        </button>
      </div>
    </div>
  );
}
