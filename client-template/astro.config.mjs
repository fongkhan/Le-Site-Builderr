// @ts-check
import { defineConfig } from 'astro/config';
import { themeFonts } from './integrations/theme-fonts.mjs';
import { sitePolicy } from './src/lib/csp.mjs';

// Chemin de base sous lequel le site est servi, fourni par le serveur de build :
// « / » (production, racine du domaine), « /preview/<slug> » (publication simulée) ou
// « /draft/<slug> » (brouillon). Astro préfixe CSS et JS ; les liens internes passent
// par withBase() (src/lib/url.ts).
const rawBase = (process.env.SITE_BASE_PATH || '/').trim();
const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}`;

// https://astro.build/config
export default defineConfig({
  base,
  // CSP de chaque page (<meta http-equiv>) : scripts et styles traités par Astro hachés,
  // aucun 'unsafe-inline' ; hôte de mesure d'audience et origine de l'API autorisés
  // d'après l'environnement du build (src/lib/csp.mjs).
  security: {
    csp: sitePolicy({
      apiBase: process.env.PUBLIC_API_BASE,
      analyticsProvider: process.env.PUBLIC_ANALYTICS_PROVIDER,
      analyticsId: process.env.PUBLIC_ANALYTICS_ID,
      analyticsHost: process.env.PUBLIC_ANALYTICS_HOST,
    }),
  },
  // Pas de coloration syntaxique (styles en ligne refusés par la CSP)
  markdown: { syntaxHighlight: false },
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
