// Validation de thème — fonctions pures, importables sans booter le serveur.
// Les valeurs de thème sont interpolées telles quelles dans theme.css (writeThemeCss) :
// sans validation, une couleur ou un radius arbitraire permet une injection CSS
// (fermeture de bloc, @import, url(...)) et une police hors-liste casse le rendu.
// L'allowlist de polices est la source de vérité partagée avec l'IA (ai.js) et le
// front (orchestrator/src/features/design/themeOptions.ts, vérifiée par un test) : la garder synchronisée.
const { isPublishableMediaName } = require('./media-policy');
const { encodeMediaName } = require('./media');

const HEADING_FONTS = ['Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter'];
const BODY_FONTS = ['Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans'];
const COLOR_KEYS = ['primary', 'secondary', 'background', 'text'];

// #RGB, #RRGGBB ou #RRGGBBAA — rien d'autre (pas de rgb()/nom/url pour bloquer l'injection)
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Dimension CSS simple : "0" ou un nombre suivi d'une unité autorisée
const CSS_DIMENSION = /^(0|[0-9]{1,4}(\.[0-9]{1,3})?(px|rem|em|%))$/;

const LOGO_ERROR = 'Logo invalide : choisissez une image PNG, JPEG, WebP, GIF ou AVIF téléversée dans la médiathèque du site.';

function isHexColor(v) {
  return typeof v === 'string' && HEX_COLOR.test(v.trim());
}

function isCssDimension(v) {
  return typeof v === 'string' && CSS_DIMENSION.test(v.trim());
}

// --- Contraste (WCAG 2.x) ---
// MÊMES calculs que orchestrator/src/lib/color.ts (aperçu et avertissements de la page
// Design) : les garder identiques.

// '#rrggbb' minuscule sans canal alpha, ou null si la valeur n'est pas une couleur hex.
function hex6(c) {
  if (!isHexColor(c)) return null;
  const hex = c.trim().slice(1).toLowerCase();
  if (hex.length === 3) return `#${hex.split('').map((ch) => ch + ch).join('')}`;
  return `#${hex.slice(0, 6)}`;
}

