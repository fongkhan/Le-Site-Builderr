import { useState } from 'react';
import { deleteSite, type RemoteRemoval } from '../../../api/sites';
import { errorMessage } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { useConfig } from '../../../state/ConfigContext';
import type { Site } from '../../../types';

// Étapes du retrait distant qui ont échoué, en clair
function failedSteps(remote: RemoteRemoval): string {
  const labels: string[] = [];
  if (remote.customDomain === 'failed') labels.push('domaine personnalisé');
  if (remote.subdomain === 'failed') labels.push('sous-domaine');
  if (remote.files === 'failed') labels.push('fichiers');
  return labels.join(', ');
}

// Suppression d'un site. La suppression des fichiers publiés est un choix explicite
// (décochée par défaut) : sans elle, le dossier de production reste en place. En mode
// cPanel, elle retire aussi le site du serveur (domaine personnalisé, sous-domaine,
// dossier en ligne).
export function DeleteSiteDialog({ site, onClose, onDeleted }: { site: Site; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const { config } = useConfig();
  const isRemote = config?.hostingMode === 'cpanel';
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await deleteSite(site.slug, deleteFiles);
      if (result.remote && !result.remote.removed) {
        const steps = failedSteps(result.remote);
        toast.error(
          `Site « ${site.name} » supprimé, mais son retrait de l'hébergement est incomplet${steps ? ` (${steps})` : ''} : vérifiez le serveur cPanel.`
        );
      } else {
        toast.success(`Site « ${site.name} » supprimé${deleteFiles ? (isRemote ? ' et retiré du serveur' : ', fichiers compris') : ''}.`);
      }
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
          pages, articles, images téléversées, thème, statistiques et versions conservées. Cette action est irréversible.
        </>
      }
      confirmLabel={deleteFiles ? (isRemote ? 'Supprimer le site et le retirer du serveur' : 'Supprimer le site et ses fichiers') : 'Supprimer définitivement'}
      danger
      loading={deleting}
      onConfirm={handleDelete}
      onCancel={onClose}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} style={{ width: 16, height: 16 }} />
        {isRemote ? (
          <span>
            Retirer aussi le site du serveur cPanel (sous-domaine <code>{site.domain}</code>
            {site.customDomain ? <>, domaine <code>{site.customDomain}</code></> : null} et fichiers en ligne)
          </span>
        ) : (
          <span>
            Supprimer aussi les fichiers publiés du site (<code>{site.documentRoot}</code>)
          </span>
        )}
      </label>
    </ConfirmDialog>
  );
}
