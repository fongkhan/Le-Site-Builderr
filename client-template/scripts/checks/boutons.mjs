// Liens des boutons d'action (champ ctaLink de la fixture) : page du site préfixée par le
// chemin de base, adresse web en nouvel onglet, téléphone, email ; liens refusés (javascript:,
// //hôte) ou introuvables (page supprimée, ancre absente) remplacés par le mode Automatique.

// Balises <a …> dont l'attribut href vaut exactement `href`.
const tagsWith = (html, href) => [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]).filter((t) => t.includes(`href="${href}"`));
const hasClass = (tag, name) => new RegExp(`\\sclass="[^"]*\\b${name}\\b`).test(tag);

export default async function ({ dist, base, htmlFiles, readDist, check }) {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const home = readDist('index.html');
  check(tagsWith(home, `${base}/cours/`).some((t) => hasClass(t, 'cta-button')), `index.html : bouton du Hero vers ${base}/cours/ absent`);
  const booking = tagsWith(home, 'https://reservation.example/atelier-demo');
  check(booking.length === 1, `index.html : ${booking.length} lien(s) vers https://reservation.example/atelier-demo (1 attendu)`);
  check(booking.every((t) => t.includes('target="_blank"') && t.includes('rel="noopener noreferrer"')), 'index.html : lien externe sans target="_blank" ni rel="noopener noreferrer"');
  check(home.includes('(nouvel onglet)'), 'index.html : mention « (nouvel onglet) » absente');
  check(tagsWith(home, 'tel:+33612345678').some((t) => hasClass(t, 'buy-button')), 'index.html : bouton « Commander » vers tel:+33612345678 absent');
  check(!home.includes('page-supprimee'), 'index.html : lien vers une page supprimée rendu');

  const cours = readDist('cours/index.html');
  check(tagsWith(cours, `${base}/#rendez-vous`).some((t) => hasClass(t, 'cta-button')), `cours/index.html : bouton du Hero vers ${base}/#rendez-vous absent (ancre absente de la page)`);
  check(!cours.includes('href="#rendez-vous"'), 'cours/index.html : ancre absente de la page rendue telle quelle');
  check(tagsWith(cours, 'mailto:bonjour@atelier-demo.example').length > 0, 'cours/index.html : bouton mailto: de la formule absent');

  const ateliers = readDist('ateliers/index.html');
  check(tagsWith(ateliers, `${base}/mentions-legales/`).some((t) => hasClass(t, 'cta-button')), `ateliers/index.html : bouton vers ${base}/mentions-legales/ absent`);

  const about = readDist('en/about/index.html');
  check(tagsWith(about, `${base}/en/#contact`).some((t) => hasClass(t, 'cta-button')), `en/about/index.html : bouton de repli vers ${base}/en/#contact absent`);

  for (const file of htmlFiles) {
    const rel = path.relative(dist, file);
    const html = fs.readFileSync(file, 'utf-8');
    check(!html.includes('evil.example'), `${rel} : lien refusé (evil.example) rendu`);
    check(!/href="\/\//.test(html), `${rel} : lien « //hôte » rendu`);
  }
}
