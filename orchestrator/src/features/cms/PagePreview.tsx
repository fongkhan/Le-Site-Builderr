import type { PageDoc, Theme } from '../../types';

// Aperçu WYSIWYG de la page telle qu'elle sera rendue par le template Astro
export function PagePreview({ page, theme }: { page: PageDoc; theme: Theme }) {
  return (
    <div
      style={{
        backgroundColor: theme.colors.background,
        color: theme.colors.text,
        borderRadius: 12,
        fontFamily: `'${theme.fonts.body}', sans-serif`,
        border: '1px solid rgba(0,0,0,0.15)',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        minHeight: 500,
      }}
    >
      {page.layout.map((block, index) => {
        const headingStyle = { textAlign: 'center' as const, marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text };

        if (block.blockType === 'hero') {
          return (
            <div
              key={index}
              style={{
                backgroundColor: theme.colors.primary,
                color: '#ffffff',
                backgroundImage: block.backgroundImage ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${block.backgroundImage})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                padding: '60px 20px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '280px',
              }}
            >
              <h1 style={{ color: '#ffffff', fontFamily: `'${theme.fonts.heading}', serif`, fontSize: '2.5rem', marginBottom: 12 }}>{block.title}</h1>
              <p style={{ color: theme.colors.secondary, fontSize: '1.1rem', maxWidth: 600, marginBottom: 20 }}>{block.subtitle}</p>
              {block.ctaText && (
                <button style={{ backgroundColor: theme.colors.secondary, color: theme.colors.text, border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
                  {block.ctaText}
                </button>
              )}
            </div>
          );
        }

        if (block.blockType === 'features') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                {block.items?.map((item, i) => (
                  <div key={i} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', padding: 20, borderRadius: theme.radius, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                    <h3 style={{ color: theme.colors.text, fontSize: '1.1rem', marginBottom: 8 }}>{item.title}</h3>
                    <p style={{ color: '#666', fontSize: '0.85rem' }}>{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (block.blockType === 'product-grid') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.secondary + '22' }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                {block.products?.map((prod, i) => (
                  <div key={i} style={{ background: '#ffffff', borderRadius: theme.radius, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
                    <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                    <div style={{ padding: 15 }}>
                      <h4 style={{ color: theme.colors.text, marginBottom: 4 }}>{prod.name}</h4>
                      <span style={{ color: theme.colors.primary, fontWeight: 700 }}>{prod.price}</span>
                      <button style={{ width: '100%', border: 'none', background: theme.colors.primary, color: 'white', borderRadius: theme.radius, padding: '6px', marginTop: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                        Acheter
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (block.blockType === 'gallery') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {block.images?.map((img, i) => (
                  <div key={i} style={{ height: 100, overflow: 'hidden', borderRadius: theme.radius }}>
                    <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (block.blockType === 'testimonials') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
                {block.testimonials?.map((testi, i) => (
                  <div key={i} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', padding: 20, borderRadius: theme.radius, boxShadow: '0 4px 12px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ color: '#4b5563', fontSize: '0.9rem', fontStyle: 'italic', flex: 1, margin: 0 }}>"{testi.quote}"</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {testi.avatar && <img src={testi.avatar} alt={testi.author} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />}
                      <div>
                        <h4 style={{ margin: 0, color: theme.colors.text, fontSize: '0.9rem', fontWeight: 600 }}>{testi.author}</h4>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{testi.role}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (block.blockType === 'faq') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.secondary + '11' }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {block.items?.map((item, i) => (
                  <div key={i} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', padding: 16, borderRadius: theme.radius, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
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

        if (block.blockType === 'pricing') {
          return (
            <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
              <h2 style={headingStyle}>{block.title}</h2>
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
                      {plan.features?.map((f, fi) => (
                        <li key={fi} style={{ fontSize: '0.825rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: theme.colors.primary, fontWeight: 'bold' }}>✓</span>
                          <span>{f.feature}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      style={{
                        width: '100%',
                        border: 'none',
                        backgroundColor: plan.isPopular ? theme.colors.primary : theme.colors.secondary,
                        color: plan.isPopular ? '#ffffff' : theme.colors.text,
                        borderRadius: theme.radius,
                        padding: '10px 14px',
                        fontWeight: 600,
                        cursor: 'pointer',
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

        if (block.blockType === 'contact') {
          return (
            <div key={index} style={{ padding: '50px 20px' }}>
              <h2 style={headingStyle}>{block.title}</h2>
              {block.subtitle && <p style={{ textAlign: 'center', marginBottom: 20, opacity: 0.85 }}>{block.subtitle}</p>}
              <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input disabled placeholder="Votre nom" style={{ padding: 10, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.15)' }} />
                <input disabled placeholder="Votre email" style={{ padding: 10, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.15)' }} />
                <textarea disabled placeholder="Votre message…" rows={3} style={{ padding: 10, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.15)' }} />
                <button disabled style={{ backgroundColor: theme.colors.primary, color: '#fff', border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
                  {block.ctaText || 'Envoyer'}
                </button>
              </div>
            </div>
          );
        }

        if (block.blockType === 'info') {
          return (
            <div key={index} style={{ padding: '50px 20px' }}>
              <h2 style={headingStyle}>{block.title}</h2>
              <div style={{ maxWidth: 480, margin: '0 auto', backgroundColor: theme.colors.secondary + '33', borderRadius: theme.radius, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {block.address && <div>📍 {block.address}</div>}
                {block.phone && <div>📞 {block.phone}</div>}
                {block.email && <div>✉️ {block.email}</div>}
                {block.hours && <div style={{ whiteSpace: 'pre-line' }}>🕒 {block.hours}</div>}
              </div>
            </div>
          );
        }

        if (block.blockType === 'footer') {
          const socials = Object.entries(block.socials || {}).filter(([, url]) => url);
          return (
            <div key={index} style={{ padding: '25px 20px', borderTop: '1px solid rgba(0,0,0,0.1)', textAlign: 'center', fontSize: '0.9rem', opacity: 0.85 }}>
              <div>{block.text}</div>
              {socials.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {socials.map(([network]) => (
                    <span key={network} style={{ textTransform: 'capitalize', color: theme.colors.primary, fontWeight: 600 }}>{network}</span>
                  ))}
                </div>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
