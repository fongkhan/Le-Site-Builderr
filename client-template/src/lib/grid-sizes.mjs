// Attribut sizes des images d'une grille « repeat(auto-fit, minmax(<min>px, 1fr)) »
// (galerie, produits) — module pur, testé depuis le serveur
// (server/tests/unit/grid-sizes.test.mjs).
// auto-fit supprime les colonnes vides : une grille de 1 ou 2 éléments s'étire sur toute
// la largeur du conteneur. Le navigateur choisit la variante du srcset d'après sizes, pas
// d'après la mise en page : la largeur annoncée suit donc le nombre d'éléments rendus et
// le nombre de colonnes qui tiennent à chaque largeur d'écran.

/**
 * sizes d'une image parmi `count` éléments d'une grille auto-fit : colonnes de `minWidth`
 * px au moins, séparées de `gap` px, dans un conteneur de `maxWidth` px au plus entouré de
 * `gutter` px de marges latérales en tout.
 */
export function autoFitSizes(count, { minWidth, gap, maxWidth = 1200, gutter = 40 }) {
  const items = Math.max(1, Math.floor(Number(count)) || 1);
  const fit = Math.max(1, Math.floor((maxWidth + gap) / (minWidth + gap)));
  const columns = Math.min(items, fit);
  const slot = (c) => (c === 1 ? `calc(100vw - ${gutter}px)` : `calc((100vw - ${gutter + (c - 1) * gap}px) / ${c})`);
  const parts = [];
  for (let c = 1; c < columns; c++) {
    // c + 1 colonnes tiennent à partir de (c + 1) × minWidth + c × gap, marges comprises
    parts.push(`(max-width: ${(c + 1) * minWidth + c * gap + gutter - 1}px) ${slot(c)}`);
  }
  parts.push(`(max-width: ${maxWidth + gutter - 1}px) ${slot(columns)}`);
  parts.push(`${Math.ceil((maxWidth - (columns - 1) * gap) / columns)}px`);
  return parts.join(', ');
}
