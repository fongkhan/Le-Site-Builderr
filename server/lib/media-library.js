// Médiathèque d'un site — fonctions pures, testables sans serveur : texte alternatif,
// usages d'une image dans les pages et les articles, forme renvoyée à l'orchestrateur et
// manifeste lu par le build du site (/internal/site-media).
const { collectMediaFilenames, MEDIA_API_PREFIX } = require('./media');
const { isPublishableMediaName } = require('./media-policy');
const { variantWidthsFor, loadSharp } = require('./media-variants');

const ALT_MAX = 200;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// Texte alternatif nettoyé (caractères de contrôle → espace, blancs réduits, 200
// caractères au plus), ou null si la valeur n'est pas une chaîne.
function cleanAlt(value) {
  if (typeof value !== 'string') return null;
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX).trim();
}

// Identifiant Payload (clé entière Postgres) : borné pour rester un entier exact.
const isPayloadMediaId = (id) => typeof id === 'string' && /^\d{1,15}$/.test(id);

// Usages de chaque image : Map nom → [{ type: 'page', title, slug, locale } |
// { type: 'post', title, slug, draft }]. Toutes les langues et tous les articles
// (brouillons compris) : une image citée par un brouillon ne doit pas disparaître. Une URL
// externe qui contient « /media/<nom> » compte aussi (faux positif prudent). Les entrées ne
// sont jamais modifiées.
function mediaUsage(names, pages, posts) {
  const usage = new Map();
  for (const name of names || []) usage.set(name, []);
  const add = (found, entry) => {
    for (const name of found) {
      if (usage.has(name)) usage.get(name).push(entry);
    }
  };
  for (const page of pages || []) {
    if (!page || typeof page !== 'object') continue;
    add(collectMediaFilenames(page), {
      type: 'page',
      title: page.title || page.slug || '',
      slug: page.slug || '',
      locale: page.locale || 'fr',
    });
  }
  for (const post of posts || []) {
    if (!post || typeof post !== 'object') continue;
    add(collectMediaFilenames(post), {
      type: 'post',
      title: post.title || post.slug || '',
      slug: post.slug || '',
      draft: post.status !== 'published',
    });
  }
  return usage;
}

// Libellé d'un usage : page « Accueil » (EN), article « Noël » (brouillon).
function usageLabel(u) {
  if (u.type === 'post') return `article « ${u.title} »${u.draft ? ' (brouillon)' : ''}`;
  const locale = u.locale || 'fr';
  return `page « ${u.title} »${locale !== 'fr' ? ` (${locale.toUpperCase()})` : ''}`;
}

// Message du refus de suppression d'une image encore utilisée (5 usages cités au plus).
function usageMessage(usedIn) {
  const list = usedIn || [];
  const shown = list.slice(0, 5).map(usageLabel).join(', ');
  const more = list.length > 5 ? ` et ${list.length - 5} autre(s)` : '';
  return `Image utilisée dans : ${shown}${more}. Retirez-la de ces contenus avant de la supprimer.`;
}

// Liste de noms de fichiers pour le journal de build : caractères de contrôle neutralisés,
// noms bornés à 80 caractères, `max` noms au plus.
function summarizeNames(names, max = 10) {
  const list = names || [];
  const shown = list.slice(0, max).map((n) => String(n).replace(CONTROL_CHARS, '?').slice(0, 80)).join(', ');
  return list.length > max ? `${shown} … et ${list.length - max} autre(s)` : shown;
}

const positiveInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

// Fiche Payload → élément de la médiathèque renvoyé à l'orchestrateur.
function toLibraryItem(doc, usedIn = []) {
  const filename = typeof doc.filename === 'string' ? doc.filename : '';
  return {
    id: String(doc.id),
    filename,
    url: MEDIA_API_PREFIX + encodeURIComponent(filename),
    alt: typeof doc.alt === 'string' ? doc.alt : '',
    width: positiveInt(doc.width),
    height: positiveInt(doc.height),
    filesize: positiveInt(doc.filesize),
    mimeType: typeof doc.mimeType === 'string' ? doc.mimeType : '',
    createdAt: doc.createdAt || null,
    usedIn,
  };
}

// Manifeste lu par le build : texte alternatif, dimensions et largeurs des variantes de
// chaque image publiable du site (les fichiers sont écrits au déploiement, même règle).
function buildMediaManifest(docs, { sharp = loadSharp() } = {}) {
  return {
    docs: (docs || [])
      .filter((d) => d && isPublishableMediaName(d.filename))
      .map((d) => ({
        filename: d.filename,
        alt: cleanAlt(d.alt) || '',
        width: positiveInt(d.width),
        height: positiveInt(d.height),
        variants: variantWidthsFor(d, { sharp }),
      })),
  };
}

module.exports = {
  ALT_MAX,
  cleanAlt,
  isPayloadMediaId,
  mediaUsage,
  usageLabel,
  usageMessage,
  summarizeNames,
  toLibraryItem,
  buildMediaManifest,
};
