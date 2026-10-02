// Vérifie le site généré à partir de la fixture (CI) :
//   TEMPLATE_FIXTURE=$PWD/fixtures/site.json SITE_BASE_PATH=/preview/demo npm run build
//   node scripts/check-fixture-build.mjs /preview/demo
// Contrôles : pages attendues, ressources et liens préfixés par le chemin de base,
// aucun lien exécutable ni mort, aucune requête Google Fonts, JSON-LD valides.
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] || '/').replace(/\/+$/, '');
const dist = path.resolve('dist');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const htmlFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
})(dist);

for (const page of ['index.html', 'en/index.html', 'blog/index.html']) {
  check(fs.existsSync(path.join(dist, page)), `page attendue absente : ${page}`);
}
check(htmlFiles.length >= 5, `trop peu de pages générées (${htmlFiles.length})`);

const home = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html'), 'utf-8') : '';
for (const block of ['hero', 'features', 'product', 'gallery', 'testimonial', 'faq', 'pricing', 'contact', 'rendez-vous', 'info', 'footer']) {
  check(home.toLowerCase().includes(block), `bloc introuvable sur l'accueil : ${block}`);
}

for (const file of htmlFiles) {
  const rel = path.relative(dist, file);
  const html = fs.readFileSync(file, 'utf-8');
  check(!/href\s*=\s*["']\s*javascript:/i.test(html), `${rel} : lien javascript:`);
  check(!/href\s*=\s*["']#["']/.test(html), `${rel} : lien mort href="#"`);
  check(!html.includes('fonts.googleapis.com'), `${rel} : requête Google Fonts`);
  for (const [, url] of html.matchAll(/<(?:link|script)[^>]+(?:href|src)="(\/[^"]*)"/g)) {
    check(url.startsWith(`${base}/`), `${rel} : ressource non préfixée par ${base || '/'} : ${url}`);
  }
  for (const [, href] of html.matchAll(/<a[^>]+href="(\/[^"]*)"/g)) {
    check(href.startsWith(`${base}/`), `${rel} : lien interne non préfixé : ${href}`);
  }
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(json); } catch { failures.push(`${rel} : JSON-LD invalide`); }
  }
  const businesses = (html.match(/"@type":"LocalBusiness"/g) || []).length;
  check(businesses <= 1, `${rel} : ${businesses} entités LocalBusiness`);
}

// ---- Structure accessible, libellés traduits et page 404 ----
// Structure accessible (un <main> ciblé par le lien d'évitement, un seul h1, pieds de page
// hors du <main>), libellés d'interface traduits et page 404.
const readDist = (rel) => (fs.existsSync(path.join(dist, rel)) ? fs.readFileSync(path.join(dist, rel), 'utf-8') : '');
for (const file of htmlFiles) {
  const rel = path.relative(dist, file);
  const html = fs.readFileSync(file, 'utf-8');
  const mains = (html.match(/<main[\s>]/g) || []).length;
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  check(mains === 1, `${rel} : ${mains} élément(s) <main> (1 attendu)`);
  check(h1s === 1, `${rel} : ${h1s} titre(s) <h1> (1 attendu)`);
  const mainHtml = html.slice(html.search(/<main[\s>]/), html.indexOf('</main>'));
  check(!/<footer[\s>]/.test(mainHtml), `${rel} : <footer> à l'intérieur de <main>`);
  check(html.includes('href="#contenu"'), `${rel} : lien d'évitement (href="#contenu") absent`);
  check(/<main[^>]*\sid="contenu"/.test(html), `${rel} : <main id="contenu"> absent`);
}

const homeEn = readDist('en/index.html');
for (const fr of ['Votre nom', 'Navigation principale', 'Réseaux sociaux']) {
  check(!homeEn.includes(fr), `en/index.html : libellé français « ${fr} »`);
}
check(homeEn.includes('Your name'), 'en/index.html : libellé anglais « Your name » absent');
check(home.includes('Votre nom'), 'index.html : libellé « Votre nom » absent');

const notFound = readDist('404.html');
check(notFound !== '', 'page 404.html absente');
check(/<meta name="robots" content="noindex/.test(notFound), '404.html : meta robots noindex absente');
check(notFound.includes(`href="${base}/"`), `404.html : lien vers l'accueil (${base}/) absent`);
check(!fs.existsSync(path.join(dist, '404', 'index.html')), 'route 404/index.html générée par la route attrape-tout');

// ---- Pages masquées du menu ----
// Page masquée du menu (hideFromNav) : générée, mais aucun lien du menu ne la cible ;
// le menu commence par l'accueil.
{
  check(fs.existsSync(path.join(dist, 'mentions-legales/index.html')), 'page masquée du menu absente : mentions-legales/index.html');
  for (const file of htmlFiles) {
    const rel = path.relative(dist, file);
    const html = fs.readFileSync(file, 'utf-8');
    const nav = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
    if (!nav) continue;
    const hrefs = [...nav[1].matchAll(/<a[^>]+href="([^"]*)"/g)].map(([, href]) => href);
    check(!hrefs.some((href) => href.includes('/mentions-legales')), `${rel} : la page masquée figure dans le menu`);
    if (!rel.startsWith('en/')) check(hrefs[0] === `${base}/`, `${rel} : le premier lien du menu n'est pas l'accueil (${hrefs[0]})`);
  }
}

if (failures.length) {
  console.error(`✖ ${failures.length} problème(s) dans le site généré :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ Site généré conforme (${htmlFiles.length} pages, base « ${base || '/'} »).`);
