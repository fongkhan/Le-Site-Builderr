import { useState } from 'react';
import { createClient } from '../../api/users';
import { errorMessage } from '../../api/client';
import { FieldError } from '../../components/ui/FieldError';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/ToastContext';
import { firstInvalid, focusField, invalidProps, validateClientAccount, type FieldErrors } from '../../lib/formValidation';
import type { Site } from '../../types';

type Field = 'email' | 'password' | 'quota';
const FIELD_IDS: Record<Field, string> = { email: 'cc-email', password: 'cc-password', quota: 'cc-quota' };
const errorId = (field: Field) => `${FIELD_IDS[field]}-erreur`;

// Création d'un compte client depuis le panel admin (POST REST Payload /api/users).
export function CreateClientModal({ sites, onClose, onCreated }: { sites: Site[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [siteSlugs, setSiteSlugs] = useState<string[]>([]);
  const [quotaEnabled, setQuotaEnabled] = useState(false);
  const [quota, setQuota] = useState('10');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});

  const clearError = (field: Field) => setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const toggleSite = (slug: string) => {
    setSiteSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  const handleCreate = async () => {
    if (saving) return;
    const found = validateClientAccount({ email, password, quotaEnabled, quota });
    setErrors(found);
    const first = firstInvalid<Field>(['email', 'password', 'quota'], found);
    if (first) {
      focusField(FIELD_IDS[first]);
      return;
    }
    const aiDailyQuota = quotaEnabled ? Number(quota.trim()) : null;
    setSaving(true);
    try {
      await createClient({ email: email.trim(), password, siteSlugs, aiDailyQuota });
      toast.success(`Compte client « ${email.trim()} » créé.`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Échec de la création du compte.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="👤 Créer un compte client"
      subtitle="Le client accèdera uniquement aux sites sélectionnés et à l'onboarding."
      onClose={onClose}
      onSubmit={handleCreate}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Création…' : 'Créer le compte'}
          </button>
        </>
      }
    >
      <div>
        <label className="field-label" htmlFor={FIELD_IDS.email}>Email *</label>
        <input
          id={FIELD_IDS.email}
          type="email"
          className="input-text"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
          placeholder="client@exemple.com"
          {...invalidProps(errorId('email'), errors.email)}
        />
        <FieldError id={errorId('email')} message={errors.email} />
      </div>
      <div>
        <label className="field-label" htmlFor={FIELD_IDS.password}>Mot de passe * (12 caractères min.)</label>
        <input
          id={FIELD_IDS.password}
          type="password"
          className="input-text"
          required
          minLength={12}
          value={password}
          onChange={(e) => { setPassword(e.target.value); clearError('password'); }}
          autoComplete="new-password"
          {...invalidProps(errorId('password'), errors.password)}
        />
        <FieldError id={errorId('password')} message={errors.password} />
      </div>
      <fieldset className="field-group">
        <legend className="field-label">Sites accessibles</legend>
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
      </fieldset>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={quotaEnabled}
            onChange={(e) => { setQuotaEnabled(e.target.checked); clearError('quota'); }}
          />
          <span>Quota IA journalier personnalisé</span>
        </label>
        {/* Toujours affiché (désactivé tant que la case n'est pas cochée) : le libellé reste visible */}
        <label className="field-label" htmlFor={FIELD_IDS.quota} style={{ marginTop: 6 }}>Générations IA par jour (0 = bloqué)</label>
        <input
          id={FIELD_IDS.quota}
          type="number"
          min={0}
          step={1}
          className="input-text"
          disabled={!quotaEnabled}
          value={quota}
          onChange={(e) => { setQuota(e.target.value); clearError('quota'); }}
          {...invalidProps(errorId('quota'), errors.quota)}
        />
        <FieldError id={errorId('quota')} message={errors.quota} />
      </div>
    </Modal>
  );
}
