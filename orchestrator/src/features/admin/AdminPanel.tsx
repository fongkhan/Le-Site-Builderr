import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createSite, deleteSite, scanSites, fetchSiteOwners, fetchHostingStatus, testHostingConnection, fetchAuditLog, importSiteArchive, duplicateSite } from '../../api/sites';
import type { HostingStatus, AuditEntry } from '../../api/sites';
import { useRef } from 'react';
import { useSites } from '../../state/SitesContext';
import { useBuildStatus } from '../../hooks/useBuildStatus';
import { useToast } from '../../components/ui/ToastContext';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { EditSiteModal } from './EditSiteModal';
import { ImportSiteModal } from './ImportSiteModal';
import { FileManagerModal } from './FileManagerModal';
import { CreateClientModal } from './CreateClientModal';
import type { ScannedSite, Site } from '../../types';

export function AdminPanel() {
  const { sites, refresh } = useSites();
  const buildStatus = useBuildStatus();
  const toast = useToast();

  const handleDuplicate = async (site: Site) => {
    try {
      const r = await duplicateSite(site.slug);
      toast.success(`Site dupliqué : « ${r.site.name} » (slug ${r.site.slug}).`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la duplication.');
    }
  };

  const [editSite, setEditSite] = useState<Site | null>(null);
  const [fileManagerSite, setFileManagerSite] = useState<Site | null>(null);
  const [importCandidate, setImportCandidate] = useState<ScannedSite | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [scannedSites, setScannedSites] = useState<ScannedSite[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  const [owners, setOwners] = useState<Record<string, string[]>>({});

  // Propriétaires des sites (rafraîchis quand la liste de sites change ou après création client)
  const loadOwners = () => fetchSiteOwners().then(setOwners).catch(() => setOwners({}));
  useEffect(() => {
    loadOwners();
  }, [sites.length]);

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

      <StatsBanner sitesCount={sites.length} buildInProgress={buildStatus.inProgress} buildingSite={buildStatus.buildingSite} queueLength={buildStatus.queueLength ?? 0} />

      <HostingPanel />

      <div className="grid-2col">
        <ScanPanel
          scannedSites={scannedSites}
          onScanned={setScannedSites}
          onImportClick={setImportCandidate}
        />
        <CreateSitePanel onCreated={refresh} />
      </div>

      <SitesTable
        sites={sites}
        owners={owners}
        onEdit={setEditSite}
        onFiles={setFileManagerSite}
        onDelete={setSiteToDelete}
        onDuplicate={handleDuplicate}
      />

      <ImportArchivePanel onImported={refresh} />

      <AuditPanel />

      {editSite && <EditSiteModal site={editSite} onClose={() => setEditSite(null)} onSaved={refresh} />}
      {fileManagerSite && <FileManagerModal site={fileManagerSite} onClose={() => setFileManagerSite(null)} />}
      {importCandidate && (
        <ImportSiteModal
          scanned={importCandidate}
          onClose={() => setImportCandidate(null)}
          onImported={(slug) => {
            setScannedSites((prev) => prev.filter((s) => s.slug !== slug));
            refresh();
          }}
        />
      )}
      {siteToDelete && <DeleteSiteDialog site={siteToDelete} onClose={() => setSiteToDelete(null)} onDeleted={refresh} />}
      {creatingClient && <CreateClientModal sites={sites} onClose={() => setCreatingClient(false)} onCreated={() => { refresh(); loadOwners(); }} />}
    </div>
  );
}

function StatsBanner({ sitesCount, buildInProgress, buildingSite, queueLength }: { sitesCount: number; buildInProgress: boolean; buildingSite?: string | null; queueLength: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-blue)' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sites enregistrés</span>
        <span style={{ fontSize: '2rem', fontWeight: 800 }}>{sitesCount}</span>
      </div>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-emerald)' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sécurité SSL</span>
        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-emerald)', margin: 'auto 0' }}>🔒 Let's Encrypt</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)' }}>Actif (auto-renouvellement)</span>
      </div>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-rose)' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Build courant</span>
        {buildInProgress ? (
          <>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-blue)', animation: 'pulse 1.5s infinite', margin: 'auto 0' }}>⚙️ Recompilation…</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Site : {buildingSite}{queueLength > 0 ? ` · ${queueLength} en attente` : ''}
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-muted)', margin: 'auto 0' }}>Prêt 🔓</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {queueLength > 0 ? `${queueLength} build(s) en attente` : 'Aucun build actif'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// État de l'hébergement : driver actif (simulation locale vs cPanel o2switch) + test de connexion
function HostingPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<HostingStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchHostingStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const isCpanel = status.driver === 'cpanel';

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testHostingConnection();
      if (r.ok) toast.success(r.message || 'Connexion à l’hébergement OK.');
      else toast.error(r.error || 'Échec du test de connexion.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du test de connexion.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap', borderLeft: `4px solid ${isCpanel ? 'var(--accent-emerald)' : 'var(--amber-400)'}` }}>
      <span style={{ fontSize: '1.5rem' }}>{isCpanel ? '🌍' : '🧪'}</span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>Hébergement</strong>
          <span className="badge" style={{ fontWeight: 700, color: isCpanel ? 'var(--accent-emerald)' : 'var(--amber-400)' }}>
            {isCpanel ? 'cPanel o2switch' : 'Simulation locale'}
          </span>
          {isCpanel && status.rootDomain && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {status.host} — sous-domaines de <code>{status.rootDomain}</code>
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{status.description}</p>
      </div>
      <button className="btn btn-secondary" onClick={handleTest} disabled={testing} style={{ whiteSpace: 'nowrap' }}>
        {testing ? 'Test en cours…' : '🔌 Tester la connexion'}
      </button>
    </div>
  );
}

