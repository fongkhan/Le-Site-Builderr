import { AA_RATIO, contrastRatio, isHexColor } from '../../lib/color';
import { DEFAULT_THEME, type Theme } from '../../types';

// Options et validation du thème : MÊMES règles que server/lib/theme.js (validateTheme),
// pour signaler une valeur refusée avant l'envoi plutôt qu'après.

/** Polices autorisées — identiques à HEADING_FONTS / BODY_FONTS de server/lib/theme.js */
export const HEADING_FONTS: readonly string[] = ['Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter'];
export const BODY_FONTS: readonly string[] = ['Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans'];

export type ColorKey = keyof Theme['colors'];

export const COLOR_FIELDS: readonly { key: ColorKey; label: string }[] = [
  { key: 'primary', label: 'Couleur primaire' },
  { key: 'secondary', label: 'Couleur secondaire' },
  { key: 'background', label: 'Couleur de fond' },
  { key: 'text', label: 'Couleur du texte' },
];

// Palettes prêtes à l'emploi (couleurs hex + polices autorisées + radius valide)
export const THEME_PRESETS: readonly { name: string; theme: Theme }[] = [
  { name: '🥖 Artisan chaleureux', theme: { colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAF7F2', text: '#2D241E' }, fonts: { heading: 'Playfair Display', body: 'Inter' }, radius: '12px' } },
  { name: '🌿 Nature apaisante', theme: { colors: { primary: '#4A6B4A', secondary: '#DCE8D5', background: '#F7FAF5', text: '#26332A' }, fonts: { heading: 'Lora', body: 'Karla' }, radius: '10px' } },
  { name: '🖤 Élégance sombre', theme: { colors: { primary: '#C9A227', secondary: '#2A2A2A', background: '#111111', text: '#F2F2F2' }, fonts: { heading: 'Outfit', body: 'Inter' }, radius: '4px' } },
  { name: '🌊 Moderne océan', theme: { colors: { primary: '#2C6E7F', secondary: '#D6ECF0', background: '#FBFDFE', text: '#1C2B30' }, fonts: { heading: 'Space Grotesk', body: 'DM Sans' }, radius: '14px' } },
  { name: '🌸 Doux pastel', theme: { colors: { primary: '#9E4B74', secondary: '#F5E1EC', background: '#FFF9FC', text: '#3A2A33' }, fonts: { heading: 'Outfit', body: 'Plus Jakarta Sans' }, radius: '16px' } },
];

// "0" ou un nombre suivi de px, rem, em ou % (comme CSS_DIMENSION côté serveur)
const CSS_DIMENSION = /^(0|[0-9]{1,4}(\.[0-9]{1,3})?(px|rem|em|%))$/;

export function isCssDimension(value: string): boolean {
  return CSS_DIMENSION.test(value.trim());
}

export interface ThemeErrors {
  colors: Partial<Record<ColorKey, string>>;
  heading?: string;
  body?: string;
  radius?: string;
  logo?: string;
}

// Logo : image de la médiathèque du site uniquement (mêmes règles que logoFilename de
// server/lib/theme.js et que isPublishableMediaName de server/lib/media-policy.js).
export const LOGO_API_PREFIX = '/api/media/file/';
const LOGO_PATH_CHARS = /^[A-Za-z0-9_.!~*'()%-]+$/;
const LOGO_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'gif', 'avif']);
export const LOGO_ERROR = 'Logo invalide : téléversez une image PNG, JPEG, WebP, GIF ou AVIF avec le bouton 📤.';

// Vrai si la valeur désigne une image publiable de la médiathèque (/api/media/file/<nom>).
export function isValidLogo(value: string): boolean {
  if (value.length > 512 || !value.startsWith(LOGO_API_PREFIX)) return false;
  const encoded = value.slice(LOGO_API_PREFIX.length);
  if (!LOGO_PATH_CHARS.test(encoded)) return false;
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > 255 || name.startsWith('.') || /[/\\\u0000-\u001f\u007f]/.test(name)) return false;
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 && LOGO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

// Erreurs de validation champ par champ, ou null si le serveur acceptera le thème.
export function validateTheme(theme: Theme): ThemeErrors | null {
  const errors: ThemeErrors = { colors: {} };
  let invalid = false;
  for (const { key } of COLOR_FIELDS) {
    if (!isHexColor((theme.colors?.[key] ?? '').trim())) {
      errors.colors[key] = 'Code hexadécimal attendu (ex. #1A2B3C).';
      invalid = true;
    }
  }
  if (!HEADING_FONTS.includes(theme.fonts?.heading)) {
    errors.heading = 'Police non disponible pour le site : choisissez-en une dans la liste.';
    invalid = true;
  }
  if (!BODY_FONTS.includes(theme.fonts?.body)) {
    errors.body = 'Police non disponible pour le site : choisissez-en une dans la liste.';
    invalid = true;
  }
  if (!isCssDimension(theme.radius ?? '')) {
    errors.radius = 'Valeur attendue : 0 ou un nombre suivi de px, rem, em ou % (ex. 12px).';
    invalid = true;
  }
  const logo = (theme.logo ?? '').trim();
  if (logo && !isValidLogo(logo)) {
    errors.logo = LOGO_ERROR;
    invalid = true;
  }
  return invalid ? errors : null;
}

export interface ContrastWarning {
  code: 'text-background' | 'primary-background' | 'text-secondary';
  ratio: number;
  message: string;
}

const CONTRAST_CHECKS: readonly { code: ContrastWarning['code']; fg: ColorKey; bg: ColorKey; label: string }[] = [
  { code: 'text-background', fg: 'text', bg: 'background', label: 'Texte peu lisible sur le fond' },
  { code: 'primary-background', fg: 'primary', bg: 'background', label: 'Couleur primaire peu lisible sur le fond (liens, prix, icônes)' },
  { code: 'text-secondary', fg: 'text', bg: 'secondary', label: 'Texte peu lisible sur la couleur secondaire (grille de produits, encadrés)' },
];

// Avertissements de lisibilité (WCAG AA, 4,5:1) : MÊMES codes et messages que
// themeContrastWarnings (server/lib/theme.js). Jamais bloquants.
export function contrastWarnings(theme: Theme): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  for (const { code, fg, bg, label } of CONTRAST_CHECKS) {
    const a = (theme.colors?.[fg] ?? '').trim();
    const b = (theme.colors?.[bg] ?? '').trim();
    if (!isHexColor(a) || !isHexColor(b)) continue;
    const r = contrastRatio(a, b);
    if (r >= AA_RATIO) continue;
    const ratio = Math.floor(r * 10) / 10;
    warnings.push({ code, ratio, message: `${label} : contraste ${String(ratio).replace('.', ',')}:1, 4,5:1 minimum recommandé.` });
  }
  return warnings;
}

