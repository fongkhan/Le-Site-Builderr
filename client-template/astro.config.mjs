// @ts-check
import { defineConfig } from 'astro/config';
import { themeFonts } from './integrations/theme-fonts.mjs';

// Chemin de base sous lequel le site est servi, fourni par le serveur de build :
// « / » (production, racine du domaine), « /preview/<slug> » (publication simulée) ou
// « /draft/<slug> » (brouillon). Astro préfixe CSS et JS ; les liens internes passent
// par withBase() (src/lib/url.ts).
const rawBase = (process.env.SITE_BASE_PATH || '/').trim();
const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}`;

// https://astro.build/config
export default defineConfig({
  base,
  vite: {
    plugins: [
      // Polices du thème auto-hébergées (aucune requête vers Google Fonts)
      themeFonts({
        themeCssPath: new URL('./src/styles/theme.css', import.meta.url),
        root: import.meta.url,
      }),
    ],
  },
});
