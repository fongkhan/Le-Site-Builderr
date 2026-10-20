// Initiales du site (icône d'onglet sans logo) : MÊMES règles que
// client-template/src/lib/monogram.mjs (icône générée au build du site).

// Jeton : une lettre ou un chiffre, suivi de lettres, chiffres, marques combinantes et
// apostrophes (« l'atelier », lettres accentuées en forme décomposée).
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;
// Premier caractère d'un jeton, avec ses marques combinantes
const FIRST_CHAR = /^[\p{L}\p{N}]\p{M}*/u;

/** Initiales du nom (1 ou 2 caractères), ou « • » si le nom n'a ni lettre ni chiffre. */
export function initials(name: string | null | undefined): string {
  const tokens = String(name ?? '').match(TOKEN) ?? [];
  const list = tokens.slice(0, 2).map((token) => (token.match(FIRST_CHAR)?.[0] ?? '').toLocaleUpperCase('fr'));
  return list.length > 0 ? list.join('') : '•';
}
