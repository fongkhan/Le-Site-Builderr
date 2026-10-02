import { withAlpha } from '../../../../lib/color';
import type { BlockPreviewProps } from '../types';
import { cardStyle, headingStyle, SECTION_STYLE } from './previewStyles';

export function FaqPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: withAlpha(theme.colors.secondary, 0.07) }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {block.items?.map((item, i) => (
          <div key={i} style={{ ...cardStyle(theme), padding: 16, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
            <h4 style={{ color: theme.colors.text, fontSize: '0.95rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0 }}>
              <span>{item.question}</span>
              <span style={{ color: theme.colors.primary }}>▼</span>
            </h4>
            <p style={{ color: '#4b5563', fontSize: '0.85rem', lineHeight: 1.5, margin: '8px 0 0 0' }}>{item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
