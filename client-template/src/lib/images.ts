// Images du site : attributs <img> (texte alternatif, dimensions, srcset) et variantes
// redimensionnées des fichiers de la médiathèque, servis sous <base>/media/. Logique pure
// dans media-images.mjs (testée depuis le serveur) ; ici, le chemin de base du build.
import { imageAttrs, variantUrl } from './media-images.mjs';
import { withBase } from './url';

export interface MediaInfo {
  alt: string;
  width: number | null;
  height: number | null;
  /** Largeurs des variantes publiées sous <base>/media/w<largeur>/<nom>. */
  variants: number[];
}

/** Index nom de fichier → métadonnées (SiteContent.media). */
export type MediaIndex = Record<string, MediaInfo>;

export interface SiteImageAttrs {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  srcset?: string;
  sizes?: string;
}

/** Attributs d'une image : texte alternatif de la médiathèque, sinon `fallbackAlt`. */
export function siteImage(src: string, media: MediaIndex, options: { fallbackAlt?: string; sizes?: string } = {}): SiteImageAttrs {
  return imageAttrs(src, { media, mediaPrefix: withBase('/media/'), ...options }) as SiteImageAttrs;
}

/** URL de la variante `width` d'une image de la médiathèque (sinon l'URL d'origine, '' si vide). */
export function siteImageVariant(src: string, media: MediaIndex, width: number): string {
  if (!src) return '';
  return variantUrl(src, width, { media, mediaPrefix: withBase('/media/') }) as string;
}
