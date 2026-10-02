import { withAlpha } from '../../../../lib/color';
import type { BlockPreviewProps } from '../types';
import { headingStyle, SECTION_STYLE } from './previewStyles';

export function ProductGridPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: withAlpha(theme.colors.secondary, 0.13) }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
        {block.products?.map((product, i) => (
          <div key={i} style={{ background: '#ffffff', borderRadius: theme.radius, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
            {product.image ? (
              <img src={product.image} alt={product.name} style={{ width: '100%', height: 140, objectFit: 'cover' }} />
            ) : (
              <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontSize: '2rem' }} aria-hidden>🖼️</div>
            )}
            <div style={{ padding: 15 }}>
              <h4 style={{ color: theme.colors.text, marginBottom: 4 }}>{product.name}</h4>
              <span style={{ color: theme.colors.primary, fontWeight: 700 }}>{product.price}</span>
              <button type="button" tabIndex={-1} style={{ width: '100%', border: 'none', background: theme.colors.primary, color: 'white', borderRadius: theme.radius, padding: 6, marginTop: 10, fontSize: '0.85rem' }}>
                Acheter
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
