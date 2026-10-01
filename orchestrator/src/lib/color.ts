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
