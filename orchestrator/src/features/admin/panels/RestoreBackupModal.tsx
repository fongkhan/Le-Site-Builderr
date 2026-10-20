import { useEffect, useState, type CSSProperties } from 'react';
import { fetchBackupSites, restoreBackup } from '../../../api/admin';
import type { BackupContents, BackupEntry, RestoreMode } from '../../../api/admin';
import { errorMessage } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/ToastContext';
import { formatDateTimeFr } from '../../../lib/format';
import { missingImagesMessage, restoreSuccessMessage, skippedContentMessage } from './restoreMessages';

const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '10px 12px',
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const legendStyle: CSSProperties = { padding: '0 6px', fontSize: '0.85rem', color: 'var(--text-muted)' };
const optionStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.9rem' };
const helpStyle: CSSProperties = { display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 };

// Choix du site et du mode de restauration (composant pur, testé par rendu statique).
export function RestoreChoices({ contents, selectedSlug, mode, disabled = false, onSelect, onModeChange }: {
  contents: BackupContents;
  selectedSlug: string | null;
  mode: RestoreMode;
  disabled?: boolean;
  onSelect: (slug: string) => void;
  onModeChange: (mode: RestoreMode) => void;
}) {
  const selected = contents.sites.find((s) => s.slug === selectedSlug) ?? null;
  const exists = Boolean(selected?.exists);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {contents.format < 2 && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--amber-400)' }}>
          Sauvegarde sans images : en copie, les images citées sont reprises de la médiathèque du site d'origine s'il existe encore.
        </p>
      )}
      <fieldset disabled={disabled} style={fieldsetStyle}>
        <legend style={legendStyle}>Site à restaurer</legend>
        {contents.sites.map((s) => (
          <label key={s.slug} style={optionStyle}>
            <input type="radio" name="restore-site" value={s.slug} checked={s.slug === selectedSlug} onChange={() => onSelect(s.slug)} />
            <span>
              <strong>{s.name}</strong> <code>{s.slug}</code>
              <span style={helpStyle}>
                {s.pages} page(s) · {s.posts} article(s) · {s.media} image(s){s.exists ? '' : ' · supprimé depuis'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {selected && (
        <fieldset disabled={disabled} style={fieldsetStyle}>
          <legend style={legendStyle}>Mode de restauration</legend>
          <label style={optionStyle}>
            <input type="radio" name="restore-mode" value="copy" checked={mode === 'copy'} onChange={() => onModeChange('copy')} />
            <span>
              <strong>Créer une copie (recommandé)</strong>
              <span style={helpStyle}>
                {exists
                  ? `Nouveau site en brouillon « ${selected.name} (restauration) » ; le site actuel n'est pas modifié.`
                  : `Le site est recréé en brouillon sous son adresse d'origine (${selected.slug}).`}
              </span>
            </span>
          </label>
          <label style={{ ...optionStyle, cursor: exists ? 'pointer' : 'not-allowed', opacity: exists ? 1 : 0.6 }}>
            <input type="radio" name="restore-mode" value="replace" checked={mode === 'replace'} disabled={!exists} onChange={() => onModeChange('replace')} />
            <span>
              <strong>Remplacer le contenu du site actuel</strong>
              <span style={helpStyle}>
                Pages, articles et thème actuels sont remplacés ; les images manquantes sont restaurées. Une sauvegarde de sécurité est créée juste avant. Le site en ligne ne change qu'à la prochaine publication.
              </span>
              {!exists && <span style={{ ...helpStyle, color: 'var(--amber-400)' }}>Indisponible : ce site n'existe plus.</span>}
            </span>
          </label>
        </fieldset>
      )}
    </div>
  );
}

// Restauration d'une sauvegarde : lecture de son contenu, choix du site et du mode, puis
// copie (sans risque) ou remplacement (confirmé, après une sauvegarde de sécurité).
export function RestoreBackupModal({ backup, onClose, onRestored }: { backup: BackupEntry; onClose: () => void; onRestored: () => void }) {
  const toast = useToast();
  const [contents, setContents] = useState<BackupContents | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [mode, setMode] = useState<RestoreMode>('copy');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const date = formatDateTimeFr(backup.createdAt);

  useEffect(() => {
    let cancelled = false;
    setContents(null);
    setLoadError(null);
    fetchBackupSites(backup.name)
      .then((c) => {
        if (cancelled) return;
        setContents(c);
        setSelectedSlug(c.sites[0]?.slug ?? null);
        setMode('copy');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, 'Impossible de lire la sauvegarde.'));
      });
    return () => {
      cancelled = true;
    };
  }, [backup.name]);

  const selected = contents?.sites.find((s) => s.slug === selectedSlug) ?? null;

  // Un site qui n'existe plus ne peut être restauré qu'en copie
  const handleSelect = (slug: string) => {
    setSelectedSlug(slug);
    if (!contents?.sites.find((s) => s.slug === slug)?.exists) setMode('copy');
  };

  const runRestore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await restoreBackup(backup.name, selected.slug, mode);
      toast.success(restoreSuccessMessage(r));
      const missing = missingImagesMessage(r.media.missing);
      if (missing) toast.info(missing);
      const skipped = skippedContentMessage(r.skipped);
      if (skipped) toast.info(skipped);
      onRestored();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Échec de la restauration.'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const canRestore = Boolean(selected) && !busy && (mode === 'copy' || Boolean(selected?.exists));

  return (
    <>
      <Modal
        title="Restaurer une sauvegarde"
        subtitle={`Sauvegarde du ${date}`}
        onClose={onClose}
        dismissible={!busy}
        footer={
          <>
            <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
            {mode === 'replace' ? (
              <button className="btn btn-danger" onClick={() => setConfirming(true)} disabled={!canRestore}>
                Remplacer le contenu…
              </button>
            ) : (
              <button className="btn btn-primary" onClick={runRestore} disabled={!canRestore}>
                {busy ? 'Restauration…' : 'Créer la copie'}
              </button>
            )}
          </>
        }
      >
        {loadError ? (
          <p style={{ margin: 0, color: 'var(--accent-rose)' }}>{loadError}</p>
        ) : !contents ? (
          <Spinner label="Lecture de la sauvegarde…" />
        ) : contents.sites.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Cette sauvegarde ne contient aucun site.</p>
        ) : (
          <RestoreChoices
            contents={contents}
            selectedSlug={selectedSlug}
            mode={mode}
            disabled={busy}
            onSelect={handleSelect}
            onModeChange={setMode}
          />
        )}
      </Modal>
      {confirming && selected && (
        <ConfirmDialog
          title="Remplacer le contenu de ce site ?"
          message={
            <>
              Les pages, articles et thème actuels de <strong>{selected.name}</strong> seront remplacés par ceux de la
              sauvegarde du {date}. Une sauvegarde de sécurité de tous les sites est créée juste avant, pour pouvoir revenir
              en arrière. Un éditeur de contenu resté ouvert sur ce site doit être rechargé.
            </>
          }
          confirmLabel="Remplacer le contenu"
          danger
          loading={busy}
          onConfirm={runRestore}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
