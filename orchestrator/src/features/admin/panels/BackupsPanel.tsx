import { useCallback, useEffect, useState } from 'react';
import { backupDownloadUrl, createBackup, fetchBackups } from '../../../api/admin';
import type { BackupEntry, BackupsInfo } from '../../../api/admin';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';
import { formatBytes, formatDateTimeFr } from '../../../lib/format';
import { RestoreBackupModal } from './RestoreBackupModal';

// Liste des sauvegardes (composant pur, testé par rendu statique) : restauration et
// téléchargement de chacune.
export function BackupsList({ backups, onRestore }: { backups: BackupEntry[]; onRestore: (backup: BackupEntry) => void }) {
  if (backups.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Aucune sauvegarde pour l'instant.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
      {backups.map((b) => (
        <div key={b.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: '0.82rem', padding: '5px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>{formatDateTimeFr(b.createdAt)} · {formatBytes(b.size)}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '2px 10px', fontSize: '0.75rem' }}
              aria-label={`Restaurer la sauvegarde du ${formatDateTimeFr(b.createdAt)}`}
              onClick={() => onRestore(b)}
            >
              Restaurer…
            </button>
            <a className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem', textDecoration: 'none' }} href={backupDownloadUrl(b.name)}>Télécharger</a>
          </span>
        </div>
      ))}
    </div>
  );
}

// Sauvegardes automatiques : configuration, déclenchement manuel, restauration,
// téléchargement. onRestored : un site a été créé ou modifié par une restauration.
export function BackupsPanel({ onRestored }: { onRestored?: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<BackupsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);

  const load = useCallback(() => {
    fetchBackups().then(setInfo).catch(() => setInfo(null));
  }, []);
  useEffect(load, [load]);

  const handleBackup = async () => {
    setBusy(true);
    try {
      const res = await createBackup();
      toast.success(`Sauvegarde créée : ${res.filename}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Échec de la sauvegarde.'));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        <h3 style={{ margin: 0 }}>💾 Sauvegardes du contenu</h3>
        <button className="btn btn-secondary" onClick={handleBackup} disabled={busy}>{busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}</button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
        Sauvegardes automatiques :{' '}
        {info.config.enabled
          ? <span style={{ color: 'var(--accent-emerald)' }}>activées — toutes les {info.config.intervalHours} h, {info.config.keep} conservées</span>
          : <span style={{ color: 'var(--amber-400)' }}>désactivées (définir <code>BACKUP_ENABLED=true</code> pour planifier)</span>}
        . Contenu sauvegardé : fiches, pages, thèmes, articles{info.config.media ? ' et images' : ''} de tous les sites. « Restaurer… » recrée un site en copie ou remplace son contenu.
      </p>
      <BackupsList backups={info.backups} onRestore={setRestoring} />
      {restoring && (
        <RestoreBackupModal
          backup={restoring}
          onClose={() => setRestoring(null)}
          onRestored={() => {
            load();
            onRestored?.();
          }}
        />
      )}
    </div>
  );
}
