// Création d'un site depuis un contenu importé (archive d'export, sauvegarde, duplication)
// et remplacement du contenu d'un site existant (restauration d'une sauvegarde). Le
// contenu reçu est toujours nettoyé (sanitizeSiteContent) avant d'être écrit.
const fs = require('fs');
const path = require('path');
const sitesStore = require('../sites-store');
const { getPayloadInstance } = require('../core/payload');
const { UPLOADS_DIR, PUBLIC_HTML_DIR, getSitePagesFile, getSiteThemeFile } = require('../core/config');
const {
  readSitePages,
  readSitePosts,
  saveSitePages,
  saveSiteTheme,
  upsertPost,
  deletePost,
  validatePagesBody,
  findDangerousUrl,
  normalizePost,
  writePostsFile,
  writeJsonFile,
  findPayloadSiteId,
} = require('./content');
const {
  uniqueSlug,
  defaultDocumentRoot,
  resolveSiteDomain,
  initialSslStatus,
  purgeSiteData,
  copySiteMedia,
} = require('./sites');
const { validateTheme, canonicalTheme, logoFilename } = require('../lib/theme');
const { normalizeLegal } = require('../lib/legal');
const { generateSlug, assertStrictlyInside } = require('../lib/paths');
const { collectMediaFilenames, encodeMediaName, remapMediaFilenames } = require('../lib/media');
const { mediaMimeType, isPublishableMediaName } = require('../lib/media-policy');
const { cleanAlt } = require('../lib/media-library');

// Bornes : articles repris par import, taille d'une image restaurée.
const MAX_IMPORTED_POSTS = 500;
const RESTORE_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

// Clé d'une page : (langue, slug), comme dans l'éditeur.
const pageKey = (p) => `${p.locale === 'en' ? 'en' : 'fr'}:${p.slug}`;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Contenu importé → contenu sûr à écrire. Les éléments invalides sont écartés un par un
// (comptés dans `skipped`) : une page au lien « javascript: » ou un thème hors liste ne
// fait jamais échouer tout l'import. null = élément absent (l'existant est conservé).
// Thème : couleurs, polices et rayon validés sans le logo, puis forme canonique (un logo
// invalide est seul retiré, jamais tout le thème).
function sanitizeSiteContent({ pages, posts, theme } = {}) {
  const skipped = { pages: 0, posts: 0, theme: false };

  let cleanPages = null;
  if (pages && Array.isArray(pages.docs)) {
    const seen = new Set();
    const docs = [];
    for (const page of pages.docs) {
      // Même validation que l'éditeur, page par page ; doublon (langue, slug) écarté
      if (validatePagesBody({ docs: [page] }) !== null || seen.has(pageKey(page))) {
        skipped.pages++;
        continue;
      }
      seen.add(pageKey(page));
      docs.push(page);
    }
    cleanPages = docs.length > 0 ? { docs } : null;
  }

  let cleanPosts = null;
  const postList = Array.isArray(posts) ? posts : posts && Array.isArray(posts.docs) ? posts.docs : null;
  if (postList) {
    const seen = new Set();
    cleanPosts = []; // blog vide : liste vide, jamais null
    for (const p of postList) {
      const slug = p && typeof p === 'object' ? generateSlug(p.slug) : null;
      const titled = Boolean(p && typeof p.title === 'string' && p.title.trim());
      if (!titled || !slug || seen.has(slug) || cleanPosts.length >= MAX_IMPORTED_POSTS) {
        skipped.posts++;
        continue;
      }
      seen.add(slug);
      const post = normalizePost({ ...p, slug });
      for (const key of ['title', 'excerpt', 'coverImage', 'body', 'tags']) {
        if (typeof post[key] !== 'string') post[key] = '';
      }
      if (findDangerousUrl(post.coverImage, true)) post.coverImage = '';
      // Date illisible : article sans date (jamais une valeur arbitraire envoyée en base)
      if (typeof post.publishedAt !== 'string' || !Number.isFinite(Date.parse(post.publishedAt))) post.publishedAt = null;
      cleanPosts.push(post);
    }
  }

  let cleanTheme = null;
  if (theme) {
    const t = theme.theme && typeof theme.theme === 'object' && !Array.isArray(theme.theme) ? theme.theme : null;
    if (t && validateTheme({ ...t, logo: '' }).ok) cleanTheme = { theme: canonicalTheme(t) };
    else skipped.theme = true;
  }

  return { pages: cleanPages, posts: cleanPosts, theme: cleanTheme, skipped };
}

