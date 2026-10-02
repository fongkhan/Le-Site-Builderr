import type { BlockPreviewProps } from '../types';
import { cardStyle, headingStyle, SECTION_STYLE } from './previewStyles';

export function TestimonialsPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: theme.colors.background }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        {block.testimonials?.map((testimonial, i) => (
          <div key={i} style={{ ...cardStyle(theme), padding: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(testimonial.rating ?? 0) > 0 && (
              <span style={{ color: theme.colors.primary, letterSpacing: 2 }} aria-label={`Note : ${testimonial.rating}/5`}>
                {'★'.repeat(Math.min(5, testimonial.rating ?? 0))}
              </span>
            )}
            <p style={{ color: '#4b5563', fontSize: '0.9rem', fontStyle: 'italic', flex: 1, margin: 0 }}>« {testimonial.quote} »</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {testimonial.avatar && <img src={testimonial.avatar} alt={testimonial.author} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />}
              <div>
                <h4 style={{ margin: 0, color: theme.colors.text, fontSize: '0.9rem', fontWeight: 600 }}>{testimonial.author}</h4>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{testimonial.role}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
