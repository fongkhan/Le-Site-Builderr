// Variantes redimensionnées des images publiées (attribut srcset du site statique).
// Règle UNIQUE partagée par le manifeste (/internal/site-media, lu par le template) et la
// publication (copie dans dist/media/) : une variante annoncée existe toujours sur le site.
// sharp est optionnel (dépendance de next, jamais ajoutée à package.json) : sans lui,
// aucune variante n'est annoncée ni écrite — le site garde l'image d'origine.
const fs = require('fs');
const path = require('path');

const VARIANT_WIDTHS = [480, 960, 1600];
// Formats redimensionnés : GIF exclu (une animation serait aplatie).
const RESIZABLE = new Set(['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'avif']);

const extensionOf = (name) => {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1).toLowerCase() : '';
};

// Largeurs de variantes utiles pour une image : seulement celles nettement plus petites
// que l'original (≤ 80 % de sa largeur), en ordre croissant.
function variantWidths(width, filename) {
  if (!Number.isInteger(width) || width <= 0) return [];
  if (!RESIZABLE.has(extensionOf(filename))) return [];
  const max = Math.floor(width * 0.8);
  return VARIANT_WIDTHS.filter((w) => w <= max);
}

// sharp chargé une seule fois (null s'il est indisponible sur la machine).
let sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
    } catch {
      sharpModule = null;
    }
  }
  return sharpModule;
}

// Largeurs annoncées pour une fiche média : aucune sans sharp.
function variantWidthsFor(doc, { sharp = loadSharp() } = {}) {
  if (!sharp || !doc) return [];
  return variantWidths(doc.width, doc.filename);
}

// Chemin relatif d'une variante dans le dossier des médias : w<largeur>/<nom>.
function variantRelPath(width, name) {
  return `w${width}/${path.basename(String(name))}`;
}

// Écrit les variantes d'une image (même format que l'original). Une variante qui ne peut
// pas être produite (sharp absent ou en échec, image multipage/animée) est une copie de
// l'original : chaque variante annoncée existe. Renvoie { resized, copied }.
async function writeMediaVariants(src, outDir, name, widths, { sharp = loadSharp() } = {}) {
  let resized = 0;
  let copied = 0;
  let animated = false;
  if (sharp) {
    try {
      const meta = await sharp(src).metadata();
      animated = (meta.pages || 1) > 1;
    } catch {
      animated = true; // illisible : copies de l'original
    }
  }
  for (const width of widths) {
    const dest = path.join(outDir, variantRelPath(width, name));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let done = false;
    if (sharp && !animated) {
      try {
        const buffer = await sharp(src).rotate().resize({ width, withoutEnlargement: true }).toBuffer();
        fs.writeFileSync(dest, buffer);
        done = true;
        resized++;
      } catch {
        done = false;
      }
    }
    if (!done) {
      fs.copyFileSync(src, dest);
      copied++;
    }
  }
  return { resized, copied };
}

// Publie les images citées par le contenu : original + variantes, sous outDir.
// ownedDocs : Map nom → fiche média du site. Un nom absent de la médiathèque du site est
// ignoré (fichier d'un autre client, fiche supprimée) ; un fichier absent du disque est
// signalé. Renvoie { copied, ignored: [noms], missing: [noms], resized, variantCopies }.
async function publishMediaFiles({ names, ownedDocs, uploadsDir, outDir, sharp = loadSharp() }) {
  const result = { copied: 0, ignored: [], missing: [], resized: 0, variantCopies: 0 };
  for (const name of names || []) {
    const doc = ownedDocs && ownedDocs.get(name);
    if (!doc) {
      result.ignored.push(name);
      continue;
    }
    const base = path.basename(name);
    const src = path.join(uploadsDir, base);
    if (!fs.existsSync(src)) {
      result.missing.push(name);
      continue;
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(src, path.join(outDir, base));
    result.copied++;
    const widths = variantWidthsFor(doc, { sharp });
    if (widths.length > 0) {
      const { resized, copied } = await writeMediaVariants(src, outDir, base, widths, { sharp });
      result.resized += resized;
      result.variantCopies += copied;
    }
  }
  return result;
}

module.exports = {
  VARIANT_WIDTHS,
  RESIZABLE,
  variantWidths,
  loadSharp,
  variantWidthsFor,
  variantRelPath,
  writeMediaVariants,
  publishMediaFiles,
};
