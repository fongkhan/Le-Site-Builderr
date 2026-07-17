import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { fetchPages, fetchTheme, savePages } from '../../api/sites';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { BlockEditor } from './BlockEditor';
import { PagePreview } from './PagePreview';
import { BLOCK_DEFAULTS, BLOCK_LABELS } from './blockDefaults';
import { DEFAULT_THEME } from '../../types';
import type { Block, PagesData, Site, Theme } from '../../types';

export function CmsPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [pagesData, setPagesData] = useState<PagesData>({ docs: [] });
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const selectedPageIdx = 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPages(site.slug), fetchTheme(site.slug)])
      .then(([pages, themeRes]) => {
        if (cancelled) return;
        setPagesData(pages);
        if (themeRes.theme) setTheme(themeRes.theme);
      })
      .catch(() => toast.error('Impossible de charger le contenu du site.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.slug]);

  const activePage = pagesData.docs[selectedPageIdx];

  const persist = async (updated: PagesData) => {
    setPagesData(updated);
    setSaving(true);
    try {
      await savePages(site.slug, updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'enregistrement des pages.");
    } finally {
      setSaving(false);
    }
  };

  // Toutes les mutations passent par un clone profond : jamais de mutation en place du state
  const mutateLayout = (mutate: (layout: Block[]) => void, save = true) => {
    const updated = structuredClone(pagesData);
    mutate(updated.docs[selectedPageIdx].layout);
    if (save) {
      persist(updated);
    } else {
      setPagesData(updated);
    }
  };

  const handleBlockChange = (blockIdx: number, field: string, value: unknown) => {
    mutateLayout((layout) => {
      (layout[blockIdx] as unknown as Record<string, unknown>)[field] = value;
    }, false);
  };

  const handleBlockNestedChange = (blockIdx: number, nestedField: string, index: number, field: string, value: unknown) => {
    mutateLayout((layout) => {
      const block = layout[blockIdx] as unknown as Record<string, Record<number, Record<string, unknown>>>;
      block[nestedField][index][field] = value;
    }, false);
  };

  const addBlock = (type: string) => {
    const newBlock = structuredClone(BLOCK_DEFAULTS[type] ?? { blockType: type });
    mutateLayout((layout) => layout.push(newBlock));
    toast.success(`Bloc « ${BLOCK_LABELS[type] ?? type} » ajouté.`);
  };

  const removeBlock = (blockIdx: number) => {
    mutateLayout((layout) => layout.splice(blockIdx, 1));
    if (editingBlockIdx === blockIdx) setEditingBlockIdx(null);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    mutateLayout((layout) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= layout.length) return;
      [layout[index], layout[target]] = [layout[target], layout[index]];
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement du contenu…" />
      </div>
    );
  }

  return (
    <div className="animate-slide" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '30px', alignItems: 'start' }}>
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.4rem' }}>
          🗃️ Sections de la page
          {saving && <span style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginLeft: 10 }}>💾 Enregistrement…</span>}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Modifiez l'ordre et le contenu des sections. Les changements sont enregistrés automatiquement.
        </p>

        {activePage ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activePage.layout.map((block, idx) => (
              <div
                key={idx}
                style={{
                  background: editingBlockIdx === idx ? 'var(--accent-blue-soft)' : 'rgba(255,255,255,0.02)',
                  border: editingBlockIdx === idx ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ textTransform: 'capitalize', fontSize: '0.95rem' }}>
                    {idx + 1}. {block.blockType}
                  </strong>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => moveBlock(idx, 'up')} disabled={idx === 0} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Monter">▲</button>
                    <button onClick={() => moveBlock(idx, 'down')} disabled={idx === activePage.layout.length - 1} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Descendre">▼</button>
                    <button onClick={() => removeBlock(idx)} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer' }} aria-label="Supprimer">✕</button>
                  </div>
                </div>

                {editingBlockIdx === idx ? (
                  <div
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        persist(pagesData);
                        setEditingBlockIdx(null);
                      }
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}
                  >
                    <BlockEditor
                      block={block}
                      onChange={(field, value) => handleBlockChange(idx, field, value)}
                      onNestedChange={(nestedField, index, field, value) => handleBlockNestedChange(idx, nestedField, index, field, value)}
                    />
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.875rem', marginTop: 5 }} onClick={() => { persist(pagesData); setEditingBlockIdx(null); }}>
                      Fermer & sauvegarder
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', padding: '6px 10px', fontSize: '0.8rem', display: 'block', textAlign: 'center', marginTop: 6 }}
                    onClick={() => setEditingBlockIdx(idx)}
                  >
                    Éditer le contenu
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="📄" title="Aucune page" description="Ajoutez un premier bloc pour construire la page d'accueil." />
        )}

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 15, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ajouter un bloc :</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.entries(BLOCK_LABELS).map(([type, label]) => (
              <button key={type} className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock(type)}>
                + {label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" style={{ marginTop: 15 }} onClick={() => navigate(`/sites/${site.slug}/deploy`)}>
          Étape suivante : déployer →
        </button>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
          <h3>🖥️ Aperçu en direct</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)' }}>● Synchronisation active</span>
        </div>
        {activePage && <PagePreview page={activePage} theme={theme} />}
      </div>
    </div>
  );
}
