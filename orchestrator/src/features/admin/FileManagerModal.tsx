import { useEffect, useRef, useState } from 'react';
import { fetchSiteFileContent, fetchSiteFiles } from '../../api/sites';
import { errorMessage } from '../../api/client';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { formatBytes } from '../../lib/format';
import type { FileEntry, Site } from '../../types';

type FolderType = 'documentRoot' | 'repository';

export function FileManagerModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const [folderType, setFolderType] = useState<FolderType>('documentRoot');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  // Seule la dernière demande de lecture est affichée (clics rapides, changement de dossier)
  const viewRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    viewRequest.current++;
    setFilesLoading(true);
    setFilesError(null);
    setSelectedPath(null);
    setContent(null);
    setContentLoading(false);
    fetchSiteFiles(site.slug, folderType)
      .then((data) => { if (!cancelled) setFiles(data); })
      .catch((err) => {
        if (cancelled) return;
        setFiles([]);
        setFilesError(errorMessage(err, 'Impossible de lister les fichiers.'));
      })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [site.slug, folderType]);

  const viewFile = async (filePath: string) => {
    const id = ++viewRequest.current;
    setSelectedPath(filePath);
    setContentLoading(true);
    try {
      const data = await fetchSiteFileContent(site.slug, filePath, folderType);
      if (id === viewRequest.current) setContent(data.content);
    } catch (err) {
      if (id === viewRequest.current) setContent(errorMessage(err, "Impossible d'afficher le contenu (binaire ou fichier trop volumineux)."));
    } finally {
      if (id === viewRequest.current) setContentLoading(false);
    }
  };

  return (
    <Modal
      title="📁 Gestionnaire de fichiers"
      subtitle={<>Site : <strong>{site.name}</strong></>}
      onClose={onClose}
      maxWidth={950}
      bodyPadding={false}
    >
      <div style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`btn ${folderType === 'documentRoot' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={() => setFolderType('documentRoot')}>
          🌐 Dossier web public
        </button>
        <button
          className={`btn ${folderType === 'repository' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          onClick={() => setFolderType('repository')}
          disabled={!site.repositoryPath}
          title={site.repositoryPath ? undefined : "Ce site n'a pas de dossier source configuré."}
        >
          💻 Code source (repository)
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Chemin : <code>{folderType === 'repository' ? site.repositoryPath : site.documentRoot}</code>
        </span>
      </div>

      <div className="file-manager-grid">
        <div style={{ borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: 15, background: 'rgba(0,0,0,0.1)' }}>
          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12, fontWeight: 700 }}>STRUCTURE DU DOSSIER</h4>
          {filesLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
              <Spinner label="Chargement…" />
            </div>
          ) : filesError ? (
            <div role="alert" style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
              {filesError}
            </div>
          ) : files.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
              {folderType === 'documentRoot'
                ? "Le dossier public est vide. Lancez un déploiement pour générer les fichiers."
                : "Le dossier du dépôt est vide ou n'existe pas."}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {files.map((file) => {
                const rowStyle = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderRadius: 4,
                  background: selectedPath === file.path ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left' as const,
                  cursor: file.isDir ? 'default' : 'pointer',
                  fontSize: '0.85rem',
                  userSelect: 'none' as const,
                };
                const inner = (
                  <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <span style={{ fontSize: '1rem' }}>{file.isDir ? '📁' : '📄'}</span>
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: file.isDir ? 'var(--blue-300)' : 'white', textDecoration: file.isDir ? 'none' : 'underline', fontWeight: file.isDir ? 600 : 'normal' }}>
                      {file.path}
                    </span>
                  </div>
                  {!file.isDir && file.size !== undefined && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatBytes(file.size)}</span>
                  )}
                  </>
                );
                // Fichiers : vrais boutons (accessibles au clavier) ; dossiers : simple ligne
                return file.isDir ? (
                  <div key={file.path} style={rowStyle}>{inner}</div>
                ) : (
                  <button key={file.path} type="button" style={rowStyle} onClick={() => viewFile(file.path)} aria-pressed={selectedPath === file.path}>
                    {inner}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#05070c' }}>
          <div style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Contenu : {selectedPath ? <code>{selectedPath}</code> : 'Aucun fichier sélectionné'}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20, fontFamily: 'Courier New, monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
            {contentLoading ? (
              <div style={{ color: 'var(--accent-blue)', textAlign: 'center', padding: 40 }}>Lecture du fichier…</div>
            ) : content !== null ? (
              <pre style={{ margin: 0, color: '#34d399' }}>{content}</pre>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                Sélectionnez un fichier à gauche pour afficher son contenu.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
