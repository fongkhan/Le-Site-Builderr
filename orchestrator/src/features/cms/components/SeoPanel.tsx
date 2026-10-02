import type { EditorPage } from '../lib/editorModel';

export type SeoField = 'metaTitle' | 'metaDescription';

// Référencement de la page courante : balise title, description, génération par l'IA.
export function SeoPanel({ page, onChange, onGenerate, generating, aiDisabledReason }: {
  page: EditorPage;
  onChange: (field: SeoField, value: string) => void;
  onGenerate: () => void;
  generating: boolean;
  aiDisabledReason: string | null;
}) {
  return (
    <details style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
        🔎 Référencement (SEO) — {page.title}
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <div>
          <label className="field-label" htmlFor="seo-title">Titre de l'onglet (balise title)</label>
          <input
            id="seo-title"
            type="text"
            className="input-text"
            style={{ padding: 6, fontSize: '0.875rem' }}
            placeholder={page.title}
            value={page.metaTitle || ''}
            onChange={(e) => onChange('metaTitle', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="seo-desc">Description (moteurs de recherche)</label>
          <textarea
            id="seo-desc"
            className="input-text"
            style={{ padding: 6, fontSize: '0.875rem' }}
            rows={2}
            placeholder="Décrivez cette page en une ou deux phrases…"
            value={page.metaDescription || ''}
            onChange={(e) => onChange('metaDescription', e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '6px 12px', fontSize: '0.85rem', alignSelf: 'flex-start' }}
          onClick={onGenerate}
          disabled={generating || aiDisabledReason !== null}
          title={aiDisabledReason ?? undefined}
        >
          {generating ? '✨ Génération…' : '✨ Générer les meta SEO'}
        </button>
      </div>
    </details>
  );
}
