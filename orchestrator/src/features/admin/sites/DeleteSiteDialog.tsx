import { useState } from 'react';
import { deleteSite } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import type { Site } from '../../../types';

// Suppression d'un site. La suppression des fichiers publiés est un choix explicite
// (décochée par défaut) : sans elle, le dossier de production reste en place.
export function DeleteSiteDialog({ site, onClose, onDeleted }: { site: Site; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSite(site.slug, deleteFiles);
      toast.success(`Site « ${site.name} » supprimé${deleteFiles ? ', fichiers compris' : ''}.`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Erreur lors de la suppression du site.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      title="Supprimer ce site ?"
      message={
        <>
          Le site <strong>{site.name}</strong> (slug : <code>{site.slug}</code>) sera retiré de la base, avec ses
          pages, articles, thème, statistiques et versions conservées. Cette action est irréversible.
        </>
      }
      confirmLabel={deleteFiles ? 'Supprimer le site et ses fichiers' : 'Supprimer définitivement'}
      danger
      loading={deleting}
      onConfirm={handleDelete}
      onCancel={onClose}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} style={{ width: 16, height: 16 }} />
        Supprimer aussi les fichiers publiés du site (<code>{site.documentRoot}</code>)
      </label>
    </ConfirmDialog>
  );
}
