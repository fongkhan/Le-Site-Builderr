// Identité du site publié : en-tête de marque, icônes d'onglet, couleur du navigateur et
// texte lisible sur la couleur primaire.
// Option : --logo=/media/<nom> pour le build fait avec PUBLIC_SITE_LOGO (sans elle : site
// sans logo, nom du site et icône générée). Fixture construite avec PUBLIC_SITE_NAME=Demo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { themeCssColor } from '../../src/lib/monogram.mjs';

const SITE_NAME = 'Demo';

// Règles CSS qui posent un texte blanc fixe sur la couleur primaire (illisible sur un
// primaire clair) : déclarations dans un ordre quelconque, espaces tolérés.
export function whiteOnPrimaryRules(css) {
  const found = [];
  for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const onPrimary = /(?:^|[;\s])background(?:-color)?\s*:\s*var\(\s*--color-primary\s*\)/i.test(body);
    const white = /(?:^|[;\s])color\s*:\s*(?:#fff(?:fff)?|white)\s*(?:!important\s*)?(?:;|$)/i.test(body);
    if (onPrimary && white) found.push(selector.trim());
  }
  return found;
}

const inlineStyles = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

export default async function ({ dist, base, htmlFiles, readDist, check }) {
  const logoArg = process.argv.find((a) => a.startsWith('--logo='));
  const logoUrl = logoArg ? `${base}${logoArg.slice('--logo='.length)}` : '';
  // Couleur primaire du thème compilé (theme.css du template, thème par défaut en CI)
  const themeCss = fs.readFileSync(new URL('../../src/styles/theme.css', import.meta.url), 'utf-8');
  const primary = themeCssColor(themeCss, 'primary');
  check(Boolean(primary), 'theme.css : --color-primary introuvable');
  // Icônes générées : adresse versionnée par le contenu publié de favicon.svg (cache long)
  const svg = readDist('favicon.svg');
  const iconVersion = crypto.createHash('sha256').update(svg).digest('hex').slice(0, 10);

  for (const file of htmlFiles) {
    const rel = path.relative(dist, file);
    const html = fs.readFileSync(file, 'utf-8');
    const header = (html.match(/<header class="site-header">([\s\S]*?)<\/header>/) || [])[1];
    check(header !== undefined, `${rel} : en-tête de marque <header class="site-header"> absent`);
    check(!/<h1[\s>]/.test(header || ''), `${rel} : titre <h1> dans l'en-tête`);
    const brand = (html.match(/<a class="site-brand" href="([^"]*)"/) || [])[1];
    const home = rel.split(path.sep)[0] === 'en' ? `${base}/en/` : `${base}/`;
    check(brand === home, `${rel} : la marque mène à ${brand} (attendu ${home})`);
    if (logoUrl) {
      check(html.includes(`<img class="site-brand-logo" src="${logoUrl}" alt="${SITE_NAME}"`), `${rel} : logo de l'en-tête absent (${logoUrl})`);
      check(html.includes(`<link rel="icon" href="${logoUrl}">`), `${rel} : icône d'onglet du logo absente`);
      check(html.includes(`<link rel="apple-touch-icon" href="${logoUrl}">`), `${rel} : apple-touch-icon du logo absente`);
      check(!html.includes('favicon.svg'), `${rel} : icône générée annoncée malgré le logo`);
    } else {
      check(html.includes(`<span class="site-brand-name">${SITE_NAME}</span>`), `${rel} : nom du site absent de l'en-tête`);
      check(html.includes(`<link rel="icon" type="image/svg+xml" href="${base}/favicon.svg?v=${iconVersion}">`), `${rel} : icône d'onglet ${base}/favicon.svg?v=${iconVersion} absente`);
      check(html.includes(`<link rel="icon" href="${base}/favicon.ico?v=${iconVersion}" sizes="32x32">`), `${rel} : icône ${base}/favicon.ico?v=${iconVersion} absente`);
      check(!html.includes('site-brand-logo'), `${rel} : logo affiché sans logo configuré`);
    }
    check(html.includes(`<meta name="theme-color" content="${primary}">`), `${rel} : <meta name="theme-color" content="${primary}"> absente`);
    const bad = whiteOnPrimaryRules(inlineStyles(html));
    check(bad.length === 0, `${rel} : texte blanc fixe sur la couleur primaire (${bad.join(' | ')})`);
  }

  // Icônes générées (initiales du site sur la couleur primaire)
  check(svg.startsWith('<svg'), 'favicon.svg absente ou invalide');
  check(svg.includes(`fill="${primary}"`), `favicon.svg : couleur primaire ${primary} absente`);
  check(svg.includes(`>${SITE_NAME[0]}<`), `favicon.svg : initiale « ${SITE_NAME[0]} » absente`);
  check(!svg.includes('M50.4 78.5'), 'favicon.svg : icône Astro par défaut');
  const icoPath = path.join(dist, 'favicon.ico');
  const ico = fs.existsSync(icoPath) ? fs.readFileSync(icoPath) : Buffer.alloc(0);
  check(ico.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])), 'favicon.ico : en-tête ICO absent');
  check(ico.subarray(22, 30).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'favicon.ico : image PNG absente à l\'octet 22');

  // Feuilles de style : couleurs dérivées présentes, aucun texte blanc fixe sur le primaire
  const astroDir = path.join(dist, '_astro');
  const bundled = fs.existsSync(astroDir)
    ? fs.readdirSync(astroDir).filter((n) => n.endsWith('.css')).map((n) => fs.readFileSync(path.join(astroDir, n), 'utf-8')).join('\n')
    : '';
  const css = `${bundled}\n${inlineStyles(readDist('index.html'))}`;
  for (const variable of ['--color-on-primary', '--color-surface']) {
    check(css.includes(variable), `CSS : variable ${variable} absente`);
  }
  const bad = whiteOnPrimaryRules(bundled);
  check(bad.length === 0, `_astro/*.css : texte blanc fixe sur la couleur primaire (${bad.join(' | ')})`);
}
