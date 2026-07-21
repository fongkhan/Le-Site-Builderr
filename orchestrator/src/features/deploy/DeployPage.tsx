import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { triggerRebuild, fetchReleases, rollbackRelease, fetchBuildHistory } from '../../api/sites';
import type { Release, BuildHistoryEntry } from '../../api/sites';
import { useAuth } from '../../auth/AuthContext';
import { useBuildStatus } from '../../hooks/useBuildStatus';
import { useSites } from '../../state/SitesContext';
import { useToast } from '../../components/ui/ToastContext';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { Site } from '../../types';

export function DeployPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const { refresh } = useSites();
  const buildStatus = useBuildStatus();
  const toast = useToast();
  const [deployLoading, setDeployLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevBuildingThisSite = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [buildStatus.logs]);

  // Fin du build de CE site (la file peut enchaîner sur un autre : inProgress ne suffit pas)
  useEffect(() => {
    const buildingThisSite = buildStatus.buildingSite === site.slug;
    if (prevBuildingThisSite.current && !buildingThisSite) {
      refresh();
      if (buildStatus.status === 'success') {
        toast.success('Déploiement terminé : votre site est en ligne !');
      } else if (buildStatus.status === 'error') {
        toast.error('Le build a échoué. Consultez les logs pour le détail.');
      }
    }
    prevBuildingThisSite.current = buildingThisSite;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus.buildingSite, buildStatus.status, site.slug]);

  const handleDeploy = async () => {
    setDeployLoading(true);
    try {
      const result = await triggerRebuild(site.slug);
      if (result.queued) {
        toast.info(`Un autre build est en cours : votre site est en file d'attente (position ${result.position}).`);
      } else if (result.alreadyBuilding) {
        toast.info('Un build est déjà en cours pour ce site.');
      } else {
        toast.info('Build démarré : suivez la progression dans la console.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossible de contacter le webhook de build.');
    } finally {
      setDeployLoading(false);
    }
  };

  const deployed = site.status === 'active';
  const buildingThisSite = buildStatus.buildingSite === site.slug;
  const myQueuePosition =
    buildStatus.queuedSites?.find((q) => q.slug === site.slug)?.position ??
    (buildStatus.queue?.includes(site.slug) ? buildStatus.queue.indexOf(site.slug) + 1 : null);

  return (
    <div className="animate-slide grid-2col">
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Compilation & déploiement</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: 5 }}>
            Le déploiement recompile votre site (Astro) puis copie les fichiers vers le dossier de production.
            Un verrou empêche les compilations simultanées.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Statut du build :</span>
            <span style={{
              color: buildStatus.status === 'running' ? 'var(--accent-blue)' :
                     buildStatus.status === 'success' ? 'var(--accent-emerald)' :
                     buildStatus.status === 'error' ? 'var(--accent-rose)' : 'var(--text-muted)',
              fontWeight: 'bold',
              textTransform: 'uppercase',
            }}>
              {buildStatus.status}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Verrou de build :</span>
            <span style={{ color: buildStatus.lockExists ? 'var(--accent-rose)' : 'var(--accent-emerald)', fontWeight: 'bold' }}>
              {buildStatus.lockExists ? '🔒 Posé (build en cours)' : '🔓 Libre (prêt)'}
            </span>
          </div>

          {buildStatus.lastCompleted && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>Dernier succès :</span>
              <span>{buildStatus.lastCompleted}</span>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleDeploy}
          disabled={buildingThisSite || myQueuePosition !== null || deployLoading}
          style={{ width: '100%', padding: '14px 20px', fontSize: '1rem' }}
        >
          {buildingThisSite ? '⚙️ Compilation en cours…' :
           myQueuePosition !== null ? `⏳ En file d'attente (position ${myQueuePosition})` :
           '🚀 Déployer le site'}
        </button>

        {!buildingThisSite && myQueuePosition === null && buildStatus.inProgress && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            Un build d'un autre site est en cours : votre déploiement sera mis en file d'attente.
          </p>
        )}

        {deployed && (
          <a
            href={`/preview/${site.slug}/index.html`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ textDecoration: 'none', justifyContent: 'center' }}
          >
            Voir le site en ligne ↗
          </a>
        )}

        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: 15 }}>
          <strong>Note :</strong> les fichiers compilés sont copiés vers <code>{site.documentRoot}</code>.
        </div>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>📄 Console de logs en direct</h3>
        <div className="terminal">
          {buildStatus.logs || 'Console initialisée. En attente de build…'}
          <div ref={logsEndRef} />
        </div>
        <BuildHistoryPanel siteSlug={site.slug} buildingThisSite={buildingThisSite} />
        <ReleasesPanel siteSlug={site.slug} buildingThisSite={buildingThisSite} />
      </div>
    </div>
  );
}

// Historique des 10 derniers builds du site (admin et propriétaire).
function BuildHistoryPanel({ siteSlug, buildingThisSite }: { siteSlug: string; buildingThisSite: boolean }) {
  const [items, setItems] = useState<BuildHistoryEntry[]>([]);

  useEffect(() => {
    if (!buildingThisSite) {
      fetchBuildHistory(siteSlug).then(setItems).catch(() => setItems([]));
    }
  }, [siteSlug, buildingThisSite]);

  if (items.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 8 }}>📜 Historique des builds</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((b, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.8rem', padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)' }}>
            <span style={{ color: b.status === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 700 }}>
              {b.status === 'success' ? '✅ Succès' : '❌ Échec'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{new Date(b.createdAt).toLocaleString()}</span>
            <span style={{ color: 'var(--text-muted)' }}>{b.durationMs != null ? `${Math.round(b.durationMs / 1000)} s` : '—'}</span>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{b.triggeredBy || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Versions précédentes (admin uniquement) : liste des releases conservées + rollback.
// Rafraîchie à la fin d'un build de ce site (une nouvelle release vient d'être créée).
function ReleasesPanel({ siteSlug, buildingThisSite }: { siteSlug: string; buildingThisSite: boolean }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { refresh } = useSites();
  const [items, setItems] = useState<Release[]>([]);
  const [toRollback, setToRollback] = useState<Release | null>(null);
  const [rolling, setRolling] = useState(false);

  const load = () => fetchReleases(siteSlug).then(setItems).catch(() => setItems([]));

  useEffect(() => {
    if (!isAdmin) return;
    if (!buildingThisSite) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, siteSlug, buildingThisSite]);

  if (!isAdmin || items.length === 0) return null;

  const handleRollback = async () => {
    if (!toRollback) return;
    setRolling(true);
    try {
      await rollbackRelease(siteSlug, toRollback.id);
      toast.success(`Site restauré sur la version du ${new Date(toRollback.date).toLocaleString()}.`);
      refresh();
      load();
      setToRollback(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du retour arrière.');
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
              {new Date(r.date).toLocaleString()}
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
          message={`Le site en ligne sera remplacé par la version du ${new Date(toRollback.date).toLocaleString()}. Le contenu du CMS n'est pas modifié : un prochain déploiement republiera la version courante.`}
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
