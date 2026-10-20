// Médiathèque d'un site : liste des images avec leurs usages, texte alternatif,
// suppression contrôlée (refusée tant que l'image est citée) et manifeste du build.
// Payload est la seule source : sans base (ou site absent de la base), médiathèque vide.
const { getPayloadInstance } = require('../core/payload');
const { findPayloadSiteId, readSitePages, readSitePosts } = require('./content');
const { mediaUsage, toLibraryItem, buildMediaManifest } = require('../lib/media-library');

// Contexte Payload d'un site, ou null (pas de base, site inconnu).
async function siteContext(slug) {
  const payload = getPayloadInstance();
  if (!payload) return null;
  const siteId = await findPayloadSiteId(payload, slug);
  return siteId ? { payload, siteId, slug } : null;
}

// Usages des images `names` dans TOUT le contenu du site (pages de toutes les langues,
// articles brouillons compris).
async function usageFor(slug, names) {
  const [pages, posts] = await Promise.all([readSitePages(slug), readSitePosts(slug)]);
  return mediaUsage(names, (pages && pages.docs) || [], (posts && posts.docs) || []);
}

// Fiches média du site, les plus récentes d'abord.
async function siteMediaDocs(ctx) {
  const res = await ctx.payload.find({
    collection: 'media',
    where: { site: { equals: ctx.siteId } },
    sort: '-createdAt',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return res.docs || [];
}

async function listSiteMedia(slug) {
  const ctx = await siteContext(slug);
  if (!ctx) return [];
  const docs = await siteMediaDocs(ctx);
  const usage = await usageFor(slug, docs.map((d) => d.filename).filter(Boolean));
  return docs.map((d) => toLibraryItem(d, usage.get(d.filename) || []));
}

// Fiche média `id` APPARTENANT au site : le média d'un autre site est introuvable (404,
// jamais 403 : son existence n'est pas révélée).
async function findSiteMediaDoc(ctx, id) {
  const res = await ctx.payload.find({
    collection: 'media',
    where: { and: [{ id: { equals: Number(id) } }, { site: { equals: ctx.siteId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  return (res.docs && res.docs[0]) || null;
}

// Texte alternatif (déjà nettoyé par l'appelant). null si l'image est introuvable.
async function updateSiteMediaAlt(slug, id, alt) {
  const ctx = await siteContext(slug);
  if (!ctx) return null;
  const doc = await findSiteMediaDoc(ctx, id);
  if (!doc) return null;
  const updated = await ctx.payload.update({ collection: 'media', id: doc.id, data: { alt }, overrideAccess: true, depth: 0 });
  const usage = await usageFor(slug, [updated.filename].filter(Boolean));
  return toLibraryItem(updated, usage.get(updated.filename) || []);
}

// Suppression d'une image du site : refusée tant qu'un contenu la cite. Payload efface
// aussi le fichier. → { status: 'not_found' } | { status: 'in_use', usedIn } |
// { status: 'deleted', filename }.
async function deleteSiteMedia(slug, id) {
  const ctx = await siteContext(slug);
  if (!ctx) return { status: 'not_found' };
  const doc = await findSiteMediaDoc(ctx, id);
  if (!doc) return { status: 'not_found' };
  const usage = await usageFor(slug, [doc.filename].filter(Boolean));
  const usedIn = usage.get(doc.filename) || [];
  if (usedIn.length > 0) return { status: 'in_use', usedIn };
  await ctx.payload.delete({ collection: 'media', id: doc.id, overrideAccess: true });
  return { status: 'deleted', filename: doc.filename };
}

// Manifeste du build (/internal/site-media) : { docs: [{ filename, alt, width, height,
// variants }] }.
async function siteMediaManifest(slug) {
  const ctx = await siteContext(slug);
  if (!ctx) return { docs: [] };
  return buildMediaManifest(await siteMediaDocs(ctx));
}

module.exports = {
  listSiteMedia,
  findSiteMediaDoc,
  updateSiteMediaAlt,
  deleteSiteMedia,
  siteMediaManifest,
};
