import { apiFetch, ApiError } from './client';
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
