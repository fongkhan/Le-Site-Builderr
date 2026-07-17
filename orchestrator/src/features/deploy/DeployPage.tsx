import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { triggerRebuild } from '../../api/sites';
import { useBuildStatus } from '../../hooks/useBuildStatus';
import { useSites } from '../../state/SitesContext';
import { useToast } from '../../components/ui/ToastContext';
import { ApiError } from '../../api/client';
import type { Site } from '../../types';

export function DeployPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const { refresh } = useSites();
  const buildStatus = useBuildStatus();
  const toast = useToast();
  const [deployLoading, setDeployLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevInProgress = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [buildStatus.logs]);

  // Fin de build : rafraîchit la liste (le statut du site passe à active/error) + notification
  useEffect(() => {
    if (prevInProgress.current && !buildStatus.inProgress) {
      refresh();
      if (buildStatus.status === 'success') {
        toast.success('Déploiement terminé : votre site est en ligne !');
      } else if (buildStatus.status === 'error') {
        toast.error('Le build a échoué. Consultez les logs pour le détail.');
      }
    }
    prevInProgress.current = buildStatus.inProgress;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus.inProgress, buildStatus.status]);

  const handleDeploy = async () => {
    setDeployLoading(true);
    try {
      await triggerRebuild(site.slug);
      toast.info('Build démarré : suivez la progression dans la console.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast.error('Un build est déjà en cours : le verrou a bloqué la requête concurrente.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Impossible de contacter le webhook de build.');
      }
    } finally {
      setDeployLoading(false);
    }
  };

  const deployed = site.status === 'active';

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
          disabled={buildStatus.inProgress || deployLoading}
          style={{ width: '100%', padding: '14px 20px', fontSize: '1rem' }}
        >
          {buildStatus.inProgress ? '⚙️ Compilation en cours…' : '🚀 Déployer le site'}
        </button>

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
