// Médiathèque du site — fonctions pures (libellés, recherche, image du champ).
import type { MediaItem, MediaUsage } from '../../../../api/media';
import { formatBytes } from '../../../../lib/format';

// Contenus cités sur une carte : au-delà, « et N autre(s) » (la carte reste compacte).
const USAGE_SHOWN = 3;

function usageText(u: MediaUsage): string {
  if (u.type === 'post') return `article « ${u.title} »${u.draft ? ' (brouillon)' : ''}`;
  const locale = u.locale || 'fr';
  return `page « ${u.title} »${locale !== 'fr' ? ` (${locale.toUpperCase()})` : ''}`;
}

/** « Non utilisée » ou « Utilisée dans : page « Accueil », article « Noël » (brouillon) ». */
export function usageLabel(usedIn: MediaUsage[]): string {
  if (!usedIn || usedIn.length === 0) return 'Non utilisée';
  const shown = usedIn.slice(0, USAGE_SHOWN).map(usageText).join(', ');
  const more = usedIn.length > USAGE_SHOWN ? ` et ${usedIn.length - USAGE_SHOWN} autre(s)` : '';
  return `Utilisée dans : ${shown}${more}`;
}

/** Nom du fichier d'une URL de la médiathèque (/api/media/file/<nom> ou /media/<nom>), décodé ; null sinon. */
export function mediaFilenameFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const m = /^\/(?:api\/media\/file|media)\/([^/?#]+)(?:[?#].*)?$/.exec(url.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Vrai si l'URL du champ désigne cette image. */
export function isCurrentMedia(url: string | null | undefined, item: Pick<MediaItem, 'filename'>): boolean {
  const name = mediaFilenameFromUrl(url);
  return name !== null && name === item.filename;
}

// Minuscules sans accents (« Été » → « ete »).
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Images dont le nom ou le texte alternatif contient la recherche (sans casse ni accents). */
export function filterMedia(items: MediaItem[], query: string): MediaItem[] {
  const q = fold(query.trim());
  if (!q) return items;
  return items.filter((item) => fold(item.filename).includes(q) || fold(item.alt || '').includes(q));
}

/** Image renvoyée par le serveur, appliquée à la DERNIÈRE version de la liste. */
export function replaceMediaItem(items: MediaItem[], updated: MediaItem): MediaItem[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

/** « 1600 × 1067 px · 245 Ko » (parties inconnues omises). */
export function dimensionsLabel(item: Pick<MediaItem, 'width' | 'height' | 'filesize'>): string {
  const parts: string[] = [];
  if (item.width && item.height) parts.push(`${item.width} × ${item.height} px`);
  if (item.filesize) parts.push(formatBytes(item.filesize));
  return parts.join(' · ');
}
