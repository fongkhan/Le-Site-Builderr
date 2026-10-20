import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTheme } from '../../api/content';
import { errorMessage } from '../../api/client';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { UnsavedChangesPrompt } from '../../components/ui/UnsavedChangesPrompt';
import { DEFAULT_THEME } from '../../types';
import type { Site, Theme } from '../../types';
import { PagePreview } from './PagePreview';
import { blockLabel, createBlock, type BlockType } from './blocks/definitions';
import { useSitePages } from './hooks/useSitePages';
import { useAiAssist } from './hooks/useAiAssist';
import type { AutosaveState } from './hooks/autosaveController';
import {
  DEFAULT_LOCALE,
  HOME_SLUG,
  canMovePage,
  duplicateBlock,
  findBlock,
  insertBlock,
  insertBlockAt,
  isDefaultHome,
  moveBlock,
  movePage,
  newClientId,
  pageDeletionBlocker,
  removeBlock,
  removePage,
  reorderBlock,
  updatePage,
  type EditorPage,
} from './lib/editorModel';
import { derivePageSlug, pageAddress } from './lib/pageSlug';
import { hasNativeUndo } from './lib/shortcuts';
import { PageSelector } from './components/PageSelector';
import { PageSettings } from './components/PageSettings';
import { SeoPanel, type SeoField } from './components/SeoPanel';
import { BlockList } from './components/BlockList';
import { AddBlockPalette } from './components/AddBlockPalette';
import { SaveIndicator } from './components/SaveIndicator';
import { NewPageModal } from './components/NewPageModal';
import './cms-editor.css';

export function CmsPage() {
  const site = useCurrentSite();
  // Une instance par site : état et sauvegarde automatique propres au site (le dernier
  // envoi au démontage part vers le site quitté, jamais vers le suivant).
  return <CmsEditor key={site.slug} site={site} />;
}

// Message de l'avertissement de sortie : les modifications sont enregistrées
// automatiquement, on ne bloque que si un envoi est en attente ou a échoué.
function leaveMessage(state: AutosaveState): string {
  if (state.status === 'error') {
    return `Vos dernières modifications ont été refusées par le serveur (${state.error ?? 'erreur'}). Si vous quittez maintenant, elles seront perdues.`;
  }
  if (state.status === 'retrying') {
    return `Le dernier enregistrement a échoué (${state.error ?? 'erreur'}). Un dernier essai sera tenté en quittant la page, mais vos modifications risquent d'être perdues.`;
  }
  return "Vos dernières modifications sont en cours d'enregistrement automatique. Patientez un instant : si vous quittez maintenant, l'envoi se terminera en arrière-plan, sans nouvel essai en cas d'échec.";
}

// Raccourci clavier ignoré : saisie de texte en cours (le champ garde son propre annuler)
// ou fenêtre modale ouverte. Une case à cocher n'a pas d'annuler : l'éditeur s'en charge.
function shortcutBlocked(target: EventTarget | null): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  if (!(target instanceof HTMLElement)) return false;
  return hasNativeUndo({
    tagName: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    isContentEditable: target.isContentEditable,
  });
}

const HISTORY_HINT = 'Historique de cette session : il est perdu au rechargement de la page.';

