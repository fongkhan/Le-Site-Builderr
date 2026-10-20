import { useCallback, useEffect, useState } from 'react';
import { fetchSystemInfo, purgeOrphans } from '../../../api/system';
import type { SystemInfo } from '../../../api/system';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { formatBytes, formatDateTimeFr } from '../../../lib/format';
import { FOLDER_LABELS, ORPHAN_CATEGORIES, ORPHAN_LABELS, diskSummary, formatUptime, orphanSummary } from './systemFormat';

const muted = { color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 } as const;
const warning = { color: 'var(--amber-400)', fontSize: '0.85rem', margin: 0 } as const;
const sectionTitle = { fontSize: '0.95rem', margin: '4px 0 0' } as const;

interface SystemViewProps {
  info: SystemInfo;
  refreshing?: boolean;
  onRefresh?: () => void;
  onPurge?: () => void;
}

// Présentation pure de l'état du système (testée par rendu serveur, sans contexte).
export function SystemView({ info, refreshing = false, onRefresh, onPurge }: SystemViewProps) {
  const { app, disk, folders, build, backups, orphans } = info;
  const diskState = diskSummary(disk);
  const purgeable = orphanSummary(orphans);
  const kept = orphans.kept || { publicDirs: [], repositories: [] };
  const hasKept = kept.publicDirs.length > 0 || kept.repositories.length > 0;
  const node = app.node.startsWith('v') ? app.node : `v${app.node}`;
  const latestDate = backups.latest ? formatDateTimeFr(backups.latest.createdAt) : '';
  const backupSummary = `Dernière sauvegarde : ${latestDate} — ${backups.count} conservée(s), ${formatBytes(backups.totalBytes)}.`;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        <h3 style={{ margin: 0 }}>🖥️ Système</h3>
        {onRefresh && (
          <button className="btn btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Actualisation…' : 'Actualiser'}
          </button>
        )}
      </div>

      <p style={muted}>
        {`Version ${app.version} · Node ${node} · ${app.environment === 'production' ? 'Production' : 'Développement'} · Hébergement : ${app.hosting === 'cpanel' ? 'cPanel' : 'simulation locale'} · En service depuis ${formatUptime(app.uptimeS)}`}
      </p>

      {diskState && disk ? (
        <>
          <p style={muted}>
            {`Espace disque : ${formatBytes(disk.freeBytes)} libres sur ${formatBytes(disk.totalBytes)} (${diskState.usedPct} % utilisés)`}
          </p>
          {diskState.low && <p style={warning}>⚠️ Espace disque faible : libérez de la place (sauvegardes, versions, données orphelines).</p>}
        </>
      ) : (
        <p style={muted}>Espace disque : indisponible.</p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table-cpanel" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Dossier</th>
              <th>Taille</th>
              <th>Fichiers</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => (
              <tr key={f.key}>
                <td>{FOLDER_LABELS[f.key] || f.label}</td>
                <td>{f.truncated ? `≥ ${formatBytes(f.bytes)} (comptage partiel)` : formatBytes(f.bytes)}</td>
                <td>{f.truncated ? `≥ ${f.files}` : f.files}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={muted}>
        {`${build.inProgress && build.buildingSite ? `Build en cours : « ${build.buildingSite} ».` : 'Aucun build en cours.'} ${build.queue.length > 0 ? `File d'attente : ${build.queue.join(', ')}.` : "File d'attente vide."}`}
      </p>

      {backups.state === 'désactivées' && (
        <>
          <p style={muted}>Sauvegardes automatiques désactivées (<code>BACKUP_ENABLED=true</code> pour les planifier).</p>
          {backups.latest && <p style={muted}>{backupSummary}</p>}
        </>
      )}
      {backups.state === 'aucune' && <p style={muted}>Aucune sauvegarde pour l'instant.</p>}
      {backups.state === 'ok' && <p style={muted}>{backupSummary}</p>}
      {backups.state === 'en retard' && (
        <p style={warning}>{`⚠️ Dernière sauvegarde le ${latestDate} : plus de deux intervalles sans sauvegarde.`}</p>
      )}

      <h4 style={sectionTitle}>🧹 Données orphelines</h4>
      {purgeable.count === 0 && <p style={muted}>{hasKept ? 'Aucune donnée orpheline à nettoyer.' : 'Aucune donnée orpheline.'}</p>}
      {ORPHAN_CATEGORIES.filter((c) => orphans[c].length > 0).map((c) => (
        <details key={c} style={{ fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer' }}>
            {`${ORPHAN_LABELS[c]} : ${orphans[c].length} (${formatBytes(orphans[c].reduce((sum, e) => sum + (Number(e.bytes) || 0), 0))})`}
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: 'var(--text-muted)' }}>
            {orphans[c].map((e) => <li key={e.name}><code>{e.name}</code>{` — ${formatBytes(e.bytes)}`}</li>)}
          </ul>
        </details>
      ))}
      {kept.publicDirs.length > 0 && (
        <details style={{ fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer' }}>{`Dossiers publiés sans site (conservés) : ${kept.publicDirs.length} — à vérifier manuellement`}</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: 'var(--text-muted)' }}>
            {kept.publicDirs.map((e) => <li key={e.name}><code>{e.name}</code></li>)}
          </ul>
        </details>
      )}
      {kept.repositories.length > 0 && (
        <details style={{ fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer' }}>{`Dépôts non créés par l'outil (conservés) : ${kept.repositories.length} — à vérifier manuellement`}</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: 'var(--text-muted)' }}>
            {kept.repositories.map((e) => <li key={e.name}><code>{e.name}</code></li>)}
          </ul>
        </details>
      )}
      {purgeable.count > 0 && (
        orphans.purgeAvailable ? (
          <div>
            <button className="btn btn-secondary" onClick={onPurge} disabled={!onPurge}>
              {`Nettoyer (${purgeable.count} élément(s), ${formatBytes(purgeable.bytes)})`}
            </button>
          </div>
        ) : (
          <p style={warning}>Nettoyage indisponible sans base de données.</p>
        )
      )}
    </div>
  );
}

// Panneau Système (admin) : rechargé à chaque action d'administration (`version`) et sur
// demande ; nettoyage des données orphelines après confirmation.
export function SystemPanel({ version }: { version: number }) {
  const toast = useToast();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(
    () => fetchSystemInfo().then(setInfo).catch(() => setInfo(null)),
    []
  );
  useEffect(() => {
    load();
  }, [load, version]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const handlePurge = async () => {
    if (!info) return;
    setPurging(true);
    try {
      const categories = ORPHAN_CATEGORIES.filter((c) => info.orphans[c].length > 0);
      // Seuls les éléments affichés et confirmés : un orphelin apparu depuis n'est pas touché
      const names = [...new Set(categories.flatMap((c) => info.orphans[c].map((e) => e.name)))];
      const result = await purgeOrphans({ categories, names });
      const removed = ORPHAN_CATEGORIES.reduce((sum, c) => sum + (result.removed[c]?.length || 0), 0);
      toast.success(`Nettoyage terminé : ${removed} élément(s) supprimé(s), ${formatBytes(result.bytes)} libérés.`);
      if (result.failed > 0) toast.error(`${result.failed} élément(s) n'ont pas pu être supprimés : consultez le journal du serveur.`);
      setConfirming(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Échec du nettoyage des données orphelines.'));
    } finally {
      setPurging(false);
    }
  };

  if (!info) return null;
  const summary = orphanSummary(info.orphans);

  return (
    <>
      <SystemView info={info} refreshing={refreshing} onRefresh={handleRefresh} onPurge={() => setConfirming(true)} />
      {confirming && (
        <ConfirmDialog
          title="Nettoyer les données orphelines ?"
          message={`${summary.count} élément(s) (${formatBytes(summary.bytes)}) appartenant à des sites supprimés seront définitivement effacés. Les sites existants, les dossiers publiés et les sauvegardes ne sont pas touchés.`}
          confirmLabel="Nettoyer"
          danger
          loading={purging}
          onConfirm={handlePurge}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
