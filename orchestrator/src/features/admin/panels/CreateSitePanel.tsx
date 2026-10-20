import { useState } from 'react';
import { createSite } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { FieldError } from '../../../components/ui/FieldError';
import { useToast } from '../../../components/ui/ToastContext';
import { focusField, invalidProps, validateSiteName } from '../../../lib/formValidation';
import { StackSelect } from '../StackSelect';

const NAME_ERROR_ID = 'new-site-name-erreur';

export function CreateSitePanel({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [stack, setStack] = useState('Astro SSG');
  const [documentRoot, setDocumentRoot] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  const handleCreate = async () => {
    if (creating) return;
    const error = validateSiteName(name);
    setNameError(error);
    if (error) {
      focusField('new-site-name');
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
      toast.success(data.renamedFrom
        ? `Site « ${data.site.name} » créé sous l'identifiant « ${data.site.slug} » : des fichiers d'un ancien site occupaient « ${data.renamedFrom} ».`
        : `Site « ${data.site.name} » créé avec succès !`);
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
    <form
      className="glass-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 15 }}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
    >
      <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
        🆕 Enregistrer un nouveau site
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Enregistrez manuellement un site : il démarre avec une page d'accueil à son nom, prête à personnaliser.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="field-label" htmlFor="new-site-name">Nom du site *</label>
          <input
            id="new-site-name"
            type="text"
            className="input-text"
            style={{ padding: 8, fontSize: '0.875rem' }}
            required
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(undefined); }}
            placeholder="Coiffeur Lyon"
            {...invalidProps(NAME_ERROR_ID, nameError)}
          />
          <FieldError id={NAME_ERROR_ID} message={nameError} />
        </div>
        <div>
          <label className="field-label" htmlFor="new-site-domain">Domaine (optionnel)</label>
          <input id="new-site-domain" type="text" className="input-text" style={{ padding: 8, fontSize: '0.875rem' }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="coiffeur.lyon.site" />
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="new-site-stack">Stack technique</label>
        <StackSelect id="new-site-stack" value={stack} onChange={setStack} compact />
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

      <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} disabled={creating}>
        {creating ? 'Création…' : 'Initialiser et enregistrer'}
      </button>
    </form>
  );
}
