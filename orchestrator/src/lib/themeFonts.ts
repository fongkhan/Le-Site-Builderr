import { useEffect } from 'react';

// Polices des thèmes (aperçus Design et CMS) : auto-hébergées (@fontsource-variable),
// jamais demandées à Google. Chaque famille est une feuille CSS découpée par Vite
// (import dynamique) et chargée seulement quand un aperçu l'affiche.

/** Chargement de la feuille d'une famille (résolu quand la feuille est appliquée). */
export type FontLoader = () => Promise<unknown>;

/**
 * Familles proposées par les thèmes (HEADING_FONTS ∪ BODY_FONTS de themeOptions.ts,
 * mêmes listes que server/lib/theme.js). Chemins littéraux : Vite ne découpe que les
 * import() qu'il peut résoudre au build.
 */
export const FONT_LOADERS: Readonly<Record<string, FontLoader>> = {
  'DM Sans': () => import('@fontsource-variable/dm-sans/wght.css'),
  Inter: () => import('@fontsource-variable/inter/wght.css'),
  Karla: () => import('@fontsource-variable/karla/wght.css'),
  Lora: () => import('@fontsource-variable/lora/wght.css'),
  Outfit: () => import('@fontsource-variable/outfit/wght.css'),
  'Playfair Display': () => import('@fontsource-variable/playfair-display/wght.css'),
  'Plus Jakarta Sans': () => import('@fontsource-variable/plus-jakarta-sans/wght.css'),
  'Space Grotesk': () => import('@fontsource-variable/space-grotesk/wght.css'),
};

const isKnown = (loaders: Readonly<Record<string, FontLoader>>, family: unknown): family is string =>
  typeof family === 'string' && Object.hasOwn(loaders, family);

/**
 * Pile CSS d'une police de thème : version variable auto-hébergée, nom d'origine (police
 * installée sur le poste), puis famille générique. Famille inconnue : générique seule
 * (aucun nom saisi n'est recopié dans le CSS).
 */
export function fontStack(family: string, generic: string): string {
  return isKnown(FONT_LOADERS, family) ? `'${family} Variable', '${family}', ${generic}` : generic;
}

/**
 * Chargeur de familles : chaque famille connue n'est demandée qu'une fois (doublons de
 * l'entrée compris) ; une famille inconnue est ignorée. Ne rejette jamais : en cas
 * d'échec (réseau), la famille est oubliée pour être retentée au prochain appel.
 */
export function createFontLoader(loaders: Readonly<Record<string, FontLoader>>) {
  const requested = new Set<string>();
  return function loadFonts(families: readonly unknown[]): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const family of new Set(families)) {
      if (!isKnown(loaders, family) || requested.has(family)) continue;
      requested.add(family);
      // Appel synchrone (une exception devient un rejet), échec absorbé
      const loading = new Promise<unknown>((resolve) => resolve(loaders[family]()));
      pending.push(loading.then(() => undefined, () => { requested.delete(family); }));
    }
    return Promise.all(pending).then(() => undefined);
  };
}

/** Chargeur partagé par les aperçus de l'application. */
export const loadThemeFonts = createFontLoader(FONT_LOADERS);

/** Charge les polices d'un thème affiché (titres et corps) ; rechargé si elles changent. */
export function useThemeFonts(heading: string, body: string): void {
  useEffect(() => {
    void loadThemeFonts([heading, body]);
  }, [heading, body]);
}
