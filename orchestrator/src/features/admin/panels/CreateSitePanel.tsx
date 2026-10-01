import { useState } from 'react';
import { createSite } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';
import { StackSelect } from '../StackSelect';

export function CreateSitePanel({ onCreated }: { onCreated: () => void }) {
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
        name: name.trim(),
        domain: domain.trim() || undefined,
        stack,
        documentRoot: documentRoot.trim() || undefined,
        repositoryPath: repositoryPath.trim() || undefined,
      });
      toast.success(`Site « ${data.site.name} » créé avec succès !`);
      setName('');
      setDomain('');
      setDocumentRoot('');
      setRepositoryPath('');
      setShowAdvanced(false);
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err, 'Erreur lors de la création du site.'));
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
        Enregistrez manuellement un site : il démarre avec une page d'accueil à son nom, prête à personnaliser.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="field-label" htmlFor="new-site-name">Nom du site</label>
          <input id="new-site-name" type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Coiffeur Lyon" />
        </div>
        <div>
          <label className="field-label" htmlFor="new-site-domain">Domaine (optionnel)</label>
          <input id="new-site-domain" type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="coiffeur.lyon.site" />
        </div>
      </div>
      <div>
        <label className="field-label">Stack technique</label>
        <StackSelect value={stack} onChange={setStack} compact />
      </div>

      <button
        type="button"
        style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        onClick={() => setShowAdvanced(!showAdvanced)}
        aria-expanded={showAdvanced}
      >
        {showAdvanced ? '▲ Masquer les chemins personnalisés' : '▼ Configurer des chemins personnalisés (o2switch)'}
      </button>

      {showAdvanced && (
        <div className="animate-slide" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, background: 'rgba(255,255,255,0.01)', padding: 12, borderRadius: 8, border: '1px dashed var(--border-color)' }}>
          <div>
            <label className="field-label" htmlFor="new-site-root">Dossier web public (Document Root)</label>
            <input id="new-site-root" type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={documentRoot} onChange={(e) => setDocumentRoot(e.target.value)} placeholder="Sous-dossier de simulated_public_html" />
          </div>
          <div>
            <label className="field-label" htmlFor="new-site-repo">Dossier code source (Repository)</label>
            <input id="new-site-repo" type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={repositoryPath} onChange={(e) => setRepositoryPath(e.target.value)} placeholder="Sous-dossier de repositories" />
          </div>
        </div>
      )}

      <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={handleCreate} disabled={creating}>
        {creating ? 'Création…' : 'Initialiser et enregistrer'}
      </button>
    </div>
  );
}
