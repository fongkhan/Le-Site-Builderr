import { useEffect, useState } from 'react';
import { fetchBuildHistory } from '../../api/deploy';
import type { BuildHistoryEntry } from '../../api/deploy';
import { formatDateTimeFr } from '../../lib/format';

// Historique des 10 derniers builds du site (admin et propriétaire). Rechargé à la fin
// d'un build de ce site.
export function BuildHistoryPanel({ siteSlug, buildingThisSite }: { siteSlug: string; buildingThisSite: boolean }) {
  const [items, setItems] = useState<BuildHistoryEntry[]>([]);

  useEffect(() => {
    if (buildingThisSite) return;
    let cancelled = false;
    fetchBuildHistory(siteSlug)
      .then((h) => { if (!cancelled) setItems(h); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [siteSlug, buildingThisSite]);

  if (items.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 8 }}>📜 Historique des builds</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((b) => (
          <div key={b.createdAt} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.8rem', padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)' }}>
            <span style={{ color: b.status === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 700 }}>
              {b.status === 'success' ? '✅ Succès' : '❌ Échec'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{formatDateTimeFr(b.createdAt)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{b.durationMs != null ? `${Math.round(b.durationMs / 1000)} s` : '—'}</span>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{b.triggeredBy || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
