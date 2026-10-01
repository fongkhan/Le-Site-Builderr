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

if (failures.length) {
  console.error(`✖ ${failures.length} problème(s) dans le site généré :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ Site généré conforme (${htmlFiles.length} pages, base « ${base || '/'} »).`);
