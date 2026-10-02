import type { BlockPreviewProps } from '../types';
import { headingStyle, SECTION_STYLE } from './previewStyles';

export function PricingPreview({ block, theme }: BlockPreviewProps) {
  return (
    <div style={{ ...SECTION_STYLE, backgroundColor: theme.colors.background }}>
      <h2 style={headingStyle(theme)}>{block.title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, maxWidth: 800, margin: '0 auto', alignItems: 'stretch' }}>
        {block.plans?.map((plan, i) => (
          <div
            key={i}
            style={{
              background: '#ffffff',
              border: plan.isPopular ? `2px solid ${theme.colors.primary}` : '1px solid rgba(0,0,0,0.05)',
              padding: 24,
              borderRadius: theme.radius,
              boxShadow: plan.isPopular ? '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              transform: plan.isPopular ? 'scale(1.03)' : 'none',
              zIndex: plan.isPopular ? 2 : 1,
            }}
          >
            {plan.isPopular && (
              <span style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', backgroundColor: theme.colors.primary, color: '#ffffff', padding: '2px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
                Populaire
              </span>
            )}
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: theme.colors.text }}>{plan.name}</h3>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', minHeight: 32, margin: '4px 0 0 0' }}>{plan.description}</p>
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 15, marginBottom: 15 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: theme.colors.text }}>{plan.price}</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px 0', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {plan.features?.filter((f) => f.feature?.trim()).map((f, fi) => (
                <li key={fi} style={{ fontSize: '0.825rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: theme.colors.primary, fontWeight: 'bold' }}>✓</span>
                  <span>{f.feature}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              tabIndex={-1}
              style={{
                width: '100%',
                border: 'none',
                backgroundColor: plan.isPopular ? theme.colors.primary : theme.colors.secondary,
                color: plan.isPopular ? '#ffffff' : theme.colors.text,
                borderRadius: theme.radius,
                padding: '10px 14px',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              {plan.ctaText}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
