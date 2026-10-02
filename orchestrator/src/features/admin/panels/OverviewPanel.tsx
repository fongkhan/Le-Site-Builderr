import { useEffect, useState } from 'react';
import { fetchAdminOverview } from '../../../api/admin';
import type { AdminOverview } from '../../../api/admin';
import { SITE_STATUS_DISPLAY } from '../constants';

// Mini-courbe SVG (sparkline) des visites, sans dépendance.
function Sparkline({ series }: { series: number[] }) {
  const w = 90, h = 22;
  const max = Math.max(1, ...series);
  const n = series.length;
  if (n === 0) return <svg width={w} height={h} />;
  const pts = series.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--accent-emerald)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Vue d'ensemble multi-sites : totaux + tableau (statut, domaine/SSL, visites 30 j +
// sparkline). Rechargée quand `version` change (création, suppression, duplication…).
export function OverviewPanel({ version }: { version: number }) {
  const [data, setData] = useState<AdminOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminOverview()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [version]);

  if (!data) return null;

  const tile = (label: string, value: number | string, color: string) => (
    <div className="glass-panel" style={{ padding: '14px 18px', borderLeft: `4px solid ${color}`, minWidth: 130 }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>📊 Vue d'ensemble</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {tile('Sites', data.totals.sites, 'var(--accent-blue)')}
        {tile('En ligne', data.totals.active, 'var(--accent-emerald)')}
        {tile('Visites (30 j)', data.totals.visits30.toLocaleString('fr-FR'), 'var(--accent-emerald)')}
        {tile('Domaines perso', data.totals.customDomains, 'var(--purple-300)')}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table-cpanel" style={{ width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr><th>Site</th><th>Statut</th><th>Domaine</th><th>SSL</th><th style={{ textAlign: 'right' }}>Visites 30 j</th><th>Tendance</th></tr>
          </thead>
          <tbody>
            {data.sites.map((s) => {
              const status = SITE_STATUS_DISPLAY[s.status] ?? SITE_STATUS_DISPLAY.draft;
              return (
                <tr key={s.slug}>
                  <td style={{ fontWeight: 600 }}>{s.name}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{s.slug}</div></td>
                  <td><span style={{ color: status.color }}>{status.label}</span></td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.domain}
                    {s.domainStatus === 'active' && <span className="badge" style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--accent-emerald)' }}>perso</span>}
                  </td>
                  <td title={s.sslStatus}>{s.sslStatus === 'active' ? '🔒' : s.sslStatus === 'pending' ? '⏳' : '⚠'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.visits30.toLocaleString('fr-FR')}</td>
                  <td><Sparkline series={s.series} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
