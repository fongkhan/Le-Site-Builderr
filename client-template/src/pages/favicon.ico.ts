// favicon.ico (navigateurs qui ignorent l'icône SVG) : carré aux coins arrondis de la
// couleur primaire du thème. Généré au build en fichier statique (dist/favicon.ico).
import type { APIRoute } from 'astro';
import themeCss from '../styles/theme.css?raw';
import { themeCssColor } from '../lib/monogram.mjs';
import { icoFromPng, solidIconPng } from '../lib/ico.mjs';

export const GET: APIRoute = () => {
  const ico = icoFromPng(solidIconPng(themeCssColor(themeCss, 'primary') || '#3b82f6', 32), 32);
  return new Response(new Uint8Array(ico), { headers: { 'Content-Type': 'image/x-icon' } });
};
