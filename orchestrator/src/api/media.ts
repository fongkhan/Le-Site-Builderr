import { apiFetch, ApiError, sitePath } from './client';
import { resolveSiteIds } from './users';

// Téléverse une image dans la médiathèque du site (collection Payload « media »).
// Renvoie l'URL servie par Payload (/api/media/file/<nom>) — utilisée telle quelle
// dans le CMS ; au déploiement elle est réécrite en /media/<nom> et le fichier
// copié dans le site statique.
export async function uploadMedia(siteSlug: string, file: File): Promise<{ url: string }> {
  const [siteId] = await resolveSiteIds([siteSlug]);
  const form = new FormData();
  form.append('file', file);
  form.append('_payload', JSON.stringify({ site: siteId }));

  const data = await apiFetch<{ doc?: { url?: string } }>('/api/media', { method: 'POST', body: form });
  const url = data?.doc?.url;
  if (!url) throw new ApiError(500, "Téléversement accepté mais URL introuvable dans la réponse.");
  return { url };
}

// Contenu qui cite une image (page de l'éditeur, article du blog, brouillons compris, ou
// logo du thème).
export interface MediaUsage {
  type: 'page' | 'post' | 'theme';
  title: string;
  slug: string;
  /** Langue de la page (« fr » par défaut). */
  locale?: string;
  /** Article non publié. */
  draft?: boolean;
}

// Image de la médiathèque du site (GET /api/sites/:slug/media).
export interface MediaItem {
  id: string;
  filename: string;
  /** URL servie par Payload (/api/media/file/<nom>), à placer dans les champs image. */
  url: string;
  /** Texte alternatif repris par le site publié ('' : texte de repli du bloc). */
  alt: string;
  width: number | null;
  height: number | null;
  filesize: number | null;
  mimeType: string;
  createdAt: string | null;
  usedIn: MediaUsage[];
}

export async function fetchMediaLibrary(siteSlug: string): Promise<MediaItem[]> {
  const data = await apiFetch<{ items?: MediaItem[] }>(sitePath(siteSlug, 'media'));
  return data?.items || [];
}

export function updateMediaAlt(siteSlug: string, id: string, alt: string): Promise<MediaItem> {
  return apiFetch(sitePath(siteSlug, 'media', id), { method: 'PATCH', body: JSON.stringify({ alt }) });
}

// Suppression refusée par le serveur tant que l'image est utilisée : ApiError(409) dont le
// message nomme les contenus qui la citent.
export function deleteMedia(siteSlug: string, id: string): Promise<{ success: boolean }> {
  return apiFetch(sitePath(siteSlug, 'media', id), { method: 'DELETE' });
}
