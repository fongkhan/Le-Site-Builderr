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
