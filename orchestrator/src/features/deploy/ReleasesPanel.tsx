import { useCallback, useEffect, useState } from 'react';
import { fetchReleases, rollbackRelease } from '../../api/deploy';
import type { Release } from '../../api/deploy';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useSites } from '../../state/SitesContext';
import { useToast } from '../../components/ui/ToastContext';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatDateTimeFr } from '../../lib/format';

// Versions précédentes (admin uniquement) : liste des releases conservées + rollback.
// Rafraîchie à la fin d'un build de ce site (une nouvelle release vient d'être créée).
export function ReleasesPanel({ siteSlug, buildingThisSite }: { siteSlug: string; buildingThisSite: boolean }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { refresh } = useSites();
  const [items, setItems] = useState<Release[]>([]);
  const [toRollback, setToRollback] = useState<Release | null>(null);
  const [rolling, setRolling] = useState(false);

  const load = useCallback(() => {
    fetchReleases(siteSlug).then(setItems).catch(() => setItems([]));
  }, [siteSlug]);

  useEffect(() => {
    if (isAdmin && !buildingThisSite) load();
  }, [isAdmin, buildingThisSite, load]);

  if (!isAdmin || items.length === 0) return null;

  const handleRollback = async () => {
    if (!toRollback) return;
    setRolling(true);
    try {
      await rollbackRelease(siteSlug, toRollback.id);
      toast.success(`Site restauré sur la version du ${formatDateTimeFr(toRollback.date)}.`);
      refresh();
      load();
      setToRollback(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Échec du retour arrière.'));
    } finally {
      setRolling(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 8 }}>🕘 Versions précédentes (rollback)</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((r, idx) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '6px 10px' }}>
            <span>
              {formatDateTimeFr(r.date)}
              {idx === 0 && <span className="badge" style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--accent-emerald)' }}>dernière</span>}
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
              onClick={() => setToRollback(r)}
              disabled={rolling || buildingThisSite}
            >
              ↩️ Restaurer
            </button>
          </div>
        ))}
      </div>
      {toRollback && (
        <ConfirmDialog
          title="Restaurer cette version ?"
          message={`Le site en ligne sera remplacé par la version du ${formatDateTimeFr(toRollback.date)}. Le contenu du CMS n'est pas modifié : un prochain déploiement republiera la version courante.`}
          confirmLabel="Restaurer"
          cancelLabel="Annuler"
          danger
          loading={rolling}
          onConfirm={handleRollback}
          onCancel={() => setToRollback(null)}
        />
      )}
    </div>
  );
}
