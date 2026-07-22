// Couche d'accès aux sites : Payload CMS est la source de vérité quand la base de
// données est disponible ; sinon (mode dev sans DATABASE_URI), fallback sur sites.json.
// Toutes les routes Express passent par ce module — aucune ne lit/écrit sites.json en direct.

const fs = require('fs');

let getPayloadInstance = () => null;
let SITES_FILE = null;

function init({ getPayload, sitesFile }) {
  getPayloadInstance = getPayload;
  SITES_FILE = sitesFile;
}

// ---- Normalisation : forme exacte attendue par le front (type Site) ----
function toApiSite(doc) {
  return {
    slug: doc.slug,
    name: doc.name || doc.slug,
    domain: doc.domain || '',
    documentRoot: doc.documentRoot || '',
    repositoryPath: doc.repositoryPath || '',
    stack: doc.stack || 'Astro SSG',
    createdWithTool: Boolean(doc.createdWithTool),
    status: doc.status || 'draft',
    sslStatus: doc.sslStatus || 'active'
  };
}

// ---- Fallback JSON (mode sans base de données) ----
function readJson() {
  try {
    return JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function writeJson(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');
}

// ---- API publique (async, quelle que soit la branche) ----

async function listSites() {
  const payload = getPayloadInstance();
  if (payload) {
    const res = await payload.find({
      collection: 'payload_sites',
      limit: 500,
      sort: 'createdAt',
      overrideAccess: true
    });
    return res.docs.map(toApiSite);
  }
  return readJson().map(toApiSite);
}

async function getSiteBySlug(slug) {
  const payload = getPayloadInstance();
  if (payload) {
    const res = await payload.find({
      collection: 'payload_sites',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true
    });
    return res.docs.length > 0 ? toApiSite(res.docs[0]) : null;
  }
  const site = readJson().find(s => s.slug === slug);
  return site ? toApiSite(site) : null;
}

async function createSite(data) {
  const site = toApiSite(data);
  const payload = getPayloadInstance();
  if (payload) {
    const doc = await payload.create({
      collection: 'payload_sites',
      data: site,
      overrideAccess: true
    });
    return toApiSite(doc);
  }
  const sites = readJson();
  sites.push(site);
  writeJson(sites);
  return site;
}

async function updateSite(slug, partial) {
  // Update partiel : seules les clés fournies (non-undefined) sont modifiées
  const changes = {};
  for (const key of ['name', 'domain', 'documentRoot', 'repositoryPath', 'stack', 'sslStatus', 'status', 'createdWithTool']) {
    if (partial[key] !== undefined) changes[key] = partial[key];
  }

  const payload = getPayloadInstance();
  if (payload) {
    const res = await payload.find({
      collection: 'payload_sites',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true
    });
    if (res.docs.length === 0) return null;
    const doc = await payload.update({
      collection: 'payload_sites',
      id: res.docs[0].id,
      data: changes,
      overrideAccess: true
    });
    return toApiSite(doc);
  }

  const sites = readJson();
  const site = sites.find(s => s.slug === slug);
  if (!site) return null;
  Object.assign(site, changes);
  writeJson(sites);
  return toApiSite(site);
}

function updateSiteStatus(slug, status) {
  return updateSite(slug, { status });
}

async function deleteSite(slug) {
  const payload = getPayloadInstance();
  if (payload) {
    const res = await payload.find({
      collection: 'payload_sites',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true
    });
    if (res.docs.length === 0) return false;
    const siteId = res.docs[0].id;
    // Supprime d'abord les contenus rattachés (sinon docs orphelins)
    await payload.delete({ collection: 'pages', where: { site: { equals: siteId } }, overrideAccess: true });
    await payload.delete({ collection: 'themes', where: { site: { equals: siteId } }, overrideAccess: true });
    await payload.delete({ collection: 'payload_sites', id: siteId, overrideAccess: true });
    return true;
  }

  const sites = readJson();
  const idx = sites.findIndex(s => s.slug === slug);
  if (idx === -1) return false;
  sites.splice(idx, 1);
  writeJson(sites);
  return true;
}

// Renvoie le doc Payload brut (avec id) pour les relations pages/themes ; le crée si
// nécessaire depuis les données du fallback JSON. null en mode sans base de données.
async function getOrCreatePayloadDoc(slug) {
  const payload = getPayloadInstance();
  if (!payload) return null;

  const existing = await payload.find({
    collection: 'payload_sites',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true
  });
  if (existing.docs.length > 0) return existing.docs[0];

  const localSite = readJson().find(s => s.slug === slug) || { slug, name: slug, domain: `${slug}.o2switch.site` };
  return payload.create({
    collection: 'payload_sites',
    data: toApiSite({ ...localSite, slug }),
    overrideAccess: true
  });
}

// Import one-way idempotent de sites.json vers Payload au boot + backfill des docs
// créés avant l'ajout des champs status/sslStatus/createdWithTool.
async function migrateFromJson() {
  const payload = getPayloadInstance();
  if (!payload) return;

  const jsonSites = readJson();
  let imported = 0;
  let backfilled = 0;

  for (const jsonSite of jsonSites) {
    if (!jsonSite.slug) continue;
    const existing = await payload.find({
      collection: 'payload_sites',
      where: { slug: { equals: jsonSite.slug } },
      limit: 1,
      overrideAccess: true
    });
    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'payload_sites',
        data: toApiSite(jsonSite),
        overrideAccess: true
      });
      imported++;
    } else {
      const doc = existing.docs[0];
      if (doc.status == null || doc.sslStatus == null) {
        await payload.update({
          collection: 'payload_sites',
          id: doc.id,
          data: {
            status: doc.status ?? (jsonSite.status || 'draft'),
            sslStatus: doc.sslStatus ?? (jsonSite.sslStatus || 'active'),
            createdWithTool: doc.createdWithTool ?? Boolean(jsonSite.createdWithTool)
          },
          overrideAccess: true
        });
        backfilled++;
      }
    }
  }

  console.log(`✔ [Sites] Migration sites.json → Payload : ${imported} importé(s), ${backfilled} backfillé(s).`);
}

module.exports = {
  init,
  listSites,
  getSiteBySlug,
  createSite,
  updateSite,
  updateSiteStatus,
  deleteSite,
  getOrCreatePayloadDoc,
  migrateFromJson
};
