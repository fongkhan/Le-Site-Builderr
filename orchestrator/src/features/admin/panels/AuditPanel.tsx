import { useEffect, useState } from 'react';
import { fetchAuditLog } from '../../../api/admin';
import type { AuditEntry } from '../../../api/admin';
import { formatDateTimeFr } from '../../../lib/format';

// Journal d'audit : 50 dernières actions sensibles (lecture seule). Rechargé à
// l'ouverture et après chaque action d'administration (`version`).
export function AuditPanel({ version }: { version: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchAuditLog()
      .then((e) => { if (!cancelled) setEntries(e); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [open, version]);

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, padding: 0 }}
        aria-expanded={open}
      >
        <span>🧾 Journal d'audit</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{open ? '▲ replier' : '▼ afficher'}</span>
      </button>
      {open && (
        entries.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aucune action enregistrée pour le moment.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-cpanel" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Par</th>
                  <th>Cible</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.createdAt}-${e.action}-${e.target}`}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDateTimeFr(e.createdAt)}</td>
                    <td><span className="badge">{e.action}</span></td>
                    <td>{e.actor || '—'}</td>
                    <td><code>{e.target || '—'}</code></td>
                    <td style={{ color: 'var(--text-muted)' }}>{e.details || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
