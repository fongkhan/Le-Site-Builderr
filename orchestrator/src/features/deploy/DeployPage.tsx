import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { triggerRebuild } from '../../api/sites';
import { useBuildStatus } from '../../hooks/useBuildStatus';
import { useSites } from '../../state/SitesContext';
import { useToast } from '../../components/ui/ToastContext';
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
      </div>
    </div>
  );
}
