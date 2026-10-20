import { useEffect, useId, useRef, useState } from 'react';
import { deleteMedia, fetchMediaLibrary, updateMediaAlt, type MediaItem } from '../../../../api/media';
import { ApiError, errorMessage } from '../../../../api/client';
import { Modal } from '../../../../components/ui/Modal';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Spinner } from '../../../../components/ui/Spinner';
import { useToast } from '../../../../components/ui/ToastContext';
import { MediaGrid } from './MediaGrid';
import { filterMedia, replaceMediaItem } from './mediaLibrary';

interface MediaLibraryModalProps {
  siteSlug: string;
  /** URL actuelle du champ image (image signalée, jamais supprimable d'ici). */
  currentUrl?: string;
  /** Image choisie pour le champ (URL /api/media/file/<nom>) ; absent : consultation seule. */
  onSelect?: (url: string) => void;
  onClose: () => void;
}

// Recherche proposée au-delà de ce nombre d'images.
const SEARCH_THRESHOLD = 8;

// Médiathèque du site : parcourir et réutiliser les images téléversées, renseigner leur
// texte alternatif (repris par le site publié), supprimer celles qui ne servent plus (le
// serveur refuse tant qu'un contenu les cite, brouillons compris).
export function MediaLibraryModal({ siteSlug, currentUrl, onSelect, onClose }: MediaLibraryModalProps) {
  const toast = useToast();
  const searchId = useId();
  const [items, setItems] = useState<MediaItem[]>([]);
  // Dernière version de la liste : une réponse (texte enregistré, suppression) s'applique
  // à l'état le plus récent, jamais à une copie périmée.
  const itemsRef = useRef<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const applyItems = (next: MediaItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  // Chargement à l'ouverture (et sur « Réessayer ») ; résultat ignoré après fermeture.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchMediaLibrary(siteSlug)
      .then((list) => {
        if (!active) return;
        itemsRef.current = list;
        setItems(list);
      })
      .catch((err) => {
        if (active) setLoadError(errorMessage(err, 'erreur inconnue.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [siteSlug, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const dropDraft = (id: string) =>
    setAltDrafts((drafts) => {
      const next = { ...drafts };
      delete next[id];
      return next;
    });

  const saveAlt = async (item: MediaItem) => {
    const alt = altDrafts[item.id] ?? item.alt;
    setSavingId(item.id);
    try {
      const updated = await updateMediaAlt(siteSlug, item.id, alt);
      applyItems(replaceMediaItem(itemsRef.current, updated));
      dropDraft(item.id);
      toast.success('Texte alternatif enregistré.');
    } catch (err) {
      toast.error(errorMessage(err, "Impossible d'enregistrer le texte alternatif."));
    } finally {
      setSavingId(null);
    }
  };

  const select = (item: MediaItem) => {
    onSelect?.(item.url);
    onClose();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const deletedId = toDelete.id;
    setDeleting(true);
    try {
      await deleteMedia(siteSlug, deletedId);
      applyItems(itemsRef.current.filter((i) => i.id !== deletedId));
      dropDraft(deletedId);
      toast.success('Image supprimée de la médiathèque.');
      setToDelete(null);
    } catch (err) {
      toast.error(errorMessage(err, "Impossible de supprimer l'image."));
      // Utilisée entre-temps (409) ou déjà supprimée (404) : liste rechargée
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        setToDelete(null);
        reload();
      }
    } finally {
      setDeleting(false);
    }
  };

  const visible = filterMedia(items, query);

  return (
    <Modal title="Médiathèque du site" subtitle={loading && items.length === 0 ? undefined : `${items.length} image(s)`} onClose={onClose} maxWidth={900}>
      {loading && items.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner label="Chargement des images…" />
        </div>
      ) : loadError ? (
        <EmptyState
          icon="⚠️"
          title="Médiathèque indisponible"
          description={`Impossible de charger la médiathèque : ${loadError}`}
          action={<button type="button" className="btn btn-primary" onClick={reload}>Réessayer</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState icon="🖼️" title="Aucune image pour l'instant" description="Téléversez une image avec le bouton 📤 d'un champ image : elle apparaîtra ici." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.length > SEARCH_THRESHOLD && (
            <div>
              <label className="sr-only" htmlFor={searchId}>Rechercher une image</label>
              <input
                id={searchId}
                type="search"
                className="input-text"
                placeholder="Rechercher une image"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {visible.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Aucune image ne correspond à votre recherche.</p>
          ) : (
            <MediaGrid
              items={visible}
              currentUrl={currentUrl}
              altDrafts={altDrafts}
              savingId={savingId}
              onAltChange={(id, value) => setAltDrafts((drafts) => ({ ...drafts, [id]: value }))}
              onAltSave={saveAlt}
              onSelect={onSelect ? select : undefined}
              onDelete={setToDelete}
            />
          )}
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer l'image ?"
          message={<>« {toDelete.filename} » sera supprimée définitivement de la médiathèque. Les versions déjà publiées du site la conservent jusqu'au prochain déploiement.</>}
          confirmLabel="Supprimer"
          danger
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Modal>
  );
}
