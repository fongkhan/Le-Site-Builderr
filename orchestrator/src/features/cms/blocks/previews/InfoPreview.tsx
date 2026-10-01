import { withAlpha } from '../../../../lib/color';
import type { BlockPreviewProps } from '../types';
import { headingStyle } from './previewStyles';

export function InfoPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ padding: '50px 20px' }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ maxWidth: 480, margin: '0 auto', backgroundColor: withAlpha(theme.colors.secondary, 0.2), borderRadius: theme.radius, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {block.address && <div>📍 {block.address}</div>}
        {block.phone && <div>📞 {block.phone}</div>}
        {block.email && <div>✉️ {block.email}</div>}
        {block.hours && <div style={{ whiteSpace: 'pre-line' }}>🕒 {block.hours}</div>}
        {block.googleBusinessUrl && <div style={{ color: theme.colors.primary, fontWeight: 600 }}>⭐ Voir la fiche Google</div>}
      </div>
    </div>
  );
}
