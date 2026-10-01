import { useCallback, useEffect, useState } from 'react';
import { duplicateSite, fetchSiteOwners } from '../../api/sites';
import { errorMessage } from '../../api/client';
import { useSites } from '../../state/SitesContext';
import { useBuildStatus } from '../../state/BuildStatusContext';
import { useToast } from '../../components/ui/ToastContext';
import { EditSiteModal } from './EditSiteModal';
import { ImportSiteModal } from './ImportSiteModal';
import { FileManagerModal } from './FileManagerModal';
import { CreateClientModal } from './CreateClientModal';
import { StatsBanner } from './panels/StatsBanner';
import { OverviewPanel } from './panels/OverviewPanel';
import { HostingPanel } from './panels/HostingPanel';
import { BackupsPanel } from './panels/BackupsPanel';
import { ScanPanel } from './panels/ScanPanel';
import { CreateSitePanel } from './panels/CreateSitePanel';
import { ImportArchivePanel } from './panels/ImportArchivePanel';
import { AuditPanel } from './panels/AuditPanel';
import { SitesTable } from './sites/SitesTable';
import { DeleteSiteDialog } from './sites/DeleteSiteDialog';
import type { ScannedSite, Site } from '../../types';

// Panel d'administration : composition des panneaux. `version` est incrémentée après
// chaque action qui modifie les sites, pour rafraîchir la vue d'ensemble et l'audit.
export function AdminPanel() {
  const { sites, refresh } = useSites();
  const buildStatus = useBuildStatus();
  const toast = useToast();

  const [version, setVersion] = useState(0);
  const [editSite, setEditSite] = useState<Site | null>(null);
  const [fileManagerSite, setFileManagerSite] = useState<Site | null>(null);
  const [importCandidate, setImportCandidate] = useState<ScannedSite | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [scannedSites, setScannedSites] = useState<ScannedSite[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, string[]>>({});

  // Propriétaires des sites (rafraîchis après chaque action d'administration)
  const loadOwners = useCallback(() => {
    fetchSiteOwners().then(setOwners).catch(() => setOwners({}));
  }, []);
  useEffect(loadOwners, [loadOwners, version]);

  const sitesChanged = useCallback(() => {
    refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const handleDuplicate = async (site: Site) => {
    if (duplicating) return;
    setDuplicating(site.slug);
    try {
      const r = await duplicateSite(site.slug);
      toast.success(`Site dupliqué : « ${r.site.name} » (slug ${r.site.slug}).`);
      sitesChanged();
    } catch (err) {
      toast.error(errorMessage(err, 'Échec de la duplication.'));
    } finally {
      setDuplicating(null);
    }
  };

  return (
    <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.75rem' }}>Panel d'administration</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Gestion de l'ensemble des sites hébergés et des comptes clients.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setCreatingClient(true)}>
            👤 Créer un compte client
          </button>
          <a href="/admin/collections/users" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            👥 Gérer les utilisateurs
          </a>
          <a href="/admin" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            🗄️ Panel Payload CMS
          </a>
        </div>
      </div>

      <StatsBanner sites={sites} buildInProgress={buildStatus.inProgress} buildingSite={buildStatus.buildingSite} queueLength={buildStatus.queueLength ?? 0} />

      <OverviewPanel version={version} />

      <HostingPanel />

      <BackupsPanel />

      <div className="grid-2col">
        <ScanPanel scannedSites={scannedSites} onScanned={setScannedSites} onImportClick={setImportCandidate} />
        <CreateSitePanel onCreated={sitesChanged} />
      </div>

      <SitesTable
        sites={sites}
        owners={owners}
        duplicating={duplicating}
        onEdit={setEditSite}
        onFiles={setFileManagerSite}
        onDelete={setSiteToDelete}
        onDuplicate={handleDuplicate}
      />

      <ImportArchivePanel onImported={sitesChanged} />

      <AuditPanel version={version} />

      {editSite && <EditSiteModal site={editSite} onClose={() => setEditSite(null)} onSaved={sitesChanged} />}
      {fileManagerSite && <FileManagerModal site={fileManagerSite} onClose={() => setFileManagerSite(null)} />}
      {importCandidate && (
        <ImportSiteModal
          scanned={importCandidate}
          onClose={() => setImportCandidate(null)}
          onImported={(slug) => {
            setScannedSites((prev) => prev.filter((s) => s.slug !== slug));
            sitesChanged();
          }}
        />
      )}
      {siteToDelete && <DeleteSiteDialog site={siteToDelete} onClose={() => setSiteToDelete(null)} onDeleted={sitesChanged} />}
      {creatingClient && (
        <CreateClientModal
          sites={sites}
          onClose={() => setCreatingClient(false)}
          // Un compte créé ne change pas la liste des sites : seuls les propriétaires
          onCreated={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
