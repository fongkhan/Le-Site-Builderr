import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPages, savePages } from '../../../api/content';
import { errorMessage } from '../../../api/client';
import { useToast } from '../../../components/ui/ToastContext';
import type { Block, PageRef } from '../../../types';
import type { UpdateOptions } from '../blocks/types';
import { editGroupKey, pageKey, removedPages, toEditorPages, toServerPages, updateBlock, type EditorPage } from '../lib/editorModel';
import { createHistory } from '../lib/history';
import type { AutosaveState } from './autosaveController';
import { useAutosave } from './useAutosave';

export type PagesLoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export interface SitePages {
  load: PagesLoadState;
  /** Relance le chargement après un échec */
  reload: () => void;
  pages: EditorPage[];
  /** Dernière version des pages (à lire après une attente asynchrone) */
  latest: () => EditorPage[];
  /**
   * Applique une modification à la DERNIÈRE version des pages puis l'enregistre :
   * immédiatement pour un changement de structure, après débounce sinon.
   */
  commit: (change: (prev: EditorPage[]) => EditorPage[], immediate?: boolean) => void;
  updateBlockById: (blockId: string, recipe: (draft: Block) => void, options?: UpdateOptions) => void;
  /** Annule / rétablit la dernière modification (historique de la session, perdu au rechargement) */
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveState: AutosaveState;
  retrySave: () => void;
}

// Pages d'un site dans l'éditeur : chargement, version courante et sauvegarde automatique.
// Toutes les modifications partent de la dernière version (ref), jamais d'une copie
// capturée avant une attente asynchrone (IA, téléversement…) : aucune édition écrasée.
// Le site ne doit pas changer pendant la vie du composant (le monter avec key={slug}).
export function useSitePages(siteSlug: string): SitePages {
  const toast = useToast();
  const [load, setLoad] = useState<PagesLoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const pagesRef = useRef<EditorPage[]>([]);
  // Pages supprimées pas encore confirmées par le serveur : renvoyées à chaque sauvegarde
  // jusqu'à son succès (une sauvegarde plus récente remplace la précédente en attente).
  const pendingDeletes = useRef(new Map<string, PageRef>());
  // Historique annuler/rétablir : instantanés immuables des pages (session seulement)
  const [history] = useState(() => createHistory<EditorPage[]>());
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
  const syncHistoryFlags = useCallback(() => {
    const flags = { canUndo: history.canUndo(), canRedo: history.canRedo() };
    setHistoryFlags((prev) => (prev.canUndo === flags.canUndo && prev.canRedo === flags.canRedo ? prev : flags));
  }, [history]);

  const { state: saveState, schedule, saveNow, retry } = useAutosave<EditorPage[]>(
    async (data) => {
      const sent = [...pendingDeletes.current.entries()];
      const result = await savePages(siteSlug, toServerPages(data, sent.map(([, ref]) => ref)));
      for (const [key, ref] of sent) {
        if (pendingDeletes.current.get(key) === ref) pendingDeletes.current.delete(key);
      }
      return result;
    },
    {
      onError: (err, info) => {
        const message = errorMessage(err, "Erreur lors de l'enregistrement des pages.");
        if (info.permanent) toast.error(`Enregistrement refusé : ${message}`);
        else if (info.retryInMs === null) toast.error(`Vos dernières modifications n'ont pas pu être enregistrées : ${message}`);
        else if (info.failures === 1) toast.error(`${message} — nouvel essai automatique…`);
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetchPages(siteSlug)
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.docs)) throw new Error('Réponse inattendue du serveur.');
        const loaded = toEditorPages(data);
        history.clear();
        setHistoryFlags({ canUndo: false, canRedo: false });
        pagesRef.current = loaded;
        setPages(loaded);
        setLoad({ status: 'ready' });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: 'error', message: errorMessage(err, 'Impossible de charger le contenu du site.') });
      });
    return () => {
      cancelled = true;
    };
  }, [siteSlug, loadAttempt, history]);

  // Remplace les pages par `next` et l'enregistre. Les pages disparues sont à supprimer
  // en base ; une page présente (réapparue après une annulation) n'est plus à supprimer :
  // elle est renvoyée dans docs et recréée par (langue, adresse), sans identifiant serveur.
  const apply = useCallback(
    (prev: EditorPage[], next: EditorPage[], immediate: boolean) => {
      for (const ref of removedPages(prev, next)) pendingDeletes.current.set(pageKey(ref), ref);
      for (const page of next) pendingDeletes.current.delete(pageKey(page));
      pagesRef.current = next;
      setPages(next);
      if (immediate) saveNow(next);
      else schedule(next);
    },
    [saveNow, schedule],
  );

  // Éditeur démonté (autre page de l'application) : la sauvegarde automatique est arrêtée.
  // Une modification tardive (« Annuler » d'un toast resté affiché) serait perdue sans
  // bruit : elle est refusée avec un message.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commit = useCallback(
    (change: (prev: EditorPage[]) => EditorPage[], immediate = false) => {
      const prev = pagesRef.current;
      const next = change(prev);
      if (next === prev) return;
      if (!mounted.current) {
        toast.error("L'éditeur de contenu a été fermé : cette modification n'a pas été appliquée. Rouvrez-le pour la refaire.");
        return;
      }
      // Frappe (débouncée) regroupée par champ ; un changement de structure est une étape
      history.push(prev, immediate ? undefined : editGroupKey(prev, next));
      syncHistoryFlags();
      apply(prev, next, immediate);
    },
    [apply, history, syncHistoryFlags, toast],
  );

  const travel = useCallback(
    (direction: 'undo' | 'redo') => {
      const prev = pagesRef.current;
      const target = direction === 'undo' ? history.undo(prev) : history.redo(prev);
      syncHistoryFlags();
      if (!target) return false;
      apply(prev, target, true);
      return true;
    },
    [apply, history, syncHistoryFlags],
  );
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  const updateBlockById = useCallback(
    (blockId: string, recipe: (draft: Block) => void, options?: UpdateOptions) => {
      commit((prev) => updateBlock(prev, blockId, recipe), options?.immediate);
    },
    [commit],
  );

  const latest = useCallback(() => pagesRef.current, []);
  const reload = useCallback(() => setLoadAttempt((n) => n + 1), []);

  return {
    load, reload, pages, latest, commit, updateBlockById,
    undo, redo, canUndo: historyFlags.canUndo, canRedo: historyFlags.canRedo,
    saveState, retrySave: retry,
  };
}