// Import d'une sauvegarde de site (archive zip produite par le bouton Exporter)
function ImportArchivePanel({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      toast.error('Choisissez une archive .zip exportée depuis le panel.');
      return;
    }
    setImporting(true);
    try {
      const r = await importSiteArchive(file);
      toast.success(`Site « ${r.site.name} » importé (${r.extractedFiles} fichier(s) de build restauré(s)).`);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'import de l'archive.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '1.5rem' }}>📦</span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>Restaurer une sauvegarde</strong>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Importez une archive exportée (bouton « Exporter » d'un site) : contenu, thème et build sont recréés sous un nouveau slug.
        </p>
      </div>
      <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing} style={{ whiteSpace: 'nowrap' }}>
        {importing ? 'Import en cours…' : '📥 Importer une archive'}
      </button>
      <input ref={fileRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}

// Journal d'audit : 50 dernières actions sensibles (lecture seule)
function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) fetchAuditLog().then(setEntries).catch(() => setEntries([]));
  }, [open]);

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
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{new Date(e.createdAt).toLocaleString()}</td>
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

function ScanPanel({ scannedSites, onScanned, onImportClick }: {
  scannedSites: ScannedSite[];
  onScanned: (sites: ScannedSite[]) => void;
  onImportClick: (site: ScannedSite) => void;
}) {
  const toast = useToast();
  const [scanPath, setScanPath] = useState('simulated_public_html');
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      const data = await scanSites(scanPath);
      onScanned(data);
      setHasScanned(true);
      if (data.length === 0) {
        toast.info('Aucun nouveau site détecté dans ce répertoire.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors du scan.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        🔍 Détecter d'autres sites
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Scannez un répertoire pour identifier des dossiers de sites non répertoriés
        (<code>index.html</code> pour un build statique, <code>package.json</code> pour un dépôt source).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="field-label">Chemin à scanner (absolu ou relatif)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input-text"
            style={{ padding: 8, fontSize: '0.875rem', flex: 1 }}
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder="Ex : simulated_public_html"
          />
          <button className="btn btn-secondary" onClick={handleScan} disabled={scanning} style={{ whiteSpace: 'nowrap' }}>
            {scanning ? 'Recherche…' : 'Scanner'}
          </button>
        </div>
      </div>

      {scannedSites.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--purple-300)' }}>
            Dossiers détectés et non répertoriés :
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scannedSites.map((scanned) => (
              <div key={scanned.slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px' }}>
                <div>
                  <strong style={{ fontSize: '0.9rem', color: 'white' }}>{scanned.name}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    WebRoot : <code>{scanned.documentRoot}</code>
                    {scanned.repositoryPath && <> | Repo : <code>{scanned.repositoryPath}</code></>}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'rgba(168,85,247,0.4)', color: '#d8b4fe' }}
                  onClick={() => onImportClick(scanned)}
                >
                  Importer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {hasScanned && scannedSites.length === 0 && (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aucun dossier non répertorié dans ce chemin.</span>
      )}
    </div>
  );
}

function CreateSitePanel({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [stack, setStack] = useState('Astro SSG');
  const [documentRoot, setDocumentRoot] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Le nom du site est requis.');
      return;
    }
    setCreating(true);
    try {
      const data = await createSite({
        name,
        domain: domain || undefined,
        stack,
        documentRoot: documentRoot || undefined,
        repositoryPath: repositoryPath || undefined,
      });
      toast.success(`Site « ${data.site.name} » créé avec succès !`);
      setName('');
      setDomain('');
      setDocumentRoot('');
      setRepositoryPath('');
      setShowAdvanced(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la création du site.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        🆕 Enregistrer un nouveau site
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Enregistrez manuellement un site dans la base cPanel et initialisez sa configuration.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="field-label">Nom du site</label>
          <input type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Coiffeur Lyon" />
        </div>
        <div>
          <label className="field-label">Domaine personnalisé (optionnel)</label>
          <input type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="coiffeur.lyon.site" />
        </div>
      </div>
      <div>
        <label className="field-label">Stack technique</label>
        <select className="select-dark" value={stack} onChange={(e) => setStack(e.target.value)}>
          <option value="Astro SSG">Astro SSG (recommandé)</option>
          <option value="Astro Hybride + Payload + Medusa">Astro Hybride + CMS</option>
          <option value="Static HTML">HTML/CSS Statique</option>
        </select>
      </div>

      <button
        type="button"
        style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? '▲ Masquer les chemins personnalisés' : '▼ Configurer des chemins personnalisés (o2switch)'}
      </button>

      {showAdvanced && (
        <div className="animate-slide" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, background: 'rgba(255,255,255,0.01)', padding: 12, borderRadius: 8, border: '1px dashed var(--border-color)' }}>
          <div>
            <label className="field-label">Dossier web public (Document Root)</label>
            <input type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={documentRoot} onChange={(e) => setDocumentRoot(e.target.value)} placeholder="Ex : /site/simulated_public_html/mon-site" />
          </div>
          <div>
            <label className="field-label">Dossier code source (Repository)</label>
            <input type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={repositoryPath} onChange={(e) => setRepositoryPath(e.target.value)} placeholder="Ex : /site/repositories/mon-site-backend" />
          </div>
        </div>
      )}

      <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={handleCreate} disabled={creating}>
        {creating ? 'Création…' : 'Initialiser et enregistrer'}
      </button>
    </div>
  );
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  active: { label: 'Actif (déployé)', color: 'var(--accent-emerald)' },
  error: { label: 'Erreur build', color: 'var(--accent-rose)' },
  draft: { label: 'Brouillon', color: 'var(--amber-400)' },
};

