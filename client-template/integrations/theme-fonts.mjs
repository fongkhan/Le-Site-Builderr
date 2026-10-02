// Polices auto-hébergées (RGPD) : plus aucune requête vers Google Fonts, qui transmettait
// l'adresse IP du visiteur à Google avant tout consentement.
//
// Seules les 2 familles du thème (titres + corps) sont déclarées, en sous-ensemble latin
// (couvre le français : accents, œ, €, guillemets), depuis les paquets npm
// @fontsource-variable/* (polices variables, un seul fichier woff2 par famille). Vite
// copie les fichiers dans _astro/ (préfixés par le chemin de base) : le site publié est
// autonome.
//
// Le thème (src/styles/theme.css : --font-heading / --font-body) est écrit par le serveur
// avant chaque build ; il est relu à chaque chargement du module virtuel.
//
// Usage : import 'virtual:theme-fonts.css' (Layout.astro).

import fs from 'node:fs';
import { createRequire } from 'node:module';

// Allowlist du serveur (server/lib/theme.js) → paquet @fontsource-variable/<id>
export const FONT_PACKAGES = {
  'Inter': 'inter',
  'DM Sans': 'dm-sans',
  'Karla': 'karla',
  'Plus Jakarta Sans': 'plus-jakarta-sans',
  'Playfair Display': 'playfair-display',
  'Outfit': 'outfit',
  'Space Grotesk': 'space-grotesk',
  'Lora': 'lora',
};

const DEFAULT_FAMILIES = ['Inter']; // base.css : repli si theme.css est absent
const VIRTUAL_ID = 'virtual:theme-fonts.css';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Familles (dédupliquées) déclarées par --font-heading et --font-body dans un CSS de thème. */
export function themeFontFamilies(css) {
  const pick = (name) => {
    const m = String(css || '').match(new RegExp(`--font-${name}\\s*:\\s*['"]?([^'",;]+)`));
    return m ? m[1].trim() : null;
  };
  return [...new Set([pick('heading'), pick('body')].filter(Boolean))];
}

/**
 * @font-face (sous-ensemble latin, axe de graisse) d'une famille de l'allowlist, ou ''
 * si la famille est inconnue ou si son paquet n'est pas installé (repli sur les
 * polices système, jamais sur Google).
 */
export function latinFontFace(family, require) {
  const id = FONT_PACKAGES[family];
  if (!id) return '';
  const pkg = `@fontsource-variable/${id}`;
  let css;
  try {
    css = fs.readFileSync(require.resolve(`${pkg}/wght.css`), 'utf-8');
  } catch {
    console.warn(`[polices] Paquet ${pkg} absent (npm install dans client-template) : « ${family} » remplacée par une police système.`);
    return '';
  }
  const block = css.match(new RegExp(`/\\* ${id}-latin-wght-normal \\*/\\s*(@font-face\\s*\\{[^}]*\\})`));
  if (!block) return '';
  return block[1]
    // Nom exact utilisé par le thème (« 'Inter', sans-serif »), pas « Inter Variable »
    .replace(/font-family:[^;]+;/, `font-family: '${family}';`)
    // Fichier résolu par Vite depuis le paquet (copié et haché dans _astro/)
    .replace(/url\(\.\/files\//, `url(${pkg}/files/`);
}

/** Plugin Vite : module CSS virtuel des polices du thème. */
export function themeFonts({ themeCssPath, root }) {
  const require = createRequire(root);
  return {
    name: 'theme-fonts',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      let families = DEFAULT_FAMILIES;
      try {
        const found = themeFontFamilies(fs.readFileSync(themeCssPath, 'utf-8'));
        if (found.length > 0) families = found;
      } catch { /* thème absent : polices par défaut */ }
      const faces = families.map((f) => latinFontFace(f, require)).filter(Boolean);
      return `/* Polices du thème (auto-hébergées) : ${families.join(', ')} */\n${faces.join('\n')}\n`;
    },
  };
}