// Luminance relative (0 = noir, 1 = blanc). Valeur invalide : noir (comme le front).
function relativeLuminance(c) {
  const hex = (hex6(c) || '#000000').slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Rapport de contraste entre deux couleurs (de 1 à 21).
function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Seuil AA pour un texte courant.
const AA_RATIO = 4.5;

// Couleur de texte lisible sur un fond : la première de [...prefer, blanc, gris très
// foncé, noir] qui atteint 4,5:1. Le noir atteint toujours au moins 4,67:1 quand le blanc
// échoue : le repli final ne sert qu'en défense. Couleur renvoyée telle que fournie
// (canal alpha retiré : le contraste est calculé sans transparence).
function readableOn(bg, prefer = []) {
  for (const candidate of [...prefer, '#ffffff', '#111111', '#000000']) {
    if (!isHexColor(candidate)) continue;
    if (contrastRatio(candidate, bg) >= AA_RATIO) {
      const value = candidate.trim();
      return value.length === 9 ? hex6(value) : value;
    }
  }
  return '#000000';
}

// Mélange sRGB canal par canal : t = 0 → a, t = 1 → b. Résultat '#rrggbb'.
function mixHex(a, b, t) {
  const ha = (hex6(a) || '#000000').slice(1);
  const hb = (hex6(b) || '#000000').slice(1);
  let out = '#';
  for (const i of [0, 2, 4]) {
    const ca = parseInt(ha.slice(i, i + 2), 16);
    const cb = parseInt(hb.slice(i, i + 2), 16);
    out += Math.round(ca + (cb - ca) * t).toString(16).padStart(2, '0');
  }
  return out;
}

// Couleurs dérivées du thème, publiées dans theme.css pour le template :
// - onPrimary / onSecondary : texte des boutons et bandeaux posés sur ces couleurs ;
// - primaryDeep : second ton du dégradé du Hero (même sens que le texte : plus lisible) ;
// - surface : fond des cartes (blanc, ou fond légèrement éclairci sur un thème sombre) ;
// - textMuted : texte secondaire (descriptions, dates) lisible sur la surface et le fond.
function derivedColors(colors) {
  const { primary, secondary, background, text } = colors || {};
  const onPrimary = readableOn(primary);
  const onSecondary = readableOn(secondary, [text, '#111111']);
  const primaryDeep = mixHex(primary, relativeLuminance(onPrimary) > 0.5 ? '#000000' : '#ffffff', 0.35);
  const surface = contrastRatio('#ffffff', background) >= AA_RATIO ? mixHex(background, '#ffffff', 0.06) : '#ffffff';
  let textMuted = hex6(text) || '#000000';
  for (const t of [0.3, 0.2, 0.1]) {
    const muted = mixHex(text, surface, t);
    if (contrastRatio(muted, surface) >= AA_RATIO && contrastRatio(muted, background) >= AA_RATIO) {
      textMuted = muted;
      break;
    }
  }
  return { onPrimary, onSecondary, primaryDeep, surface, textMuted };
}

// Ratio affiché : arrondi vers le bas au dixième, virgule décimale (« 2,8 »).
const formatRatio = (r) => String(Math.floor(r * 10) / 10).replace('.', ',');

const CONTRAST_CHECKS = [
  { code: 'text-background', fg: 'text', bg: 'background', label: 'Texte peu lisible sur le fond' },
  { code: 'primary-background', fg: 'primary', bg: 'background', label: 'Couleur primaire peu lisible sur le fond (liens, prix, icônes)' },
  { code: 'text-secondary', fg: 'text', bg: 'secondary', label: 'Texte peu lisible sur la couleur secondaire (grille de produits, encadrés)' },
];

// Avertissements de lisibilité (jamais bloquants) : [{ code, ratio, message }]. Le texte
// des boutons n'en fait pas partie : il s'adapte seul (onPrimary / onSecondary).
function themeContrastWarnings(theme) {
  const colors = (theme && theme.colors) || {};
  const warnings = [];
  for (const { code, fg, bg, label } of CONTRAST_CHECKS) {
    if (!isHexColor(colors[fg]) || !isHexColor(colors[bg])) continue;
    const r = contrastRatio(colors[fg], colors[bg]);
    if (r >= AA_RATIO) continue;
    const ratio = Math.floor(r * 10) / 10;
    warnings.push({ code, ratio, message: `${label} : contraste ${formatRatio(r)}:1, 4,5:1 minimum recommandé.` });
  }
  return warnings;
}

// Contenu de client-template/src/styles/theme.css pour un thème DÉJÀ validé.
function themeCss(t) {
  const c = t.colors;
  const d = derivedColors(c);
  return `/* Généré automatiquement par l'Orchestrateur */
:root {
  --color-primary: ${c.primary.trim()};
  --color-secondary: ${c.secondary.trim()};
  --color-bg: ${c.background.trim()};
  --color-text: ${c.text.trim()};
  --color-on-primary: ${d.onPrimary};
  --color-on-secondary: ${d.onSecondary};
  --color-primary-deep: ${d.primaryDeep};
  --color-surface: ${d.surface};
  --color-text-muted: ${d.textMuted};
  --font-heading: '${t.fonts.heading}', serif;
  --font-body: '${t.fonts.body}', sans-serif;
  --border-radius: ${t.radius.trim()};
}
`;
}

// --- Logo (image de la médiathèque du site) ---
// Seule forme acceptée : /api/media/file/<nom encodé>. Jamais d'URL externe (site
// autonome, pas d'icône pisteuse) ni de SVG (script exécutable sur le domaine du site).

const LOGO_API_PREFIX = '/api/media/file/';
const LOGO_PATH_CHARS = /^[A-Za-z0-9_.!~*'()%-]+$/;

// Nom de fichier (décodé) désigné par une valeur de logo, ou null si elle est refusée.
function logoFilename(value) {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith(LOGO_API_PREFIX)) return null;
  const encoded = value.slice(LOGO_API_PREFIX.length);
  if (!LOGO_PATH_CHARS.test(encoded)) return null;
  let name;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!name || name.length > 255 || name.startsWith('.') || /[/\\\u0000-\u001f\u007f]/.test(name)) return null;
  return isPublishableMediaName(name) ? name : null;
}