// Thème reçu du serveur → valeurs toujours des chaînes (un champ manquant devient « » et
// est signalé par validateTheme, jamais remplacé en silence par une valeur par défaut).
export function coerceTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_THEME);
  const t = raw as { colors?: Record<string, unknown>; fonts?: Record<string, unknown>; radius?: unknown; logo?: unknown };
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const logo = str(t.logo).trim();
  return {
    colors: {
      primary: str(t.colors?.primary),
      secondary: str(t.colors?.secondary),
      background: str(t.colors?.background),
      text: str(t.colors?.text),
    },
    fonts: { heading: str(t.fonts?.heading), body: str(t.fonts?.body) },
    radius: str(t.radius),
    // Logo seulement s'il est renseigné (clé absente = pas de logo)
    ...(logo ? { logo } : {}),
  };
}

// Thème tel qu'envoyé au serveur : espaces superflus retirés ; logo vide retiré (pas de logo).
export function normalizeTheme(theme: Theme): Theme {
  const logo = (theme.logo ?? '').trim();
  return {
    colors: {
      primary: theme.colors.primary.trim(),
      secondary: theme.colors.secondary.trim(),
      background: theme.colors.background.trim(),
      text: theme.colors.text.trim(),
    },
    fonts: { ...theme.fonts },
    radius: theme.radius.trim(),
    ...(logo ? { logo } : {}),
  };
}
