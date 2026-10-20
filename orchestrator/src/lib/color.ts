// Couleurs du thème : #RGB, #RRGGBB et #RRGGBBAA sont acceptés par le serveur.

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

// Normalise en #rrggbb (sans canal alpha) ; valeur invalide → repli.
export function toHex6(value: string, fallback = '#000000'): string {
  if (!HEX.test(value)) return fallback;
  const hex = value.slice(1).toLowerCase();
  if (hex.length === 3) return `#${hex.split('').map((c) => c + c).join('')}`;
  return `#${hex.slice(0, 6)}`;
}

// Couleur avec transparence (alpha entre 0 et 1), quel que soit le format d'entrée.
export function withAlpha(value: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0');
  return `${toHex6(value)}${a}`;
}

// Luminance relative WCAG 2.x d'une couleur hexadécimale (0 = noir, 1 = blanc).
export function relativeLuminance(value: string): number {
  const hex = toHex6(value).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Rapport de contraste WCAG entre deux couleurs (de 1 à 21).
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- Couleurs dérivées : MÊME algorithme que server/lib/theme.js (theme.css du site) ---

/** Seuil AA pour un texte courant. */
export const AA_RATIO = 4.5;

// Valeur de couleur sans espaces ; '' pour une valeur absente (thème ancien ou incomplet :
// traitée comme du noir, jamais d'exception dans un aperçu).
const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// Texte lisible sur un fond : la première de [...prefer, blanc, gris très foncé, noir]
// qui atteint 4,5:1 (couleur renvoyée telle que fournie, canal alpha retiré).
export function readableOn(bg: string, prefer: readonly string[] = []): string {
  for (const candidate of [...prefer, '#ffffff', '#111111', '#000000']) {
    const value = clean(candidate);
    if (!isHexColor(value)) continue;
    if (contrastRatio(value, clean(bg)) >= AA_RATIO) return value.length === 9 ? toHex6(value) : value;
  }
  return '#000000';
}

// Mélange sRGB canal par canal : t = 0 → a, t = 1 → b. Résultat '#rrggbb'.
export function mixHex(a: string, b: string, t: number): string {
  const ha = toHex6(clean(a)).slice(1);
  const hb = toHex6(clean(b)).slice(1);
  let out = '#';
  for (const i of [0, 2, 4]) {
    const ca = parseInt(ha.slice(i, i + 2), 16);
    const cb = parseInt(hb.slice(i, i + 2), 16);
    out += Math.round(ca + (cb - ca) * t).toString(16).padStart(2, '0');
  }
  return out;
}

export interface DerivedColors {
  /** Texte des boutons et bandeaux posés sur la couleur primaire */
  onPrimary: string;
  /** Texte posé sur la couleur secondaire */
  onSecondary: string;
  /** Second ton du dégradé du Hero */
  primaryDeep: string;
  /** Fond des cartes */
  surface: string;
  /** Texte secondaire lisible sur la surface et le fond */
  textMuted: string;
}

export function derivedColors(colors: { primary: string; secondary: string; background: string; text: string }): DerivedColors {
  const primary = clean(colors?.primary);
  const secondary = clean(colors?.secondary);
  const background = clean(colors?.background);
  const text = clean(colors?.text);
  const onPrimary = readableOn(primary);
  const onSecondary = readableOn(secondary, [text, '#111111']);
  const primaryDeep = mixHex(primary, relativeLuminance(onPrimary) > 0.5 ? '#000000' : '#ffffff', 0.35);
  const surface = contrastRatio('#ffffff', background) >= AA_RATIO ? mixHex(background, '#ffffff', 0.06) : '#ffffff';
  let textMuted = toHex6(text);
  for (const t of [0.3, 0.2, 0.1]) {
    const muted = mixHex(text, surface, t);
    if (contrastRatio(muted, surface) >= AA_RATIO && contrastRatio(muted, background) >= AA_RATIO) {
      textMuted = muted;
      break;
    }
  }
  return { onPrimary, onSecondary, primaryDeep, surface, textMuted };
}
