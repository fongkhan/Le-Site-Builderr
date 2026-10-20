// Monogramme du site (icône d'onglet sans logo) — module pur, testé depuis le serveur
// (server/tests/unit/monogram.test.mjs). MÊMES règles d'initiales que
// orchestrator/src/lib/monogram.ts (aperçu de la page Design) : les garder identiques.

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Jeton : une lettre ou un chiffre, suivi de lettres, chiffres, marques combinantes et
// apostrophes (« l'atelier », « Céline » en forme décomposée).
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;
// Premier caractère d'un jeton, avec ses marques combinantes
const FIRST_CHAR = /^[\p{L}\p{N}]\p{M}*/u;

function initialsList(name) {
  const tokens = String(name ?? '').match(TOKEN) || [];
  return tokens.slice(0, 2).map((token) => token.match(FIRST_CHAR)[0].toLocaleUpperCase('fr'));
}

/** Initiales du nom (1 ou 2 caractères), ou « • » si le nom n'a ni lettre ni chiffre. */
export function initials(name) {
  const list = initialsList(name);
  return list.length > 0 ? list.join('') : '•';
}

/**
 * Valeur hexadécimale d'une variable « --color-<name>: #…; » de theme.css, ou null.
 * « primary » ne lit jamais « --color-primary-deep » (le « : » doit suivre le nom).
 */
export function themeCssColor(css, name) {
  if (typeof css !== 'string' || !/^[a-z][a-z0-9-]*$/.test(String(name))) return null;
  const match = css.match(new RegExp(`--color-${name}\\s*:\\s*(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\\s*;`));
  return match ? match[1] : null;
}

const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Icône SVG carrée (64×64, coins arrondis) : initiales du site sur la couleur du thème. */
export function monogramSvg({ name, background, foreground } = {}) {
  const bg = typeof background === 'string' && HEX_COLOR.test(background) ? background : '#3b82f6';
  const fg = typeof foreground === 'string' && HEX_COLOR.test(foreground) ? foreground : '#ffffff';
  const list = initialsList(name);
  const text = list.length > 0 ? list.join('') : '•';
  const size = list.length > 1 ? 28 : 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + `<rect width="64" height="64" rx="14" fill="${bg}"/>`
    + `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${size}" font-weight="700" fill="${fg}">${escapeXml(text)}</text>`
    + `</svg>`;
}
