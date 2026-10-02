import type { Site } from '../../../types';

// Bandeau de synthèse : nombre de sites, état SSL réel, build en cours.
export function StatsBanner({ sites, buildInProgress, buildingSite, queueLength }: {
  sites: Site[];
  buildInProgress: boolean;
  buildingSite?: string | null;
  queueLength: number;
}) {
  const sslActive = sites.filter((s) => s.sslStatus === 'active').length;
  const sslPending = sites.filter((s) => s.sslStatus === 'pending').length;
  const allSecure = sites.length > 0 && sslActive === sites.length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-blue)' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sites enregistrés</span>
        <span style={{ fontSize: '2rem', fontWeight: 800 }}>{sites.length}</span>
      </div>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: `4px solid ${allSecure ? 'var(--accent-emerald)' : 'var(--amber-400)'}` }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Certificats SSL</span>
        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: allSecure ? 'var(--accent-emerald)' : 'var(--amber-400)', margin: 'auto 0' }}>
          🔒 {sslActive}/{sites.length} actif{sslActive > 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {sslPending > 0 ? `${sslPending} en cours d’émission (AutoSSL)` : 'Renouvellement automatique'}
        </span>
      </div>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-rose)' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Build courant</span>
        {buildInProgress ? (
          <>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-blue)', animation: 'pulse 1.5s infinite', margin: 'auto 0' }}>⚙️ Recompilation…</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Site : {buildingSite}{queueLength > 0 ? ` · ${queueLength} en attente` : ''}
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-muted)', margin: 'auto 0' }}>Prêt 🔓</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {queueLength > 0 ? `${queueLength} build(s) en attente` : 'Aucun build actif'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
