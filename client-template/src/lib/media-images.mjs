// Images de la médiathèque sur le site publié — module pur, sans import.meta, testé depuis
// le serveur (server/tests/unit/media-images.test.mjs).
// Le manifeste du build (/internal/site-media, ou clé « media » d'une fixture) donne pour
// chaque fichier son texte alternatif, ses dimensions et les largeurs de ses variantes
// redimensionnées, publiées sous <base>/media/w<largeur>/<nom> (server/lib/media-variants.js,
// variantRelPath). Une image hors médiathèque (URL externe) est rendue telle quelle.

const ALT_MAX = 200;

const positiveInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

// Nom de fichier simple : jamais de séparateur de chemin ni de caractère NUL.
const isPlainName = (name) => typeof name === 'string' && name !== '' && !/[\\/\0]/.test(name);

/**
 * Manifeste → index nom → { alt, width, height, variants } (entrées invalides ignorées ;
 * variantes : entiers uniques triés, strictement plus petits que l'original).
 */
export function indexMedia(docs) {
  const index = Object.create(null);
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc || typeof doc !== 'object' || !isPlainName(doc.filename)) continue;
    const alt = typeof doc.alt === 'string' ? doc.alt.trim() : '';
    const width = positiveInt(doc.width);
    const variants = width === null
      ? []
      : [...new Set((Array.isArray(doc.variants) ? doc.variants : []).filter((w) => Number.isInteger(w) && w > 0 && w < width))].sort((a, b) => a - b);
    index[doc.filename] = {
      alt: alt.length <= ALT_MAX ? alt : '',
      width,
      height: positiveInt(doc.height),
      variants,
    };
  }
  return index;
}

const lookup = (media, name) => (media && name !== null && Object.prototype.hasOwnProperty.call(media, name) ? media[name] : null);

/** Nom du fichier d'une URL de la médiathèque (« <prefixe><nom>[?…] »), ou null. */
export function mediaNameFromUrl(src, mediaPrefix) {
  if (typeof src !== 'string' || !mediaPrefix || !src.startsWith(mediaPrefix)) return null;
  const rest = src.slice(mediaPrefix.length).split(/[?#]/)[0];
  if (!rest || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

const variantPath = (mediaPrefix, width, name) => `${mediaPrefix}w${width}/${encodeURIComponent(name)}`;

/** URL de la variante `width` d'une image si elle est publiée, sinon l'URL d'origine. */
export function variantUrl(src, width, { media, mediaPrefix } = {}) {
  const name = mediaNameFromUrl(src, mediaPrefix);
  const info = lookup(media, name);
  return info && info.variants.includes(width) ? variantPath(mediaPrefix, width, name) : src;
}

/**
 * Attributs d'une balise <img> : texte alternatif de la médiathèque (sinon `fallbackAlt`),
 * dimensions intrinsèques (aucun décalage de mise en page) et srcset des variantes
 * (+ l'original à sa largeur) avec `sizes`. Sans manifeste : { src, alt: fallbackAlt }.
 */
export function imageAttrs(src, { media, mediaPrefix, fallbackAlt = '', sizes } = {}) {
  const name = mediaNameFromUrl(src, mediaPrefix);
  const info = lookup(media, name);
  const attrs = { src, alt: (info && info.alt) || fallbackAlt };
  if (!info) return attrs;
  if (info.width && info.height) {
    attrs.width = info.width;
    attrs.height = info.height;
  }
  if (info.width && info.variants.length > 0) {
    attrs.srcset = [
      ...info.variants.map((w) => `${variantPath(mediaPrefix, w, name)} ${w}w`),
      `${mediaPrefix}${encodeURIComponent(name)} ${info.width}w`,
    ].join(', ');
    if (sizes) attrs.sizes = sizes;
  }
  return attrs;
}

/**
 * Largeur d'affichage d'une image de la médiathèque rendue à `height` px de haut (logo de
 * l'en-tête), d'après ses dimensions intrinsèques : place réservée avant le chargement.
 * null si elles sont inconnues (image hors médiathèque ou manifeste absent).
 */
export function widthAtHeight(src, height, { media, mediaPrefix } = {}) {
  const info = lookup(media, mediaNameFromUrl(src, mediaPrefix));
  if (!info || !info.width || !info.height || !(Number.isFinite(height) && height > 0)) return null;
  return Math.max(1, Math.round((info.width * height) / info.height));
}
