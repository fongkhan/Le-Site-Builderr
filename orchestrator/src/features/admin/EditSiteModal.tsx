import { useState } from 'react';
import { updateSite } from '../../api/sites';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import type { Site } from '../../types';

export function EditSiteModal({ site, onClose, onSaved }: { site: Site; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [documentRoot, setDocumentRoot] = useState(site.documentRoot);
  const [repositoryPath, setRepositoryPath] = useState(site.repositoryPath || '');
  const [stack, setStack] = useState(site.stack);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Le nom du site est requis.');
      return;
    }
    setSaving(true);
    try {
      await updateSite(site.slug, { name, domain, documentRoot, repositoryPath, stack });
      toast.success('Configuration du site mise à jour.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur de mise à jour.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="✏️ Modifier la configuration du site"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div>
        <label className="field-label">Nom du site *</label>
        <input type="text" className="input-text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Domaine personnalisé</label>
        <input type="text" className="input-text" value={domain} onChange={(e) => setDomain(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Document Root (dossier web public)</label>
        <input type="text" className="input-text" value={documentRoot} onChange={(e) => setDocumentRoot(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Repository (code source — optionnel)</label>
        <input type="text" className="input-text" value={repositoryPath} onChange={(e) => setRepositoryPath(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Stack technique</label>
        <select className="select-dark" value={stack} onChange={(e) => setStack(e.target.value)} style={{ padding: 10, fontSize: '0.9rem' }}>
          <option value="Astro SSG">Astro SSG</option>
          <option value="Astro Hybride + Payload + Medusa">Astro Hybride + CMS</option>
          <option value="Static HTML">HTML/CSS Statique</option>
        </select>
      </div>
    </Modal>
  );
}