function CmsEditor({ site }: { site: Site }) {
  const navigate = useNavigate();
  const toast = useToast();
  const ai = useAiAssist(site.slug);

  const { load, reload, pages, latest, commit, updateBlockById, undo, redo, canUndo, canRedo, saveState, retrySave } = useSitePages(site.slug);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [themeUnavailable, setThemeUnavailable] = useState(false);
  const [themeAttempt, setThemeAttempt] = useState(0);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockToRemove, setBlockToRemove] = useState<string | null>(null);
  const [pageToDelete, setPageToDelete] = useState<string | null>(null);
  const [creatingPage, setCreatingPage] = useState(false);
  const [seoPageId, setSeoPageId] = useState<string | null>(null);

  // Ctrl/Cmd+Z : annuler ; Maj+Ctrl/Cmd+Z : rétablir
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (shortcutBlocked(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Le thème ne sert qu'à l'aperçu : son échec n'empêche pas l'édition
  useEffect(() => {
    let cancelled = false;
    fetchTheme(site.slug)
      .then((res) => {
        if (cancelled) return;
        if (res?.theme?.colors && res.theme.fonts) setTheme(res.theme);
        setThemeUnavailable(false);
      })
      .catch(() => {
        if (!cancelled) setThemeUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [site.slug, themeAttempt]);

  const retryLoad = () => {
    reload();
    setThemeAttempt((n) => n + 1);
  };

  if (load.status === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner label="Chargement du contenu…" />
      </div>
    );
  }

  // Échec de chargement : l'éditeur reste fermé (sinon un enregistrement écraserait le
  // vrai contenu du site par une liste vide).
  if (load.status === 'error') {
    return (
      <div className="glass-panel" style={{ maxWidth: 560, margin: '40px auto' }}>
        <EmptyState
          icon="⚠️"
          title="Impossible de charger le contenu du site"
          description={`${load.message} Rien n'a été modifié : l'éditeur s'ouvrira une fois le contenu chargé.`}
          action={<button type="button" className="btn btn-primary" onClick={retryLoad}>Réessayer</button>}
        />
      </div>
    );
  }

  const activePage = pages.find((p) => p.id === selectedPageId) ?? pages[0];

  const selectPage = (pageId: string | null) => {
    setSelectedPageId(pageId);
    setEditingBlockId(null);
  };

  const addBlock = (type: BlockType) => {
    if (!activePage) return;
    const block = createBlock(type);
    commit((prev) => insertBlock(prev, activePage.id, block), true);
    setEditingBlockId(block.id);
    toast.success(`Bloc « ${blockLabel(type)} » ajouté.`);
  };

  // Suppression annulable depuis le toast : la section revient à sa place (si sa page
  // existe encore), quelles que soient les modifications faites entre-temps.
  const confirmRemoveBlock = () => {
    if (blockToRemove === null) return;
    const id = blockToRemove;
    const found = findBlock(latest(), id);
    commit((prev) => removeBlock(prev, id), true);
    if (editingBlockId === id) setEditingBlockId(null);
    setBlockToRemove(null);
    if (!found) return;
    const { page, block, index } = found;
    toast.success('Section supprimée.', {
      action: { label: 'Annuler', onClick: () => commit((prev) => insertBlockAt(prev, page.id, block, index), true) },
    });
  };

  const duplicateSection = (blockId: string) => {
    commit((prev) => duplicateBlock(prev, blockId), true);
    const found = findBlock(latest(), blockId);
    const copy = found?.page.layout[found.index + 1];
    if (copy) setEditingBlockId(copy.id);
    toast.success('Section dupliquée : la copie suit l’originale.');
  };

  const updatePageField = (pageId: string, field: SeoField | 'title', value: string) => {
    commit((prev) => updatePage(prev, pageId, (draft) => {
      draft[field] = value;
    }));
  };

  // Meta SEO générées par l'IA, appliquées à la page d'origine dans sa DERNIÈRE version
  // (les éditions faites pendant la génération sont conservées).
  const generateSeo = async (pageId: string) => {
    const page = latest().find((p) => p.id === pageId);
    if (!page) return;
    const content = page.layout
      .map((b) => [b.title, b.subtitle, b.text].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n')
      .slice(0, 3000);
    setSeoPageId(pageId);
    try {
      const { metaTitle, metaDescription } = await ai.run('seo', content || page.title, site.name);
      if (!metaTitle && !metaDescription) {
        toast.info("L'IA n'a rien proposé pour cette page.");
        return;
      }
      commit((prev) => updatePage(prev, pageId, (draft) => {
        if (metaTitle) draft.metaTitle = metaTitle;
        if (metaDescription) draft.metaDescription = metaDescription;
      }));
      toast.success('Meta SEO générées par l’IA.');
    } catch (err) {
      toast.error(errorMessage(err, "L'assistant IA n'a pas pu répondre."));
    } finally {
      setSeoPageId(null);
    }
  };

  const addPage = (page: EditorPage) => {
    commit((prev) => [...prev, page], true);
    selectPage(page.id);
    toast.success(`Page « ${page.title} » créée (adresse : ${pageAddress(page.slug, page.locale)}).`);
  };

  // Slug dérivé du titre, dédupliqué dans sa langue ; adresses réservées refusées.
  const createPage = (title: string, locale: string) => {
    const { slug, error } = derivePageSlug(title, locale, latest());
    if (error) {
      toast.error(error);
      return;
    }
    setCreatingPage(false);
    addPage({ id: newClientId(), title, slug, locale, layout: [createBlock('hero')] });
  };

  const createHomePage = () => {
    addPage({ id: newClientId(), title: 'Accueil', slug: HOME_SLUG, locale: DEFAULT_LOCALE, layout: [createBlock('hero')] });
  };

  // Suppression : la page est retirée de la liste envoyée, le serveur la supprime en base.
  const confirmDeletePage = () => {
    const page = latest().find((p) => p.id === pageToDelete);
    setPageToDelete(null);
    if (!page) return;
    const blocker = pageDeletionBlocker(page, latest());
    if (blocker) {
      toast.error(blocker);
      return;
    }
    commit((prev) => removePage(prev, page.id), true);
    const remaining = latest();
    selectPage((remaining.find(isDefaultHome) ?? remaining[0])?.id ?? null);
    toast.success(`Page « ${page.title} » supprimée.`);
  };

  const removingBlock = blockToRemove ? findBlock(pages, blockToRemove)?.block : undefined;
  const deletingPage = pageToDelete ? pages.find((p) => p.id === pageToDelete) : undefined;
  const saveFailed = saveState.status === 'error' || saveState.status === 'retrying';

  return (
    <div className="animate-slide cms-grid">
      <UnsavedChangesPrompt when={saveState.status !== 'idle'} message={leaveMessage(saveState)} confirmLabel="Quitter quand même" />
      {removingBlock && (
        <ConfirmDialog
          title="Supprimer cette section ?"
          message={`La section « ${blockLabel(removingBlock.blockType)} » sera retirée de la page. Cette action est immédiate.`}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          danger
          onConfirm={confirmRemoveBlock}
          onCancel={() => setBlockToRemove(null)}
        />
      )}
      {deletingPage && (
        <ConfirmDialog
          title="Supprimer cette page ?"
          message={`La page « ${deletingPage.title} » (${pageAddress(deletingPage.slug, deletingPage.locale)}) et toutes ses sections seront définitivement supprimées du site. Elle disparaîtra du menu au prochain déploiement.`}
          confirmLabel="Supprimer la page"
          cancelLabel="Annuler"
          danger
          onConfirm={confirmDeletePage}
          onCancel={() => setPageToDelete(null)}
        />
      )}
      {creatingPage && <NewPageModal pages={pages} onCancel={() => setCreatingPage(false)} onCreate={createPage} />}

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.4rem' }}>🗃️ Sections de la page</h2>
            <div className="cms-history">
              <button type="button" className="btn btn-secondary" onClick={undo} disabled={!canUndo} title={`Annuler (Ctrl+Z). ${HISTORY_HINT}`}>
                ↶ Annuler
              </button>
              <button type="button" className="btn btn-secondary" onClick={redo} disabled={!canRedo} title={`Rétablir (Maj+Ctrl+Z). ${HISTORY_HINT}`}>
                ↷ Rétablir
              </button>
              {!saveFailed && <SaveIndicator state={saveState} onRetry={retrySave} />}
            </div>
          </div>
          {saveFailed && <SaveIndicator state={saveState} onRetry={retrySave} />}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Modifiez l'ordre et le contenu des sections. Vos changements sont enregistrés automatiquement.
        </p>

        <PageSelector pages={pages} selectedId={activePage?.id} onSelect={selectPage} onNewPage={() => setCreatingPage(true)} />

        {activePage && (
          <>
            <PageSettings
              key={activePage.id}
              page={activePage}
              deleteBlocker={pageDeletionBlocker(activePage, pages)}
              onRename={(title) => updatePageField(activePage.id, 'title', title)}
              onDelete={() => setPageToDelete(activePage.id)}
              canMoveUp={canMovePage(pages, activePage.id, -1)}
              canMoveDown={canMovePage(pages, activePage.id, 1)}
              onMove={(delta) => commit((prev) => movePage(prev, activePage.id, delta), true)}
              onToggleNav={(visible) => commit((prev) => updatePage(prev, activePage.id, (draft) => {
                draft.hideFromNav = !visible;
              }), true)}
            />
            <SeoPanel
              page={activePage}
              onChange={(field, value) => updatePageField(activePage.id, field, value)}
              onGenerate={() => generateSeo(activePage.id)}
              generating={seoPageId === activePage.id}
              aiDisabledReason={ai.disabledReason}
            />
          </>
        )}

        {activePage ? (
          activePage.layout.length > 0 ? (
            <BlockList
              blocks={activePage.layout}
              siteSlug={site.slug}
              editingId={editingBlockId}
              onEdit={setEditingBlockId}
              onMove={(id, delta) => commit((prev) => moveBlock(prev, id, delta), true)}
              onReorder={(fromId, toId) => commit((prev) => reorderBlock(prev, fromId, toId), true)}
              onRemove={setBlockToRemove}
              onDuplicate={duplicateSection}
              updateBlock={updateBlockById}
            />
          ) : (
            <EmptyState icon="🧱" title="Page vide" description="Ajoutez une première section avec les boutons ci-dessous." />
          )
        ) : (
          <EmptyState
            icon="📄"
            title="Aucune page"
            description="Ce site n'a encore aucune page : commencez par la page d'accueil."
            action={<button type="button" className="btn btn-primary" onClick={createHomePage}>Créer la page d'accueil</button>}
          />
        )}

        {activePage && <AddBlockPalette onAdd={addBlock} />}

        <button type="button" className="btn btn-primary" style={{ marginTop: 15 }} onClick={() => navigate(`/sites/${site.slug}/deploy`)}>
          Étape suivante : déployer →
        </button>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <h3>🖥️ Aperçu en direct</h3>
          {themeUnavailable ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--amber-400)' }} title="Le thème du site n'a pas pu être chargé.">
              ⚠️ Thème indisponible : aperçu avec le thème par défaut
            </span>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)' }}>● Mis à jour à chaque modification</span>
          )}
        </div>
        {activePage && <PagePreview page={activePage} theme={theme} />}
      </div>
    </div>
  );
}
