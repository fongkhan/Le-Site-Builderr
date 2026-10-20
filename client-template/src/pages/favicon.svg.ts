// Icône d'onglet par défaut (site sans logo) : initiales du site sur la couleur primaire
// du thème, texte de la couleur lisible sur primaire (theme.css généré par le serveur).
// Générée au build en fichier statique (dist/favicon.svg).
import type { APIRoute } from 'astro';
import themeCss from '../styles/theme.css?raw';
import { monogramSvg, themeCssColor } from '../lib/monogram.mjs';

export const GET: APIRoute = () => {
  const svg = monogramSvg({
    name: process.env.PUBLIC_SITE_NAME || '',
    background: themeCssColor(themeCss, 'primary'),
    foreground: themeCssColor(themeCss, 'on-primary') || '#ffffff',
  });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
};
