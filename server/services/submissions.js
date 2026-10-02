// Boîte de réception des messages d'un site : collection Payload « submissions », repli
// JSON (DATA_DIR/submissions_<slug>.json, jamais servi statiquement) en mode sans base.
// La rétention (12 mois, 500 messages) est appliquée à chaque enregistrement et à chaque
// lecture : un site qui ne reçoit plus de messages ne garde pas les anciens.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPayloadInstance } = require('../core/payload');
const { DATA_DIR } = require('../core/config');
const { isValidSlug } = require('../lib/paths');
const { readJsonStrict, writeJsonAtomic } = require('../lib/json-file');
const { normalizeSubmission, pruneSubmissions } = require('../lib/submissions');
const { findPayloadSiteId } = require('./content');

// Défense en profondeur : un slug non canonique ne produit jamais de chemin.
function getSubmissionsFile(slug) {
  if (!isValidSlug(slug)) throw new Error(`Identifiant de site invalide : ${JSON.stringify(slug)}`);
  return path.join(DATA_DIR, `submissions_${slug}.json`);
}

// Identifiant de message reçu dans l'URL : numérique (Payload) ou UUID (repli JSON).
const isValidSubmissionId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
// Identifiant Payload (clé entière Postgres) : borné pour rester un entier exact.
const isPayloadId = (id) => /^\d{1,15}$/.test(id);

// Forme renvoyée à l'orchestrateur.
function toApi(doc) {
  return {
    id: String(doc.id),
    kind: doc.kind === 'appointment' ? 'appointment' : 'contact',
    name: doc.name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    message: doc.message || '',
    read: Boolean(doc.read),
    createdAt: doc.createdAt,
  };
}

// Lecture et écriture synchrones (sans await entre les deux) : pas de message perdu
// entre deux requêtes concurrentes. Fichier illisible → erreur, jamais écrasé.
const readFileList = (slug) => {
  const data = readJsonStrict(getSubmissionsFile(slug), []);
  return Array.isArray(data) ? data : [];
};
const writeFileList = (slug, list) => writeJsonAtomic(getSubmissionsFile(slug), list, { pretty: false });

async function payloadContext(slug) {
  const payload = getPayloadInstance();
  if (!payload) return null;
  return { payload, siteId: await findPayloadSiteId(payload, slug) };
}

// Rétention en base : supprime les messages du site au-delà de 12 mois ou des 500 plus
// récents. Best-effort (rattrapée au prochain appel). `docs` : messages du site déjà lus
// (sinon relus). Renvoie les messages conservés, du plus récent au plus ancien.
async function applyPayloadRetention(ctx, docs) {
  const all = docs || (await ctx.payload.find({
    collection: 'submissions',
    where: { site: { equals: ctx.siteId } },
    select: { createdAt: true },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })).docs;
  const kept = pruneSubmissions(all);
  const keptIds = new Set(kept.map((d) => d.id));
  const stale = all.filter((d) => !keptIds.has(d.id)).map((d) => d.id);
  if (stale.length > 0) {
    try {
      await ctx.payload.delete({ collection: 'submissions', where: { and: [{ id: { in: stale } }, { site: { equals: ctx.siteId } }] }, overrideAccess: true });
    } catch (e) {
      console.error('⚠️ [Messages] rétention non appliquée —', e.message);
    }
  }
  return kept;
}

// Enregistre un message (déjà validé par la route) puis applique la rétention.
async function saveSubmission(slug, input) {
  const data = normalizeSubmission(input);
  const ctx = await payloadContext(slug);
  if (ctx) {
    if (!ctx.siteId) throw new Error(`Site « ${slug} » absent de la base.`);
    const doc = await ctx.payload.create({
      collection: 'submissions',
      data: { ...data, read: false, site: ctx.siteId },
      overrideAccess: true,
    });
    try {
      await applyPayloadRetention(ctx);
    } catch (e) {
      // La rétention sera rattrapée au prochain message : le message reçu est conservé.
      console.error('⚠️ [Messages] rétention non appliquée —', e.message);
    }
    return toApi(doc);
  }
  const entry = { id: crypto.randomUUID(), ...data, read: false, createdAt: new Date().toISOString() };
  writeFileList(slug, pruneSubmissions([entry, ...readFileList(slug)]));
  return toApi(entry);
}

// Messages du site, du plus récent au plus ancien (rétention appliquée, comme en JSON).
async function listSubmissions(slug) {
  const ctx = await payloadContext(slug);
  if (ctx) {
    if (!ctx.siteId) return [];
    const res = await ctx.payload.find({
      collection: 'submissions',
      where: { site: { equals: ctx.siteId } },
      sort: '-createdAt',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    return (await applyPayloadRetention(ctx, res.docs)).map(toApi);
  }
  return pruneSubmissions(readFileList(slug)).map(toApi);
}

// Conditions Payload ciblant un message DU site (jamais celui d'un autre site).
const payloadWhere = (ctx, id) => ({ and: [{ id: { equals: Number(id) } }, { site: { equals: ctx.siteId } }] });

// Marque un message comme lu / non lu. Renvoie le message, ou null s'il est introuvable.
async function markSubmissionRead(slug, id, read) {
  if (!isValidSubmissionId(id)) return null;
  const ctx = await payloadContext(slug);
  if (ctx) {
    if (!ctx.siteId || !isPayloadId(id)) return null;
    const res = await ctx.payload.update({
      collection: 'submissions',
      where: payloadWhere(ctx, id),
      data: { read: Boolean(read) },
      depth: 0,
      overrideAccess: true,
    });
    return res.docs.length > 0 ? toApi(res.docs[0]) : null;
  }
  const list = readFileList(slug);
  const entry = list.find((s) => s && s.id === id);
  if (!entry) return null;
  entry.read = Boolean(read);
  writeFileList(slug, list);
  return toApi(entry);
}

// Supprime un message. Renvoie true s'il existait.
async function removeSubmission(slug, id) {
  if (!isValidSubmissionId(id)) return false;
  const ctx = await payloadContext(slug);
  if (ctx) {
    if (!ctx.siteId || !isPayloadId(id)) return false;
    const res = await ctx.payload.delete({ collection: 'submissions', where: payloadWhere(ctx, id), overrideAccess: true });
    return res.docs.length > 0;
  }
  const list = readFileList(slug);
  const next = list.filter((s) => !(s && s.id === id));
  if (next.length === list.length) return false;
  writeFileList(slug, next);
  return true;
}

// Suppression du fichier de repli (site supprimé).
function purgeSubmissionsFile(slug) {
  if (!isValidSlug(slug)) return;
  const file = getSubmissionsFile(slug);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { console.error(`Suppression de ${file} impossible :`, e.message); }
}

module.exports = {
  getSubmissionsFile,
  isValidSubmissionId,
  saveSubmission,
  listSubmissions,
  markSubmissionRead,
  removeSubmission,
  purgeSubmissionsFile,
};
