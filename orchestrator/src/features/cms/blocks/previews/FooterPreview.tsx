import type { BlockPreviewProps } from '../types';

const NETWORK_LABELS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X' };

export function FooterPreview({ block, theme }: BlockPreviewProps) {
  const socials = Object.entries(block.socials || {}).filter(([, url]) => url);
  return (
    <div style={{ padding: '25px 20px', borderTop: '1px solid rgba(0,0,0,0.1)', textAlign: 'center', fontSize: '0.9rem', opacity: 0.85 }}>
      <div>{block.text}</div>
      {socials.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 12, justifyContent: 'center' }}>
          {socials.map(([network]) => (
            <span key={network} style={{ color: theme.colors.primary, fontWeight: 600 }}>{NETWORK_LABELS[network] ?? network}</span>
          ))}
        </div>
      )}
    </div>
  );
}
