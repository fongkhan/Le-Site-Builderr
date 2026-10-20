// Images de la médiathèque sur le site généré (clé « media » de la fixture) : texte
// alternatif, dimensions, variantes (srcset) préfixées par le chemin de base, couverture
// d'article prioritaire et préchargement du fond du Hero en tête de page.

// Balises ouvrantes <name …> d'une page.
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const decode = (v) =>
  v.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// Valeur décodée d'un attribut (null s'il est absent).
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : null;
};
const preloads = (html) => tagsOf(html, 'link').filter((t) => attr(t, 'rel') === 'preload' && attr(t, 'as') === 'image');

export default async function ({ dist, base, htmlFiles, readDist, check }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const mediaPrefix = `${base}/media/`;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(dist, file);
    for (const img of tagsOf(html, 'img')) {
      const src = attr(img, 'src') || '';
      if (src.startsWith(mediaPrefix)) {
        check(attr(img, 'width') !== null && attr(img, 'height') !== null, `${rel} : image de la médiathèque sans dimensions (${src})`);
      }
      for (const candidate of (attr(img, 'srcset') || '').split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)) {
        if (candidate.startsWith('/')) check(candidate.startsWith(mediaPrefix), `${rel} : variante non préfixée par ${mediaPrefix} : ${candidate}`);
      }
    }
    check(preloads(html).length <= 1, `${rel} : ${preloads(html).length} préchargements d'image (1 au plus)`);
  }

  // Accueil : galerie et produits
  const home = readDist('index.html');
  const homeImgs = tagsOf(home, 'img');
  const four = homeImgs.find((t) => attr(t, 'src') === `${mediaPrefix}four.jpg`);
  check(Boolean(four), `index.html : image ${mediaPrefix}four.jpg absente`);
  if (four) {
    check(attr(four, 'alt') === 'Four à céramique "raku"', `index.html : texte alternatif de four.jpg (${attr(four, 'alt')})`);
    check(attr(four, 'width') === '1600' && attr(four, 'height') === '1067', `index.html : dimensions de four.jpg (${attr(four, 'width')}×${attr(four, 'height')})`);
    const srcset = attr(four, 'srcset') || '';
    check(srcset.includes(`${mediaPrefix}w480/four.jpg 480w`), `index.html : variante 480 de four.jpg absente du srcset (${srcset})`);
    check(srcset.includes(`${mediaPrefix}four.jpg 1600w`), `index.html : original de four.jpg absent du srcset (${srcset})`);
    check(Boolean(attr(four, 'sizes')), 'index.html : srcset de four.jpg sans attribut sizes');
    check(attr(four, 'loading') === 'lazy', 'index.html : four.jpg non différée (loading="lazy")');
  }
  const tasse = homeImgs.find((t) => attr(t, 'src') === `${mediaPrefix}tasse.jpg`);
  check(Boolean(tasse) && attr(tasse, 'alt') === 'Tasse expresso', `index.html : texte alternatif de repli de tasse.jpg (${tasse && attr(tasse, 'alt')})`);
  const unsplash = homeImgs.find((t) => (attr(t, 'src') || '').startsWith('https://images.unsplash.com/photo-1493106641515'));
  check(Boolean(unsplash) && attr(unsplash, 'alt') === "Photo 1 – L'atelier en images", `index.html : texte de repli de la galerie (${unsplash && attr(unsplash, 'alt')})`);
  check(Boolean(unsplash) && attr(unsplash, 'srcset') === null, 'index.html : srcset sur une image externe');

  // Préchargement du fond du Hero en tête de page
  const homePreload = preloads(home)[0];
  check(
    Boolean(homePreload) && (attr(homePreload, 'href') || '').startsWith('https://images.unsplash.com/photo-1565193566173') && attr(homePreload, 'fetchpriority') === 'high',
    `index.html : préchargement du fond du Hero absent ou non prioritaire (${homePreload || 'aucun'})`,
  );
  const ateliers = readDist('ateliers/index.html');
  const variant = `${mediaPrefix}w1600/atelier.jpg`;
  const ateliersPreload = preloads(ateliers)[0];
  check(Boolean(ateliersPreload) && attr(ateliersPreload, 'href') === variant, `ateliers/index.html : préchargement de ${variant} absent (${ateliersPreload || 'aucun'})`);
  const heroStyle = tagsOf(ateliers, 'section').map((t) => attr(t, 'style') || '').find((s) => s.includes('background-image')) || '';
  check(heroStyle.includes(`url("${variant}")`), `ateliers/index.html : le fond du Hero n'utilise pas la variante préchargée (${heroStyle})`);
  check(preloads(readDist('mentions-legales/index.html')).length === 0, 'mentions-legales/index.html : préchargement sans Hero en tête de page');

  // Couverture d'article : prioritaire, texte et dimensions de la médiathèque
  const post = readDist('blog/ouverture-atelier/index.html');
  const cover = tagsOf(post, 'img').find((t) => /\bpost-cover\b/.test(attr(t, 'class') || ''));
  check(Boolean(cover), 'blog/ouverture-atelier : couverture absente');
  if (cover) {
    check(attr(cover, 'fetchpriority') === 'high', 'blog/ouverture-atelier : couverture sans fetchpriority="high"');
    check(attr(cover, 'loading') !== 'lazy', 'blog/ouverture-atelier : couverture différée (loading="lazy")');
    check(attr(cover, 'alt') === 'Atelier de poterie', `blog/ouverture-atelier : texte alternatif de la couverture (${attr(cover, 'alt')})`);
    check(attr(cover, 'width') === '2400', `blog/ouverture-atelier : largeur de la couverture (${attr(cover, 'width')})`);
  }
}
