import { useState } from 'react';
import { scanSites } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';
import type { ScannedSite } from '../../../types';

export function ScanPanel({ scannedSites, onScanned, onImportClick }: {
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
      toast.error(errorMessage(err, 'Erreur lors du scan.'));
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
        Scannez le dossier de production (<code>simulated_public_html</code>) ou celui des dépôts
        (<code>repositories</code>) pour identifier des sites non répertoriés
        (<code>index.html</code> pour un build statique, <code>package.json</code> pour un dépôt source).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="field-label" htmlFor="scan-path">Dossier à scanner (relatif au projet)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="scan-path"
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
                    {scanned.documentRoot && <>WebRoot : <code>{scanned.documentRoot}</code></>}
                    {scanned.documentRoot && scanned.repositoryPath && ' | '}
                    {scanned.repositoryPath && <>Repo : <code>{scanned.repositoryPath}</code></>}
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
