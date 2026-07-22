// Validation de thème — fonctions pures, importables sans booter le serveur.
// Les valeurs de thème sont interpolées telles quelles dans theme.css (writeThemeCss) :
// sans validation, une couleur ou un radius arbitraire permet une injection CSS
// (fermeture de bloc, @import, url(...)) et une police hors-liste casse le rendu.
// L'allowlist de polices est la source de vérité partagée avec l'IA (ai.js) et le
// front (DesignPage.tsx) : la garder synchronisée.

const HEADING_FONTS = ['Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter'];
const BODY_FONTS = ['Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans'];
const COLOR_KEYS = ['primary', 'secondary', 'background', 'text'];

// #RGB, #RRGGBB ou #RRGGBBAA — rien d'autre (pas de rgb()/nom/url pour bloquer l'injection)
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Dimension CSS simple : "0" ou un nombre suivi d'une unité autorisée
const CSS_DIMENSION = /^(0|[0-9]{1,4}(\.[0-9]{1,3})?(px|rem|em|%))$/;

function isHexColor(v) {
  return typeof v === 'string' && HEX_COLOR.test(v.trim());
}

function isCssDimension(v) {
  return typeof v === 'string' && CSS_DIMENSION.test(v.trim());
}

// Valide l'objet thème interne { colors, fonts, radius }.
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

  return { ok: true };
}

module.exports = { HEADING_FONTS, BODY_FONTS, COLOR_KEYS, isHexColor, isCssDimension, validateTheme };
