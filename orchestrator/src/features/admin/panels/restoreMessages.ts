// Messages affichés après une restauration de sauvegarde (fonctions pures, testées).
import type { RestoreResult } from '../../../api/admin';

const MAX_LISTED_IMAGES = 5;

// Message principal : site créé en copie, ou contenu remplacé (avec la sauvegarde de
// sécurité qui permet de revenir en arrière).
export function restoreSuccessMessage(r: RestoreResult): string {
  const images = r.media.restored + r.media.copied;
  if (r.mode === 'replace') {
    return `Contenu de « ${r.site.name} » remplacé : ${r.pages} page(s), ${r.posts} article(s), ${images} image(s) restaurée(s). Sauvegarde de sécurité : ${r.safetyBackup}. Publiez le site pour mettre cette version en ligne.`;
  }
  return `Site « ${r.site.name} » restauré en copie (slug ${r.site.slug}) : ${r.pages} page(s), ${r.posts} article(s), ${images} image(s). Il n'est rattaché à aucun compte client.`;
}

// Images citées par le contenu mais introuvables (5 noms au plus), ou null.
export function missingImagesMessage(missing: string[]): string | null {
  if (!missing || missing.length === 0) return null;
  const listed = missing.slice(0, MAX_LISTED_IMAGES).join(', ');
  const others = missing.length - MAX_LISTED_IMAGES;
  return `Images introuvables (absentes de la sauvegarde) : ${listed}${others > 0 ? ` et ${others} autre(s)` : ''}.`;
}

// Éléments invalides écartés de la sauvegarde (pages, articles, thème), ou null.
export function skippedContentMessage(skipped: RestoreResult['skipped']): string | null {
  if (!skipped || (!skipped.pages && !skipped.posts && !skipped.theme)) return null;
  return `Éléments invalides écartés : ${skipped.pages} page(s), ${skipped.posts} article(s)${skipped.theme ? ', thème' : ''}.`;
}
