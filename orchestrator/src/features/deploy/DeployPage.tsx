import { useEffect, useRef, useState } from 'react';
import { triggerRebuild, buildPreview } from '../../api/deploy';
import { errorMessage } from '../../api/client';
import { useBuildStatus, useRefreshBuildStatus } from '../../state/BuildStatusContext';
import { useSites } from '../../state/SitesContext';
import { useConfig } from '../../state/ConfigContext';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { publishedSiteUrl } from '../../lib/siteUrls';
import { BuildConsole } from './BuildConsole';
import { BuildHistoryPanel } from './BuildHistoryPanel';
import { VisitsPanel } from './VisitsPanel';
import { ReleasesPanel } from './ReleasesPanel';

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--accent-blue)',
  success: 'var(--accent-emerald)',
  error: 'var(--accent-rose)',
};

export function DeployPage() {
  const site = useCurrentSite();
  const { refresh } = useSites();
  const { config } = useConfig();
  const buildStatus = useBuildStatus();
  const refreshBuildStatus = useRefreshBuildStatus();
  const toast = useToast();
  const [deployLoading, setDeployLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const prevBuildingThisSite = useRef(false);

  const buildingThisSite = buildStatus.buildingSite === site.slug;
  const myQueuePosition =
    buildStatus.queuedSites?.find((q) => q.slug === site.slug)?.position ??
    (buildStatus.queue?.includes(site.slug) ? buildStatus.queue.indexOf(site.slug) + 1 : null);

  // Fin du build de CE site (la file peut enchaîner sur un autre : inProgress ne suffit
  // pas). Le serveur ne libère buildingSite qu'APRÈS avoir fixé le statut final.
  useEffect(() => {
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
  }, [buildingThisSite, buildStatus.status]);

  const handleDeploy = async () => {
    setDeployLoading(true);
    try {
      const result = await triggerRebuild(site.slug);
      if (result.alreadyBuilding) {
        toast.info('Un build est déjà en cours pour ce site : vos dernières modifications seront publiées juste après.');
      } else if (result.queued) {
        toast.info(`Un autre build est en cours : votre site est en file d'attente (position ${result.position}).`);
      } else {
        toast.info('Build démarré : suivez la progression dans la console.');
      }
      // Sondage immédiat : un build rapide ne doit pas passer inaperçu entre deux sondages
      refreshBuildStatus();
    } catch (err) {
      toast.error(errorMessage(err, 'Impossible de contacter le webhook de build.'));
    } finally {
      setDeployLoading(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await buildPreview(site.slug);
      setPreviewUrl(res.url);
      // Pas de window.open après une attente : les navigateurs le bloquent comme pop-up
      toast.success('Prévisualisation prête : ouvrez-la avec le lien sous le bouton.');
    } catch (err) {
      toast.error(errorMessage(err, 'Impossible de générer la prévisualisation.'));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Changer de site efface le lien d'aperçu du site précédent
  useEffect(() => {
    setPreviewUrl(null);
  }, [site.slug]);

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
            <span style={{ color: STATUS_COLORS[buildStatus.status] ?? 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>
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
          className="btn btn-secondary"
          onClick={handlePreview}
          disabled={previewLoading || buildingThisSite || buildStatus.inProgress}
          style={{ width: '100%' }}
          title="Compile le contenu actuel dans un espace de test, sans modifier le site en ligne"
        >
          {previewLoading ? '👁️ Génération de l’aperçu…' : '👁️ Prévisualiser le brouillon'}
        </button>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none', justifyContent: 'center', borderColor: 'var(--accent-blue)' }}>
            Ouvrir la prévisualisation ↗
          </a>
        )}

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
            href={publishedSiteUrl(site, config?.hostingMode)}
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
        <BuildConsole logs={buildStatus.logs} />
        <BuildHistoryPanel siteSlug={site.slug} buildingThisSite={buildingThisSite} />
        <VisitsPanel siteSlug={site.slug} />
        <ReleasesPanel siteSlug={site.slug} buildingThisSite={buildingThisSite} />
      </div>
    </div>
  );
}
