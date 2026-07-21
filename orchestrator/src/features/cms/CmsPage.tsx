import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { fetchPages, fetchTheme, savePages } from '../../api/sites';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { BlockEditor } from './BlockEditor';
import { PagePreview } from './PagePreview';
import { BLOCK_DEFAULTS, BLOCK_LABELS } from './blockDefaults';
import { DEFAULT_THEME } from '../../types';
import type { Block, PagesData, Site, Theme } from '../../types';

const AUTOSAVE_DELAY_MS = 500;

export function CmsPage() {
  const { site } = useOutletContext<{ site: Site }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [pagesData, setPagesData] = useState<PagesData>({ docs: [] });
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [blockToRemove, setBlockToRemove] = useState<number | null>(null);
  const [creatingPage, setCreatingPage] = useState(false);

  // Autosave débouncé : le timer diffère la sauvegarde ; les refs évitent les tirs concurrents
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingData = useRef<PagesData | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedPageIdx(0); // repartir sur la première page au changement de site
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

  // Envoie la dernière version en attente ; re-planifie si une nouvelle édition survient
  // pendant la requête (anti-concurrence : jamais deux POST en vol pour le même site).
  const flush = async () => {
    if (savingRef.current || pendingData.current === null) return;
    const data = pendingData.current;
    pendingData.current = null;
    savingRef.current = true;
    setSaving(true);
    try {
      await savePages(site.slug, data);
      if (pendingData.current === null) setDirty(false);
    } catch (err) {
      pendingData.current = data; // conserver pour un prochain essai
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'enregistrement des pages.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingData.current !== null) flush(); // une édition est arrivée pendant la sauvegarde
    }
  };

  const scheduleSave = (updated: PagesData) => {
    pendingData.current = updated;
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  // Sauvegarde immédiate (réordonnancement, ajout/suppression de bloc) — pas de débounce
  const saveNow = (updated: PagesData) => {
    pendingData.current = updated;
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flush();
  };

  // Flush le timer en attente au démontage (changement de site/route)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingData.current !== null) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.slug]);

  // Toutes les mutations passent par un clone profond : jamais de mutation en place du state
  const mutateLayout = (mutate: (layout: Block[]) => void, immediate = false) => {
    const updated = structuredClone(pagesData);
    mutate(updated.docs[selectedPageIdx].layout);
    setPagesData(updated);
    if (immediate) saveNow(updated);
    else scheduleSave(updated);
  };

  const handleBlockChange = (blockIdx: number, field: string, value: unknown) => {
    mutateLayout((layout) => {
      (layout[blockIdx] as unknown as Record<string, unknown>)[field] = value;
    });
  };

  const handleBlockNestedChange = (blockIdx: number, nestedField: string, index: number, field: string, value: unknown) => {
    mutateLayout((layout) => {
      const block = layout[blockIdx] as unknown as Record<string, Record<number, Record<string, unknown>>>;
      block[nestedField][index][field] = value;
    });
  };

  // Remplace un tableau entier d'un bloc (ajout/suppression d'item, édition de galerie).
  // immediate=true pour les changements structurels (ajout/suppression), débouncé sinon.
  const handleBlockArrayChange = (blockIdx: number, field: string, value: unknown[], immediate = false) => {
    mutateLayout((layout) => {
      (layout[blockIdx] as unknown as Record<string, unknown>)[field] = value;
    }, immediate);
  };

  const addBlock = (type: string) => {
    const newBlock = structuredClone(BLOCK_DEFAULTS[type] ?? { blockType: type });
    mutateLayout((layout) => layout.push(newBlock), true);
    toast.success(`Bloc « ${BLOCK_LABELS[type] ?? type} » ajouté.`);
  };

  // Suppression confirmée via ConfirmDialog (évite la perte accidentelle d'une section)
  const confirmRemoveBlock = () => {
    if (blockToRemove === null) return;
    const idx = blockToRemove;
    mutateLayout((layout) => layout.splice(idx, 1), true);
    if (editingBlockIdx === idx) setEditingBlockIdx(null);
    setBlockToRemove(null);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    mutateLayout((layout) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= layout.length) return;
      [layout[index], layout[target]] = [layout[target], layout[index]];
    }, true);
  };

  // Édite un champ de la page courante (SEO : metaTitle/metaDescription) — débouncé
  const mutatePageField = (field: 'metaTitle' | 'metaDescription', value: string) => {
    const updated = structuredClone(pagesData);
    updated.docs[selectedPageIdx][field] = value;
    setPagesData(updated);
    scheduleSave(updated);
  };

  // Crée une page (slug dérivé du titre, dédupliqué) et la sélectionne
  const createPage = (title: string) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'page';
    let slug = base;
    let suffix = 2;
    while (pagesData.docs.some((d) => d.slug === slug)) {
      slug = `${base}-${suffix++}`;
    }
    const updated = structuredClone(pagesData);
    updated.docs.push({
      title,
      slug,
      layout: [structuredClone(BLOCK_DEFAULTS.hero)],
    });
    setPagesData(updated);
    saveNow(updated);
    setSelectedPageIdx(updated.docs.length - 1);
    setEditingBlockIdx(null);
    toast.success(`Page « ${title} » créée (adresse : /${slug}/).`);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement du contenu…" />
      </div>
    );
  }

  return (
    <div className="animate-slide cms-grid">
      <UnsavedChangesPrompt when={dirty || saving} />
      {blockToRemove !== null && (
        <ConfirmDialog
          title="Supprimer cette section ?"
          message={`La section « ${activePage?.layout[blockToRemove]?.blockType ?? ''} » sera retirée de la page. Cette action est immédiate.`}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          danger
          onConfirm={confirmRemoveBlock}
          onCancel={() => setBlockToRemove(null)}
        />
      )}
      {creatingPage && (
        <NewPageModal
          onCancel={() => setCreatingPage(false)}
          onCreate={(title) => {
            createPage(title);
            setCreatingPage(false);
          }}
        />
      )}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.4rem' }}>
          🗃️ Sections de la page
          {saving ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginLeft: 10 }}>💾 Enregistrement…</span>
          ) : dirty ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--amber-400)', marginLeft: 10 }}>● Modifications en attente</span>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)', marginLeft: 10 }}>✓ Enregistré</span>
          )}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Modifiez l'ordre et le contenu des sections. Vos changements sont enregistrés automatiquement.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {pagesData.docs.length > 1 && (
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="field-label" htmlFor="page-select">Page à éditer</label>
              <select
                id="page-select"
                className="select-dark"
                value={selectedPageIdx}
                onChange={(e) => { setSelectedPageIdx(Number(e.target.value)); setEditingBlockIdx(null); }}
              >
                {pagesData.docs.map((p, i) => (
                  <option key={p.slug || i} value={i}>{p.title || p.slug || `Page ${i + 1}`}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={() => setCreatingPage(true)}>
            + Nouvelle page
          </button>
        </div>

        {activePage && (
          <details style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              🔎 Référencement (SEO) — {activePage.title}
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <div>
                <label className="field-label" htmlFor="seo-title">Titre de l'onglet (balise title)</label>
                <input
                  id="seo-title"
                  type="text"
                  className="input-text"
                  style={{ padding: 6, fontSize: '0.875rem' }}
                  placeholder={activePage.title}
                  value={activePage.metaTitle || ''}
                  onChange={(e) => mutatePageField('metaTitle', e.target.value)}
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
                  value={activePage.metaDescription || ''}
                  onChange={(e) => mutatePageField('metaDescription', e.target.value)}
                />
              </div>
            </div>
          </details>
        )}

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
                    <button onClick={() => setBlockToRemove(idx)} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer' }} aria-label="Supprimer">✕</button>
                  </div>
                </div>

                {editingBlockIdx === idx ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                    <BlockEditor
                      block={block}
                      onChange={(field, value) => handleBlockChange(idx, field, value)}
                      onNestedChange={(nestedField, index, field, value) => handleBlockNestedChange(idx, nestedField, index, field, value)}
                      onArrayChange={(field, value, immediate) => handleBlockArrayChange(idx, field, value, immediate)}
                    />
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.875rem', marginTop: 5 }} onClick={() => setEditingBlockIdx(null)}>
                      Fermer
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

// Saisie du titre d'une nouvelle page (le slug/l'adresse est dérivé automatiquement)
function NewPageModal({ onCancel, onCreate }: { onCancel: () => void; onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('');
  const valid = title.trim().length >= 2;

  return (
    <Modal
      title="📄 Nouvelle page"
      subtitle="Elle apparaîtra dans le menu de navigation du site après le prochain déploiement."
      onClose={onCancel}
      maxWidth={440}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>Annuler</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => valid && onCreate(title.trim())}>
            Créer la page
          </button>
        </>
      }
    >
      <div>
        <label className="field-label" htmlFor="new-page-title">Titre de la page *</label>
        <input
          id="new-page-title"
          type="text"
          className="input-text"
          placeholder="ex : Contact, À propos, Nos horaires…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) onCreate(title.trim()); }}
        />
      </div>
    </Modal>
  );
}
