import type { BlockPreviewProps } from '../types';
import { headingStyle, SECTION_STYLE } from './previewStyles';

export function GalleryPreview({ block, theme }: BlockPreviewProps) {
  const images = (block.images ?? []).filter(Boolean);
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: theme.colors.background }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {images.map((src, i) => (
          <div key={i} style={{ height: 100, overflow: 'hidden', borderRadius: theme.radius }}>
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
