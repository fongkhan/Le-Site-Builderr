import { useState } from 'react';
import { updateSite, attachCustomDomain, verifyCustomDomain, detachCustomDomain } from '../../api/sites';
import type { CustomDomainRecord } from '../../api/sites';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/ToastContext';
import type { Site } from '../../types';

const DOMAIN_STATUS: Record<string, { label: string; color: string }> = {
  none: { label: 'Sous-domaine par défaut', color: 'var(--text-muted)' },
  pending: { label: 'En attente de vérification', color: 'var(--amber-400)' },
  active: { label: '🔒 Domaine actif', color: 'var(--accent-emerald)' },
  error: { label: '⚠ Erreur de rattachement', color: 'var(--accent-rose)' },
};

export function EditSiteModal({ site, onClose, onSaved }: { site: Site; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [documentRoot, setDocumentRoot] = useState(site.documentRoot);
  const [repositoryPath, setRepositoryPath] = useState(site.repositoryPath || '');
  const [stack, setStack] = useState(site.stack);
  const [saving, setSaving] = useState(false);

  // --- Domaine personnalisé ---
  const [customInput, setCustomInput] = useState(site.customDomain || '');
  const [domainStatus, setDomainStatus] = useState<string>(site.domainStatus || 'none');
  const [record, setRecord] = useState<CustomDomainRecord | null>(null);
  const [pointingHint, setPointingHint] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);

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

  const handleAttach = async () => {
    if (!customInput.trim()) {
      toast.error('Saisissez le nom de domaine du client.');
      return;
    }
    setDomainBusy(true);
    try {
      const res = await attachCustomDomain(site.slug, customInput.trim());
      setRecord(res.record);
      setPointingHint(res.pointingHint);
      setDomainStatus(res.domainStatus);
      setCustomInput(res.customDomain);
      toast.success('Domaine enregistré. Publiez l’enregistrement TXT puis vérifiez.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossible d’enregistrer le domaine.');
    } finally {
      setDomainBusy(false);
    }
  };

  const handleVerify = async () => {
    setDomainBusy(true);
    try {
      const res = await verifyCustomDomain(site.slug);
      setDomainStatus(res.domainStatus);
      if (res.verified) {
        toast.success('Domaine vérifié et activé ! Le certificat SSL sera émis une fois le DNS propagé.');
        setRecord(null);
        onSaved();
      } else {
        toast.info(res.message || 'Enregistrement TXT introuvable pour le moment.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la vérification.');
    } finally {
      setDomainBusy(false);
    }
  };

  const handleDetach = async () => {
    setDomainBusy(true);
    try {
      const res = await detachCustomDomain(site.slug);
      setDomainStatus('none');
      setRecord(null);
      setCustomInput('');
      setDomain(res.domain);
      toast.success('Domaine personnalisé détaché. Le site repasse sur son sous-domaine.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossible de détacher le domaine.');
    } finally {
      setDomainBusy(false);
      setConfirmDetach(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.info('Copié dans le presse-papiers.'),
      () => {},
    );
  };

  const st = DOMAIN_STATUS[domainStatus] ?? DOMAIN_STATUS.none;

  return (
    <Modal
      title="✏️ Modifier la configuration du site"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
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
        <label className="field-label">Domaine servi (sous-domaine généré)</label>
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

      {/* --- Domaine personnalisé --- */}
      <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 16, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <label className="field-label" style={{ margin: 0 }}>🌐 Domaine personnalisé du client</label>
          <span className="badge" style={{ color: st.color, borderColor: st.color, fontSize: '0.72rem' }}>{st.label}</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
          Rattachez le vrai nom de domaine acheté par le client (ex. <code>mon-commerce.fr</code>). La propriété est
          vérifiée par un enregistrement TXT, puis le domaine est ajouté à l’hébergement (SSL automatique).
        </p>

        {domainStatus === 'active' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.9rem' }}>
              Domaine actif : <strong style={{ color: 'var(--accent-emerald)' }}>{site.customDomain || customInput}</strong>
            </span>
            <button className="btn btn-secondary" style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)' }} onClick={() => setConfirmDetach(true)} disabled={domainBusy}>
              Détacher
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="field-label">Nom de domaine</label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="mon-commerce.fr"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                />
              </div>
              <button className="btn btn-secondary" onClick={handleAttach} disabled={domainBusy}>
                {domainBusy ? '…' : 'Générer les instructions'}
              </button>
            </div>

            {record && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  1. Ajoutez cet enregistrement <strong>TXT</strong> chez le registraire du client :
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Type</span>
                  <code>{record.type}</code>
                  <span />
                  <span style={{ color: 'var(--text-muted)' }}>Hôte</span>
                  <code style={{ overflowWrap: 'anywhere' }}>{record.host}</code>
                  <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={() => copy(record.host)}>Copier</button>
                  <span style={{ color: 'var(--text-muted)' }}>Valeur</span>
                  <code style={{ overflowWrap: 'anywhere' }}>{record.value}</code>
                  <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={() => copy(record.value)}>Copier</button>
                </div>
                {pointingHint && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>2. {pointingHint}</div>
                )}
                <div>
                  <button className="btn btn-primary" onClick={handleVerify} disabled={domainBusy}>
                    {domainBusy ? 'Vérification…' : 'Vérifier & activer'}
                  </button>
                </div>
              </div>
            )}

            {!record && domainStatus === 'pending' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--amber-400)' }}>
                  Vérification en attente pour <strong>{site.customDomain || customInput}</strong>.
                </span>
                <button className="btn btn-primary" onClick={handleVerify} disabled={domainBusy}>
                  {domainBusy ? 'Vérification…' : 'Vérifier & activer'}
                </button>
                <button className="btn btn-secondary" style={{ color: 'var(--accent-rose)' }} onClick={() => setConfirmDetach(true)} disabled={domainBusy}>
                  Annuler
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {confirmDetach && (
        <ConfirmDialog
          title="Détacher le domaine personnalisé ?"
          message="Le site repassera sur son sous-domaine généré. Le domaine additionnel sera retiré de l’hébergement."
          confirmLabel="Détacher"
          cancelLabel="Annuler"
          danger
          loading={domainBusy}
          onConfirm={handleDetach}
          onCancel={() => setConfirmDetach(false)}
        />
      )}
    </Modal>
  );
}
