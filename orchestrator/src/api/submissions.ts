import { apiFetch, sitePath } from './client';

// Message reçu par un formulaire du site publié (contact ou demande de rendez-vous).
export interface Submission {
  id: string;
  kind: 'contact' | 'appointment';
  name: string;
  email: string;
  phone: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface SubmissionList {
  items: Submission[];
  unread: number;
}

export function fetchSubmissions(siteSlug: string): Promise<SubmissionList> {
  return apiFetch(sitePath(siteSlug, 'submissions'));
}

export function markSubmissionRead(siteSlug: string, id: string, read: boolean): Promise<Submission> {
  return apiFetch(sitePath(siteSlug, 'submissions', id), {
    method: 'PATCH',
    body: JSON.stringify({ read }),
  });
}

export function deleteSubmission(siteSlug: string, id: string): Promise<{ success: boolean }> {
  return apiFetch(sitePath(siteSlug, 'submissions', id), { method: 'DELETE' });
}

// Compteur de non-lus partagé entre la page Messages et l'onglet de SiteLayout.
type UnreadListener = (siteSlug: string, unread: number) => void;
const unreadListeners = new Set<UnreadListener>();

export function onUnreadChange(listener: UnreadListener): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

export function publishUnread(siteSlug: string, unread: number): void {
  for (const listener of unreadListeners) listener(siteSlug, unread);
}
