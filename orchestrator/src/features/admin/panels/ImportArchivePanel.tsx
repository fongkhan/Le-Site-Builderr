import { useRef, useState } from 'react';
import { importSiteArchive } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';

// Import d'une sauvegarde de site (archive zip produite par le bouton Exporter)
export function ImportArchivePanel({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Choisissez une archive .zip exportée depuis le panel.');
      return;
    }
    setImporting(true);
    try {
      const r = await importSiteArchive(file);
      toast.success(`Site « ${r.site.name} » importé (${r.extractedFiles} fichier(s) de build restauré(s)).`);
      onImported();
    } catch (err) {
      toast.error(errorMessage(err, "Échec de l'import de l'archive."));
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
          Importez une archive exportée (bouton « Exporter » d'un site) : pages, articles, thème et build sont recréés sous un nouveau slug.
        </p>
      </div>
      <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing} style={{ whiteSpace: 'nowrap' }}>
        {importing ? 'Import en cours…' : '📥 Importer une archive'}
      </button>
      <input ref={fileRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}
