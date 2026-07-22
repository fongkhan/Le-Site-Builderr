import { useState } from 'react';
import { createClient } from '../../api/users';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import type { Site } from '../../types';

// Création d'un compte client depuis le panel admin (POST REST Payload /api/users).
export function CreateClientModal({ sites, onClose, onCreated }: { sites: Site[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [siteSlugs, setSiteSlugs] = useState<string[]>([]);
  const [quotaEnabled, setQuotaEnabled] = useState(false);
  const [quota, setQuota] = useState('10');
  const [saving, setSaving] = useState(false);

  const toggleSite = (slug: string) => {
    setSiteSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  const handleCreate = async () => {
    if (!email.trim() || !/.+@.+\..+/.test(email)) {
      toast.error('Un email valide est requis.');
      return;
    }
    if (password.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    let aiDailyQuota: number | null = null;
    if (quotaEnabled) {
      const n = Number.parseInt(quota, 10);
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Le quota IA doit être un entier positif ou nul.');
        return;
      }
      aiDailyQuota = n;
    }
    setSaving(true);
    try {
      await createClient({ email: email.trim(), password, siteSlugs, aiDailyQuota });
      toast.success(`Compte client « ${email.trim()} » créé.`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la création du compte.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="👤 Créer un compte client"
      subtitle="Le client accèdera uniquement aux sites sélectionnés et à l'onboarding."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? 'Création…' : 'Créer le compte'}
          </button>
        </>
      }
    >
      <div>
        <label className="field-label" htmlFor="cc-email">Email *</label>
        <input id="cc-email" type="email" className="input-text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.com" />
      </div>
      <div>
        <label className="field-label" htmlFor="cc-password">Mot de passe * (8 caractères min.)</label>
        <input id="cc-password" type="password" className="input-text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label className="field-label">Sites accessibles</label>
        {sites.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aucun site disponible. Créez d'abord un site.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6, padding: 8 }}>
            {sites.map((s) => (
              <label key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={siteSlugs.includes(s.slug)} onChange={() => toggleSite(s.slug)} />
                <span>{s.name} <span style={{ color: 'var(--text-muted)' }}>({s.slug})</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={quotaEnabled} onChange={(e) => setQuotaEnabled(e.target.checked)} />
          <span>Quota IA journalier personnalisé</span>
        </label>
        {quotaEnabled && (
          <input type="number" min={0} className="input-text" style={{ marginTop: 6 }} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="ex : 10 (0 = bloqué)" />
        )}
      </div>
    </Modal>
  );
}
