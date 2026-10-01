import { useEffect, useState } from 'react';
import { fetchHostingStatus, testHostingConnection } from '../../../api/admin';
import type { HostingStatus } from '../../../api/admin';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';

// État de l'hébergement : driver actif (simulation locale vs cPanel o2switch) + test de connexion
export function HostingPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<HostingStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchHostingStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const isCpanel = status.driver === 'cpanel';

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testHostingConnection();
      if (r.ok) toast.success(r.message || 'Connexion à l’hébergement OK.');
      else toast.error(r.error || 'Échec du test de connexion.');
    } catch (err) {
      toast.error(errorMessage(err, 'Échec du test de connexion.'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap', borderLeft: `4px solid ${isCpanel ? 'var(--accent-emerald)' : 'var(--amber-400)'}` }}>
      <span style={{ fontSize: '1.5rem' }}>{isCpanel ? '🌍' : '🧪'}</span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>Hébergement</strong>
          <span className="badge" style={{ fontWeight: 700, color: isCpanel ? 'var(--accent-emerald)' : 'var(--amber-400)' }}>
            {isCpanel ? 'cPanel o2switch' : 'Simulation locale'}
          </span>
          {isCpanel && status.rootDomain && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {status.host} — sous-domaines de <code>{status.rootDomain}</code>
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{status.description}</p>
      </div>
      <button className="btn btn-secondary" onClick={handleTest} disabled={testing} style={{ whiteSpace: 'nowrap' }}>
        {testing ? 'Test en cours…' : '🔌 Tester la connexion'}
      </button>
    </div>
  );
}
