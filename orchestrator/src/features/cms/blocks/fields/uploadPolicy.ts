import { ApiError } from '../../../../api/client';

// Formats acceptés par la médiathèque (images matricielles : jamais de SVG, qui peut
// embarquer du script). Alignés sur la collection « media » côté serveur.
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export const FORMAT_ERROR = 'Format refusé : choisissez une image PNG, JPEG, WebP, GIF ou AVIF.';

// Limite de taille annoncée par le serveur (/api/config → mediaMaxMb, réglée par
// MEDIA_MAX_MB). null tant qu'elle est inconnue : le serveur reste alors seul juge.
export function uploadLimitMb(mediaMaxMb: unknown): number | null {
  return typeof mediaMaxMb === 'number' && Number.isFinite(mediaMaxMb) && mediaMaxMb > 0 ? mediaMaxMb : null;
}

export function sizeErrorMessage(limitMb: number | null): string {
  return limitMb ? `Image trop volumineuse (${limitMb} Mo maximum).` : 'Image trop volumineuse.';
}

// Vrai si le fichier dépasse la limite connue du serveur (jamais refusé sans limite connue).
export function exceedsUploadLimit(size: number, limitMb: number | null): boolean {
  return limitMb !== null && size > limitMb * 1024 * 1024;
}

// Message lisible pour un refus du serveur. Un 413 garde le message du serveur (il
// contient la vraie limite) ; Payload répond en anglais pour un format refusé.
export function uploadErrorMessage(err: unknown, limitMb: number | null): string {
  if (err instanceof ApiError && err.status === 413) return err.message || sizeErrorMessage(limitMb);
  if (err instanceof ApiError && err.status === 400) return FORMAT_ERROR;
  return err instanceof Error && err.message ? err.message : 'Échec du téléversement.';
}