// Forme canonique d'un logo : '' (aucun), URL de la médiathèque ré-encodée, ou null (refusé).
function normalizeLogo(value) {
  if (value === undefined || value === null || value === '') return '';
  const name = logoFilename(value);
  return name ? LOGO_API_PREFIX + encodeMediaName(name) : null;
}

// Logo publiable avec le site : son fichier fait partie des médias du site (ownedNames).
// staticPath : adresse du fichier copié dans le site publié (sous le chemin de base).
function publishableLogo(theme, ownedNames) {
  const name = logoFilename(theme && theme.logo);
  if (!name || !ownedNames || !ownedNames.has(name)) return null;
  const encoded = encodeMediaName(name);
  return { name, apiUrl: LOGO_API_PREFIX + encoded, staticPath: `/media/${encoded}` };
}

// Thème réduit à ses clés connues (aucune clé arbitraire persistée) ; le logo n'est
// gardé que s'il est valide et non vide.
function canonicalTheme(t) {
  const theme = t || {};
  const colors = theme.colors || {};
  const fonts = theme.fonts || {};
  const out = {
    colors: { primary: colors.primary, secondary: colors.secondary, background: colors.background, text: colors.text },
    fonts: { heading: fonts.heading, body: fonts.body },
    radius: theme.radius,
  };
  const logo = normalizeLogo(theme.logo);
  if (logo) out.logo = logo;
  return out;
}

// Valide l'objet thème interne { colors, fonts, radius, logo? }.
// Retourne { ok: true } si valide, sinon { ok: false, error: "<raison>" }.
function validateTheme(theme) {
  if (!theme || typeof theme !== 'object') {
    return { ok: false, error: 'Thème manquant ou invalide.' };
  }
  const { colors, fonts, radius } = theme;

  if (!colors || typeof colors !== 'object') {
    return { ok: false, error: 'Section "colors" manquante.' };
  }
  for (const key of COLOR_KEYS) {
    if (!isHexColor(colors[key])) {
      return { ok: false, error: `Couleur "${key}" invalide : attendu un code hexadécimal (ex. #1A2B3C).` };
    }
  }

  if (!fonts || typeof fonts !== 'object') {
    return { ok: false, error: 'Section "fonts" manquante.' };
  }
  if (!HEADING_FONTS.includes(fonts.heading)) {
    return { ok: false, error: `Police de titre non autorisée : "${fonts.heading}".` };
  }
  if (!BODY_FONTS.includes(fonts.body)) {
    return { ok: false, error: `Police de corps non autorisée : "${fonts.body}".` };
  }

  if (!isCssDimension(radius)) {
    return { ok: false, error: `Rayon de bordure invalide : "${radius}" (ex. 12px, 0, 0.5rem).` };
  }

  if (normalizeLogo(theme.logo) === null) {
    return { ok: false, error: LOGO_ERROR };
  }

  return { ok: true };
}

module.exports = {
  HEADING_FONTS,
  BODY_FONTS,
  COLOR_KEYS,
  isHexColor,
  isCssDimension,
  validateTheme,
  hex6,
  relativeLuminance,
  contrastRatio,
  AA_RATIO,
  readableOn,
  mixHex,
  derivedColors,
  themeContrastWarnings,
  themeCss,
  LOGO_API_PREFIX,
  LOGO_ERROR,
  encodeMediaName,
  logoFilename,
  normalizeLogo,
  publishableLogo,
  canonicalTheme,
};