// Contenu lu fichier par fichier : readText('pages.json' | 'posts.json' | 'theme.json')
// renvoie le texte ou null. Un fichier illisible est traité comme absent.
function parseSiteContent(readText) {
  const parse = (name) => {
    let text;
    try {
      text = readText(name);
    } catch {
      return null;
    }
    if (typeof text !== 'string' || !text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  return sanitizeSiteContent({ pages: parse('pages.json'), posts: parse('posts.json'), theme: parse('theme.json') });
}

// Recrée dans la médiathèque du site `targetSiteId` les images sauvegardées, avec leur
// texte alternatif. files = [{ filename, alt?, size, read: () => Buffer }] ; seuls les
// noms d'images publiables de 50 Mo au plus sont lus. keepOwned : une image que le site
// possède déjà (fiche ET fichier présents) est conservée telle quelle (son texte
// alternatif actuel compris). Renvoie la table { ancienNom: nouveauNom }
// à appliquer au contenu (Payload renomme un fichier homonyme), les compteurs et les noms
// déjà possédés. Une image refusée (contenu qui n'est pas une image…) est ignorée.
async function restoreMediaFiles(payloadInstance, targetSiteId, files, {
  keepOwned = false,
  fileExists = (n) => fs.existsSync(path.join(UPLOADS_DIR, n)),
} = {}) {
  const map = {};
  const ownedNames = new Set();
  let restored = 0;
  let kept = 0;
  if (keepOwned) {
    const owned = await payloadInstance.find({
      collection: 'media',
      where: { site: { equals: targetSiteId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const doc of owned.docs || []) {
      const name = typeof doc.filename === 'string' ? path.basename(doc.filename) : '';
      if (name && fileExists(name)) ownedNames.add(name);
    }
  }
  for (const file of files || []) {
    const filename = file && file.filename;
    if (ownedNames.has(filename)) {
      kept++;
      continue;
    }
    const mimetype = mediaMimeType(filename);
    if (!isPublishableMediaName(filename) || !mimetype || Number(file.size) > RESTORE_MEDIA_MAX_BYTES) continue;
    try {
      const data = file.read();
      if (!Buffer.isBuffer(data) || data.length > RESTORE_MEDIA_MAX_BYTES) continue;
      const alt = cleanAlt(file.alt);
      const created = await payloadInstance.create({
        collection: 'media',
        data: { site: targetSiteId, ...(alt ? { alt } : {}) },
        file: { data, mimetype, name: filename, size: data.length },
        overrideAccess: true,
      });
      if (created && created.filename) {
        map[filename] = created.filename;
        restored++;
      }
    } catch (e) {
      console.error(`💾 [Restauration] Image ${filename} non restaurée :`, e.message);
    }
  }
  return { map, restored, kept, ownedNames };
}

// Images du contenu d'un site (pages, articles et logo du thème) : restaurées depuis
// l'archive, puis, pour celles qui manquent encore, copiées depuis la médiathèque de
// `mediaSourceSlug` (duplication, sauvegarde sans images). Sans base ou site inconnu de
// Payload : rien à faire. `owned` : fichiers que le site cible possède ensuite.
async function restoreContentMedia(slug, content, { mediaFiles = [], mediaSourceSlug = null, keepOwned = false } = {}) {
  const none = { map: {}, owned: new Set(), restored: 0, copied: 0, kept: 0, missing: [] };
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance) return none;
  const targetId = await findPayloadSiteId(payloadInstance, slug);
  if (!targetId) return none;

  const r = await restoreMediaFiles(payloadInstance, targetId, mediaFiles, { keepOwned });
  const cited = collectMediaFilenames([content.pages, content.posts, content.theme]).filter(isPublishableMediaName);
  let missing = cited.filter((n) => !hasOwn(r.map, n) && !r.ownedNames.has(n));
  let copiedMap = {};
  if (missing.length > 0 && mediaSourceSlug) {
    try {
      copiedMap = await copySiteMedia(mediaSourceSlug, targetId, missing.map((n) => `/media/${encodeMediaName(n)}`));
    } catch (e) {
      console.error(`[Médias] Images de ${mediaSourceSlug} non copiées :`, e.message);
    }
    missing = missing.filter((n) => !hasOwn(copiedMap, n));
  }
  const map = { ...copiedMap, ...r.map };
  return {
    map,
    owned: new Set([...r.ownedNames, ...Object.values(map)]),
    restored: r.restored,
    copied: Object.keys(copiedMap).length,
    kept: r.kept,
    missing: missing.slice(0, 50),
  };
}

// Thème écrit pour le site cible : logo remappé vers la copie du site cible (forme
// canonique), retiré si ce site ne possède pas le fichier (logo d'un autre site, image
// absente de la sauvegarde) : le build l'ignorerait et la page Design refuserait le thème.
function themeForTarget(theme, media) {
  const t = canonicalTheme(remapMediaFilenames(theme, media.map));
  if (t.logo && !media.owned.has(logoFilename(t.logo))) delete t.logo;
  return t;
}

// Crée un site brouillon (nouveau slug libre dérivé de baseSlug) et y écrit le contenu
// nettoyé : fichiers JSON de repli, repris par le CMS puis persistés dans Payload au
// premier enregistrement. `legal` : informations légales reprises (normalisées).
// afterCreate({ slug, documentRoot }) complète la création (extraction d'un build…) ; son
// résultat est renvoyé dans `after`. Tout échec après la création défait celle-ci (fiche,
// médias, données, dossier créé) puis est propagé.
async function createSiteFromContent({ baseSlug, name, stack, legal = null, content = {}, mediaFiles = [], mediaSourceSlug = null, afterCreate = null }) {
  const slug = await uniqueSlug(baseSlug);
  const documentRoot = defaultDocumentRoot(slug);
  // uniqueSlug écarte les dossiers existants : en cas d'échec, on ne supprime que ce que
  // cette création a produit (jamais des fichiers conservés d'un ancien site).
  const documentRootExisted = fs.existsSync(documentRoot);
  const site = await sitesStore.createSite({
    slug,
    name: name || slug,
    domain: await resolveSiteDomain(slug),
    documentRoot,
    repositoryPath: '',
    stack: stack || 'Astro SSG',
    createdWithTool: true,
    status: 'draft',
    sslStatus: initialSslStatus(),
    legal: normalizeLegal(legal),
  });

  try {
    const media = await restoreContentMedia(slug, content, { mediaFiles, mediaSourceSlug });
    if (content.pages) writeJsonFile(getSitePagesFile(slug), remapMediaFilenames(content.pages, media.map));
    if (content.theme) writeJsonFile(getSiteThemeFile(slug), { theme: themeForTarget(content.theme.theme, media) });
    if (content.posts) writePostsFile(slug, remapMediaFilenames(content.posts, media.map));
    const after = afterCreate ? await afterCreate({ slug, documentRoot }) : undefined;
    const { restored, copied, kept, missing } = media;
    return { site, slug, media: { restored, copied, kept, missing }, after };
  } catch (e) {
    // Pas de site à moitié créé (best-effort) : la suppression Payload emporte les médias
    try {
      await sitesStore.deleteSite(slug);
      purgeSiteData(slug);
      if (!documentRootExisted) {
        fs.rmSync(assertStrictlyInside(documentRoot, PUBLIC_HTML_DIR), { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error('Nettoyage de la création ratée :', cleanupErr.message);
    }
    throw e;
  }
}

// Remplace le contenu d'un site existant par `content` (restauration) : pages actuelles
// absentes du contenu supprimées, thème réécrit, articles absents supprimés puis articles
// restaurés réécrits, images manquantes restaurées. Un élément null (absent de la
// sauvegarde ou invalide) laisse l'existant intact. L'appelant tient le créneau de build
// et a fait une sauvegarde de sécurité juste avant : les écritures Payload ne sont pas
// transactionnelles.
async function replaceSiteContent(slug, content, { mediaFiles = [] } = {}) {
  const media = await restoreContentMedia(slug, content, { mediaFiles, keepOwned: true });
  let pages = 0;
  let posts = 0;
  let theme = false;

  if (content.pages) {
    const docs = remapMediaFilenames(content.pages, media.map).docs;
    const keys = new Set(docs.map(pageKey));
    const current = await readSitePages(slug);
    const deleted = (current && Array.isArray(current.docs) ? current.docs : [])
      .filter((p) => p && typeof p.slug === 'string' && !keys.has(pageKey(p)))
      .map((p) => ({ slug: p.slug, locale: p.locale === 'en' ? 'en' : 'fr' }));
    await saveSitePages(slug, { docs, deleted });
    pages = docs.length;
  }

  if (content.theme) {
    await saveSiteTheme(slug, { theme: themeForTarget(content.theme.theme, media) });
    theme = true;
  }

  if (content.posts) {
    const restoredPosts = remapMediaFilenames(content.posts, media.map);
    const keep = new Set(restoredPosts.map((p) => p.slug));
    const current = (await readSitePosts(slug)).docs || [];
    for (const p of current) {
      if (p && p.slug && !keep.has(p.slug)) await deletePost(slug, p.slug);
    }
    for (const p of restoredPosts) await upsertPost(slug, p);
    posts = restoredPosts.length;
  }

  const { restored, copied, kept, missing } = media;
  return { pages, posts, theme, media: { restored, copied, kept, missing } };
}

module.exports = {
  sanitizeSiteContent,
  parseSiteContent,
  restoreMediaFiles,
  themeForTarget,
  createSiteFromContent,
  replaceSiteContent,
};
