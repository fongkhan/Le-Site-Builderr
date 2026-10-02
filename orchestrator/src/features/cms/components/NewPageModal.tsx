import { useId, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { DEFAULT_LOCALE, type EditorPage } from '../lib/editorModel';
import { derivePageSlug, pageAddress } from '../lib/pageSlug';

// Saisie du titre d'une nouvelle page : l'adresse est dérivée du titre (affichée en direct),
// dédupliquée dans la langue choisie ; les adresses réservées sont refusées.
export function NewPageModal({ pages, onCancel, onCreate }: {
  pages: readonly EditorPage[];
  onCancel: () => void;
  onCreate: (title: string, locale: string) => void;
}) {
  const titleId = useId();
  const localeId = useId();
  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const trimmed = title.trim();
  const derived = trimmed ? derivePageSlug(trimmed, locale, pages) : null;
  const valid = trimmed.length >= 2 && derived !== null && derived.error === null;
  const submit = () => {
    if (valid) onCreate(trimmed, locale);
  };

  return (
    <Modal
      title="📄 Nouvelle page"
      subtitle="Elle apparaîtra dans le menu de navigation du site après le prochain déploiement."
      onClose={onCancel}
      maxWidth={440}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            Créer la page
          </button>
        </>
      }
    >
      <div>
        <label className="field-label" htmlFor={titleId}>Titre de la page *</label>
        <input
          id={titleId}
          type="text"
          className="input-text"
          placeholder="ex : Contact, À propos, Nos horaires…"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        {derived && (
          <span className="field-label" style={{ marginTop: 6, color: derived.error ? 'var(--accent-rose)' : undefined }} role={derived.error ? 'alert' : undefined}>
            {derived.error ?? <>Adresse : <code>{pageAddress(derived.slug, locale)}</code></>}
          </span>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="field-label" htmlFor={localeId}>Langue</label>
        <select id={localeId} className="select-dark" value={locale} onChange={(e) => setLocale(e.target.value)}>
          <option value="fr">Français (servi à la racine du site)</option>
          <option value="en">English (servi sous /en/)</option>
        </select>
      </div>
    </Modal>
  );
}
