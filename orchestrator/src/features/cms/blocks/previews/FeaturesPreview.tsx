import type { BlockPreviewProps } from '../types';
import { cardStyle, headingStyle, SECTION_STYLE } from './previewStyles';

export function FeaturesPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: theme.colors.background }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
        {block.items?.map((item, i) => (
          <div key={i} style={{ ...cardStyle(theme), padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <h3 style={{ color: theme.colors.text, fontSize: '1.1rem', marginBottom: 8 }}>{item.title}</h3>
            <p style={{ color: '#666', fontSize: '0.85rem' }}>{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
