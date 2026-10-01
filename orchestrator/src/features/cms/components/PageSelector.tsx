import { pageLocale, type EditorPage } from '../lib/editorModel';

const FLAGS: Record<string, string> = { fr: '🇫🇷', en: '🇬🇧' };

// Choix de la page éditée + création d'une page.
export function PageSelector({ pages, selectedId, onSelect, onNewPage }: {
  pages: EditorPage[];
  selectedId: string | undefined;
  onSelect: (pageId: string) => void;
  onNewPage: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {pages.length > 1 && (
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="field-label" htmlFor="page-select">Page à éditer</label>
          <select id="page-select" className="select-dark" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
            {pages.map((p, i) => (
              <option key={p.id} value={p.id}>
                {FLAGS[pageLocale(p)] ?? '🌐'} {p.title || p.slug || `Page ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="button" className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={onNewPage}>
        + Nouvelle page
      </button>
    </div>
  );
}
