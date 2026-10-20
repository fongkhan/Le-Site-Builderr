import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteSubmission, fetchSubmissions, markSubmissionRead, publishUnread } from '../../api/submissions';
import type { Submission } from '../../api/submissions';
import { errorMessage } from '../../api/client';
import { useCurrentSite } from '../../state/currentSite';
import { useToast } from '../../components/ui/ToastContext';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateTimeFr } from '../../lib/format';
import type { Site } from '../../types';

// Lien « Répondre » : l'adresse reste lisible (@ conservé), le reste est encodé.
function replyHref(submission: Submission, siteName: string): string {
  const to = encodeURIComponent(submission.email).replace(/%40/g, '@');
  const subject = encodeURIComponent(`Re : votre ${submission.kind === 'appointment' ? 'demande de rendez-vous' : 'message'} via ${siteName}`);
  return `mailto:${to}?subject=${subject}`;
}

// Boîte de réception des formulaires du site publié (contact, rendez-vous). Une instance
// par site : une réponse arrivée après un changement de site ne touche jamais la liste
// du site affiché.
export function MessagesPage() {
  const site = useCurrentSite();
  return <Inbox key={site.slug} site={site} />;
}

// Message mis à jour par le serveur, appliqué à la DERNIÈRE version de la liste.
// eslint-disable-next-line react-refresh/only-export-components
export function replaceSubmission(list: Submission[], updated: Submission): Submission[] {
  return list.map((s) => (s.id === updated.id ? updated : s));
}

function Inbox({ site }: { site: Site }) {
  const toast = useToast();
  const [items, setItems] = useState<Submission[]>([]);
  // Dernière version de la liste : deux actions concurrentes (marquer A puis B avant la
  // réponse de A) partent chacune de l'état le plus récent, aucune n'efface l'autre.
  const itemsRef = useRef<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Submission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    fetchSubmissions(site.slug)
      .then((d) => {
        if (id !== requestId.current) return;
        itemsRef.current = d.items || [];
        setItems(itemsRef.current);
        publishUnread(site.slug, d.unread ?? 0);
      })
      .catch((err) => { if (id === requestId.current) setLoadError(errorMessage(err, 'Impossible de charger les messages.')); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [site.slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Liste mise à jour localement (à partir de sa dernière version), compteur recalculé
  const applyItems = (change: (current: Submission[]) => Submission[]) => {
    const next = change(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    publishUnread(site.slug, next.filter((s) => !s.read).length);
  };

  const toggleRead = async (submission: Submission) => {
    setBusyId(submission.id);
    try {
      const updated = await markSubmissionRead(site.slug, submission.id, !submission.read);
      applyItems((current) => replaceSubmission(current, updated));
    } catch (err) {
      toast.error(errorMessage(err, 'Impossible de mettre à jour le message.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const deletedId = toDelete.id;
    setDeleting(true);
    try {
      await deleteSubmission(site.slug, deletedId);
      applyItems((current) => current.filter((s) => s.id !== deletedId));
      toast.success('Message supprimé.');
      setToDelete(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Impossible de supprimer le message.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="glass-panel animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem' }}>Messages reçus</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Demandes envoyées par les formulaires de contact et de rendez-vous du site. Les messages sont conservés 12 mois, 500 messages maximum.
          </p>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={load} disabled={loading}>
          Actualiser
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner label="Chargement des messages…" />
        </div>
      ) : loadError ? (
        <EmptyState
          icon="⚠️"
          title="Impossible de charger les messages"
          description={loadError}
          action={<button className="btn btn-primary" onClick={load}>Réessayer</button>}
        />
      ) : (
        <MessagesList items={items} siteName={site.name} busyId={busyId} onToggleRead={toggleRead} onDelete={setToDelete} />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer ce message ?"
          message={<>Le message de <strong>{toDelete.name}</strong> sera définitivement supprimé.</>}
          confirmLabel="Supprimer"
          danger
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

export function MessagesList({ items, siteName, busyId = null, onToggleRead, onDelete }: {
  items: Submission[];
  siteName: string;
  busyId?: string | null;
  onToggleRead: (s: Submission) => void;
  onDelete: (s: Submission) => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon="📭" title="Aucun message" description="Les messages envoyés depuis le site publié apparaîtront ici." />;
  }
  const small = { padding: '4px 10px', fontSize: '0.8rem' };
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((s) => (
        <li
          key={s.id}
          style={{
            padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border-color)',
            background: s.read ? 'rgba(255,255,255,0.02)' : 'var(--accent-blue-soft)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{s.name}</strong>
                {!s.read && <span className="badge" style={{ color: 'var(--indigo-200)', borderColor: 'var(--accent-blue-border)' }}>Non lu</span>}
                {s.kind === 'appointment' && <span className="badge" style={{ color: 'var(--amber-400)' }}>Rendez-vous</span>}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {s.email}{s.phone ? ` · ${s.phone}` : ''} · {formatDateTimeFr(s.createdAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' }}>
              <a className="btn btn-secondary" style={{ ...small, textDecoration: 'none' }} href={replyHref(s, siteName)}>Répondre</a>
              <button className="btn btn-secondary" style={small} onClick={() => onToggleRead(s)} disabled={busyId === s.id}>
                {s.read ? 'Marquer comme non lu' : 'Marquer comme lu'}
              </button>
              <button className="btn btn-secondary" style={{ ...small, color: 'var(--accent-rose)' }} onClick={() => onDelete(s)}>Supprimer</button>
            </div>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.92rem' }}>{s.message}</p>
        </li>
      ))}
    </ul>
  );
}
