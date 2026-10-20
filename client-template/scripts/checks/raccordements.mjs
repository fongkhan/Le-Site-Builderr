// Raccordements entre fonctions sur le site généré : bouton d'une formule vers une page
// légale générée (/confidentialite/, absente des pages du CMS) et logo de l'en-tête
// dimensionné d'après la médiathèque (option --logo, comme identite.mjs).

// Balises <a …> dont l'attribut href vaut exactement `href`.
const tagsWith = (html, href) => [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]).filter((t) => t.includes(`href="${href}"`));

export default async function ({ base, readDist, check }) {
  // Bouton « Lire la politique » de la page « cours » : page légale générée, jamais le
  // repli Automatique (le lien du pied de page vers la même adresse ne compte pas)
  const cours = readDist('cours/index.html');
  const privacy = `${base}/confidentialite/`;
  check(readDist('confidentialite/index.html') !== '', 'confidentialite/index.html : page légale générée absente');
  check(
    tagsWith(cours, privacy).some((t) => /\sclass="cta-btn\b/.test(t)),
    `cours/index.html : bouton de formule vers la page légale générée ${privacy} absent`,
  );

  // Logo (fixture : logo-demo.png, 320 × 80 dans la médiathèque) : 160 × 40 réservés
  const logoArg = process.argv.find((a) => a.startsWith('--logo='));
  if (logoArg) {
    const logoUrl = `${base}${logoArg.slice('--logo='.length)}`;
    const home = readDist('index.html');
    check(
      home.includes(`<img class="site-brand-logo" src="${logoUrl}" alt="Demo" width="160" height="40"`),
      `index.html : logo de l'en-tête sans ses dimensions de la médiathèque (160 × 40 attendus)`,
    );
  }
}
