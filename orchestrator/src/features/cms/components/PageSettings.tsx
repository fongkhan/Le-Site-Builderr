import { useId, useState } from 'react';
import { pageLocale, type EditorPage } from '../lib/editorModel';
import { pageAddress } from '../lib/pageSlug';
import '../cms-editor.css';

const LANGUAGES: Record<string, string> = { fr: 'Français', en: 'English' };

// Titre (renommage), place dans le menu, adresse et suppression de la page courante.
// À monter avec key={page.id} : le brouillon du titre repart de la page affichée.
export function PageSettings({ page, deleteBlocker, onRename, onDelete, canMoveUp, canMoveDown, onMove, onToggleNav }: {
  page: EditorPage;
  /** Raison d'interdire la suppression (page d'accueil…), ou null */
  deleteBlocker: string | null;
  onRename: (title: string) => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Monte (-1) ou descend (+1) la page dans le menu de sa langue */
  onMove: (delta: -1 | 1) => void;
  onToggleNav: (visible: boolean) => void;
}) {
  const id = useId();
  // Brouillon local : un titre vide n'est jamais envoyé (le serveur le refuserait)
  const [draft, setDraft] = useState(page.title);
  // Titre changé hors du champ (annuler/rétablir) : le brouillon suit
  const [shownTitle, setShownTitle] = useState(page.title);
  if (shownTitle !== page.title) {
    setShownTitle(page.title);
    setDraft(page.title);
  }
  const empty = !draft.trim();
  const locale = pageLocale(page);

  return (
    <details style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
        📄 Page — {page.title || page.slug} <span style={{ fontWeight: 400 }}>({pageAddress(page.slug, locale)})</span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <div>
          <label className="field-label" htmlFor={id}>Titre de la page (menu de navigation)</label>
          <input
            id={id}
            type="text"
            className="input-text"
            style={{ padding: 6, fontSize: '0.875rem', borderColor: empty ? 'var(--accent-rose)' : undefined }}
            value={draft}
            maxLength={120}
            aria-invalid={empty}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) onRename(e.target.value);
            }}
            onBlur={() => { if (empty) setDraft(page.title); }}
          />
          {empty && (
            <span className="field-label" style={{ color: 'var(--accent-rose)', marginTop: 4 }}>
              Le titre ne peut pas être vide : « {page.title} » est conservé.
            </span>
          )}
        </div>
        <div className="cms-page-order" role="group" aria-label="Place dans le menu de navigation">
          <button type="button" className="btn btn-secondary" onClick={() => onMove(-1)} disabled={!canMoveUp} title="Placer cette page plus tôt dans le menu">
            ↑ Monter dans le menu
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onMove(1)} disabled={!canMoveDown} title="Placer cette page plus loin dans le menu">
            ↓ Descendre
          </button>
          <label>
            <input type="checkbox" checked={!page.hideFromNav} onChange={(e) => onToggleNav(e.target.checked)} />
            Afficher dans le menu
          </label>
        </div>
        {page.hideFromNav && (
          <span className="field-label" style={{ margin: 0 }}>
            Page masquée du menu : elle reste publiée et accessible par son adresse (et dans le plan du site).
          </span>
        )}
        <span className="field-label" style={{ margin: 0 }}>
          Adresse : <code>{pageAddress(page.slug, locale)}</code> · Langue : {LANGUAGES[locale] ?? locale}
          {' '}(l'adresse ne change pas quand on renomme la page)
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '6px 12px', fontSize: '0.85rem', alignSelf: 'flex-start', color: deleteBlocker ? undefined : 'var(--red-300)' }}
          onClick={onDelete}
          disabled={deleteBlocker !== null}
          title={deleteBlocker ?? 'Supprimer définitivement cette page'}
        >
          🗑️ Supprimer la page
        </button>
        {deleteBlocker && <span className="field-label" style={{ margin: 0 }}>{deleteBlocker}</span>}
      </div>
    </details>
  );
}
