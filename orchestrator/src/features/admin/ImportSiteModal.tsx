import { useState } from 'react';
import { importSite } from '../../api/sites';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import type { ScannedSite } from '../../types';

// Remplace l'ancien enchaînement de prompt() : un vrai formulaire de confirmation d'import
export function ImportSiteModal({ scanned, onClose, onImported }: { scanned: ScannedSite; onClose: () => void; onImported: (slug: string) => void }) {
  const toast = useToast();
  const [stack, setStack] = useState(scanned.stack || 'Static HTML');
  const [documentRoot, setDocumentRoot] = useState(scanned.documentRoot);
  const [repositoryPath, setRepositoryPath] = useState(scanned.repositoryPath || '');
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    try {
      await importSite({ ...scanned, stack, documentRoot, repositoryPath });
      toast.success(`Site « ${scanned.name} » importé avec succès !`);
      onImported(scanned.slug);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'importation.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title="📥 Importer un site détecté"
      subtitle={<>Dossier : <strong>{scanned.name}</strong> (slug : {scanned.slug})</>}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            {importing ? 'Import…' : 'Importer dans le cPanel'}
          </button>
        </>
      }
    >
      <div>
        <label className="field-label">Stack technique</label>
        <select className="select-dark" value={stack} onChange={(e) => setStack(e.target.value)} style={{ padding: 10, fontSize: '0.9rem' }}>
          <option value="Static HTML">HTML/CSS Statique</option>
          <option value="Astro SSG">Astro SSG</option>
          <option value="Astro Site (Source + Build)">Astro Site (Source + Build)</option>
          <option value="Node.js / CMS Repository">Node.js / CMS Repository</option>
          <option value="Astro Hybride + Payload + Medusa">Astro Hybride + CMS</option>
        </select>
      </div>
      <div>
        <label className="field-label">Document Root (dossier web public)</label>
        <input type="text" className="input-text" value={documentRoot} onChange={(e) => setDocumentRoot(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Repository (code source CMS/backend — optionnel)</label>
        <input type="text" className="input-text" value={repositoryPath} onChange={(e) => setRepositoryPath(e.target.value)} />
      </div>
    </Modal>
  );
}