function SitesTable({ sites, owners, onEdit, onFiles, onDelete, onDuplicate }: {
  sites: Site[];
  owners: Record<string, string[]>;
  onEdit: (s: Site) => void;
  onFiles: (s: Site) => void;
  onDelete: (s: Site) => void;
  onDuplicate: (s: Site) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'stack'>('name');

  const q = query.trim().toLowerCase();
  const filtered = sites
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || (s.domain || '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'fr'));

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        <h3 style={{ fontSize: '1.5rem' }}>🌐 Sites hébergés (structure cPanel)</h3>
        {sites.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="search"
              className="input-text"
              style={{ padding: '6px 10px', fontSize: '0.85rem', minWidth: 180 }}
              placeholder="🔍 Rechercher un site…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="select-dark" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>
              <option value="name">Trier par nom</option>
              <option value="status">Trier par statut</option>
              <option value="stack">Trier par stack</option>
            </select>
          </div>
        )}
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="Aucun site enregistré"
          description="Créez un site via le formulaire ci-dessus, importez-en un via le scan, ou utilisez l'assistant IA."
          action={
            <Link to="/onboarding" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              ✨ Créer avec l'IA
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Aucun site ne correspond à « {query} ».</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table-cpanel">
            <thead>
              <tr>
                <th>Site / Projet</th>
                <th>Domaine / Lien</th>
                <th>Racine & sources</th>
                <th>Stack</th>
                <th>SSL</th>
                <th>Source</th>
                <th>Statut</th>
                <th>Clients</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => {
                const status = STATUS_DISPLAY[site.status] ?? STATUS_DISPLAY.draft;
                const deployed = site.status === 'active';
                return (
                  <tr key={site.slug}>
                    <td style={{ fontWeight: 600 }}>
                      {site.name}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>slug : {site.slug}</div>
                    </td>
                    <td>
                      {deployed ? (
                        <a href={`/preview/${site.slug}/index.html`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                          {site.domain} ↗
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }} title="Jamais déployé : lancez un build pour générer le site.">
                          {site.domain} <span className="badge" style={{ fontSize: '0.7rem', color: 'var(--amber-400)' }}>non déployé</span>
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div>
                          <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>WebRoot :</span>{' '}
                          <code style={{ color: 'var(--blue-300)' }}>{site.documentRoot}</code>
                        </div>
                        {site.repositoryPath && (
                          <div>
                            <span style={{ color: 'var(--purple-300)', fontWeight: 600 }}>Repo :</span>{' '}
                            <code style={{ color: '#e9d5ff' }}>{site.repositoryPath}</code>
                          </div>
                        )}
                      </div>
                    </td>
                    <td><span className="badge">{site.stack}</span></td>
                    <td style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                      {site.sslStatus === 'active' ? "🔒 Let's Encrypt" : '⚠ Non sécurisé'}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {site.createdWithTool ? <span style={{ color: 'var(--purple-300)' }}>🛠️ Généré</span> : <span style={{ color: 'var(--text-muted)' }}>📁 Importé</span>}
                    </td>
                    <td>
                      <span className="status-dot" style={{ background: status.color }} />
                      <span>{status.label}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {(owners[site.slug] && owners[site.slug].length > 0) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {owners[site.slug].map((email) => (
                            <span key={email} style={{ color: 'var(--text-main)' }}>{email}</span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Link to={`/sites/${site.slug}/design`} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', textDecoration: 'none' }}>
                          Gérer
                        </Link>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', borderColor: 'rgba(99,102,241,0.4)', color: 'var(--indigo-200)' }} onClick={() => onEdit(site)}>
                          ✏️ Modifier
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => onFiles(site)}>
                          📁 Fichiers
                        </button>
                        <a href={`/api/sites/${site.slug}/export`} download className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', textDecoration: 'none' }} title="Télécharger une sauvegarde (contenu + thème + build)">
                          📦 Exporter
                        </a>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => onDuplicate(site)} title="Créer un jumeau de ce site (contenu + thème)">
                          ⧉ Dupliquer
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', borderColor: 'rgba(244,63,94,0.4)', color: 'var(--red-300)' }} onClick={() => onDelete(site)}>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeleteSiteDialog({ site, onClose, onDeleted }: { site: Site; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSite(site.slug, deleteFiles);
      toast.success(`Site « ${site.name} » supprimé.`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression du site.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      title="Supprimer ce site ?"
      message={
        <>
          Le site <strong>{site.name}</strong> (slug : <code>{site.slug}</code>) sera retiré de la base cPanel,
          ainsi que sa configuration de pages et de thème. Cette action est irréversible.
        </>
      }
      confirmLabel="Supprimer définitivement"
      danger
      loading={deleting}
      onConfirm={handleDelete}
      onCancel={onClose}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} style={{ width: 16, height: 16 }} />
        Supprimer également les fichiers physiques du site ({site.documentRoot})
      </label>
    </ConfirmDialog>
  );
}
