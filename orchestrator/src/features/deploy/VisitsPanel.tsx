import { useEffect, useState } from 'react';
import { fetchSiteStats } from '../../api/deploy';
import type { SiteStats } from '../../api/deploy';

const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

// Statistiques de visites du site (admin et propriétaire) : total 30 j + mini-graphique
// en barres (SVG inline, sans dépendance). Anonyme : aucune donnée personnelle.
export function VisitsPanel({ siteSlug }: { siteSlug: string }) {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    fetchSiteStats(siteSlug, 30)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, [siteSlug]);

  if (!stats || stats.days.length === 0) return null;

  const days = stats.days;
  const max = Math.max(1, ...days.map((d) => d.count));
  const W = 100; // viewBox en % (largeur adaptative)
  const H = 40;
  const gap = 0.6;
  const barW = W / days.length - gap;

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>📈 Visites (30 derniers jours)</h4>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>
          {stats.total.toLocaleString('fr-FR')} au total
        </span>
      </div>
      {stats.total === 0 ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Aucune visite enregistrée pour l'instant. Le compteur démarre dès que votre site est en ligne et consulté.
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, display: 'block' }} role="img" aria-label={`Visites sur ${days.length} jours, ${stats.total} au total`}>
            {days.map((d, i) => {
              const h = (d.count / max) * H;
              return (
                <rect
                  key={d.date}
                  x={i * (barW + gap)}
                  y={H - h}
                  width={barW}
                  height={h}
                  rx={0.4}
                  fill="var(--accent-emerald)"
                  opacity={d.count > 0 ? 0.85 : 0.15}
                >
                  <title>{`${dayLabel(d.date)} : ${d.count} visite${d.count > 1 ? 's' : ''}`}</title>
                </rect>
              );
            })}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
            <span>{dayLabel(days[0].date)}</span>
            <span>{dayLabel(days[days.length - 1].date)}</span>
          </div>
        </>
      )}
    </div>
  );
}
