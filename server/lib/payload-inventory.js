// Inventaire des collections et des blocs déclarés dans payload.config.ts, lu comme du
// texte (sans charger Payload) : la documentation, l'IA, le template et le CMS de
// l'orchestrateur sont confrontés à cette liste par leurs tests. Fonction pure.
//
// Analyse volontairement simple : crochets appariés hors chaînes (' " `, échappements
// compris) et hors commentaires (// et /* */). Les expressions régulières littérales ne
// sont pas reconnues (le fichier n'en contient pas).

// Masque du code : true pour chaque caractère hors chaîne et hors commentaire.
function codeMask(text) {
  const mask = new Array(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else {
      mask[i] = true;
      i += 1;
    }
  }
  return mask;
}

// Contenu (sans les crochets) de chaque liste ouverte par `marker` dans le code. Un
// marqueur absent lève une erreur explicite : le fichier a sans doute été reformaté.
function sections(text, marker, mask = codeMask(text)) {
  const found = [];
  for (let start = text.indexOf(marker); start !== -1; start = text.indexOf(marker, start + 1)) {
    if (!mask[start]) continue;
    const open = text.indexOf('[', start);
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (!mask[i]) continue;
      if (text[i] === '[') depth += 1;
      else if (text[i] === ']' && --depth === 0) { close = i; break; }
    }
    if (open === -1 || close === -1) throw new Error(`payload.config.ts : liste « ${marker} » non refermée.`);
    found.push({ start: open + 1, end: close });
  }
  if (found.length === 0) {
    throw new Error(`payload.config.ts : marqueur « ${marker} » introuvable (fichier reformaté ?) — adaptez server/lib/payload-inventory.js.`);
  }
  return found;
}

// Slugs (`slug: '<x>'`, guillemets simples ou doubles) écrits dans le code d'une section.
function slugsIn(text, mask, { start, end }) {
  const slugs = [];
  const re = /\bslug:\s*(['"])([^'"\\]+)\1/g;
  re.lastIndex = start;
  for (let m = re.exec(text); m && m.index < end; m = re.exec(text)) {
    if (mask[m.index]) slugs.push(m[2]);
  }
  return slugs;
}

// { collections, blocks } : slugs des blocs (toutes les listes `blocks: [`) et des
// collections (liste `collections: [`, blocs exclus), dans l'ordre du fichier.
function payloadConfigSlugs(text) {
  const source = String(text || '');
  const mask = codeMask(source);
  const blocks = [];
  for (const section of sections(source, 'blocks: [', mask)) {
    for (const slug of slugsIn(source, mask, section)) if (!blocks.includes(slug)) blocks.push(slug);
  }
  const [collectionsSection] = sections(source, 'collections: [', mask);
  const collections = slugsIn(source, mask, collectionsSection).filter((slug) => !blocks.includes(slug));
  return { collections, blocks };
}

module.exports = { payloadConfigSlugs };
