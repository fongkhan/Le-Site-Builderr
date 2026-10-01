// Règles métier des sites indépendantes d'Express : domaine attribué, SSL initial,
// confinement des chemins, provisioning du dépôt, propriétaires.
const fs = require('fs');
const path = require('path');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const { getPayloadInstance } = require('../core/payload');
const { appendBuildLog } = require('../core/build-log');
const { assertSafePath } = require('../lib/paths');
const { ASTRO_PROJECT_DIR, PUBLIC_HTML_DIR, REPOSITORIES_DIR } = require('../core/config');

// Chemins stockés au format POSIX (un chemin Windows saisi reste exploitable).
const toPosixPath = (p) => String(p).replace(/\\/g, '/');

// Dossier de production par défaut d'un site.
const defaultDocumentRoot = (slug) => toPosixPath(path.join(PUBLIC_HTML_DIR, slug));

// Domaine attribué à un site à sa création.
// - simulation : motif fictif historique <slug>.o2switch.site (ou domaine fourni).
// - cpanel : sous-domaine RÉEL <slug>.<rootDomain> créé via l'API (idempotent) ; un
//   domaine explicitement fourni est respecté (domaine custom déjà configuré côté
//   cPanel), sauf s'il s'agit du motif fictif hérité d'un scan.
async function resolveSiteDomain(slug, explicitDomain) {
  const isFakePattern = typeof explicitDomain === 'string' && explicitDomain.endsWith('.o2switch.site');
  if (explicitDomain && !isFakePattern) return explicitDomain;
  if (!hosting.isRemote) return explicitDomain || `${slug}.o2switch.site`;
  const { domain, created } = await hosting.ensureSubdomain(slug);
  if (created) {
    appendBuildLog(`Sous-domaine cPanel créé : ${domain}`);
  }
  return domain;
}

// SSL initial : fictivement actif en simulation ; en cpanel, AutoSSL doit d'abord
// émettre le certificat (statut rafraîchi au premier déploiement).
function initialSslStatus() {
  return hosting.isRemote ? 'pending' : 'active';
}

// Confine documentRoot/repositoryPath fournis par le client sous leurs racines autorisées.
// Renvoie true si OK, sinon envoie une 400 et renvoie false (l'appelant doit s'arrêter).
// Un chemin arbitraire (ex. "/etc") deviendrait la cible de fs.rmSync au build/delete.
function ensureConfinedPaths(res, { documentRoot, repositoryPath }) {
  try {
    if (documentRoot) assertSafePath(documentRoot, PUBLIC_HTML_DIR);
    if (repositoryPath) assertSafePath(repositoryPath, REPOSITORIES_DIR);
    return true;
  } catch (e) {
    res.status(400).json({ error: "Chemin non autorisé : le dossier doit rester dans le périmètre du projet." });
    return false;
  }
}

// Copie le client-template dans le dépôt local du site (code source complet, sans Git).
function provisionRepository(repoPath) {
  if (repoPath && !fs.existsSync(repoPath)) {
    try {
      fs.mkdirSync(repoPath, { recursive: true });
      fs.cpSync(ASTRO_PROJECT_DIR, repoPath, {
        recursive: true,
        filter: (src) => {
          // Ne pas copier node_modules, .astro, dist ou .git
          const base = path.basename(src);
          return base !== 'node_modules' && base !== '.astro' && base !== 'dist' && base !== '.git';
        }
      });
      console.log(`[Provisioning] Dépôt local copié sans Git dans : ${repoPath}`);
    } catch (err) {
      console.error(`[Provisioning] Erreur de copie du dépôt local : ${err.message}`);
    }
  }
}

// Premier slug libre : base, base-2, base-3…
async function uniqueSlug(base) {
  let slug = base;
  let suffix = 2;
  while (await sitesStore.getSiteBySlug(slug)) slug = `${base}-${suffix++}`;
  return slug;
}

// Statut de site mis à jour en tâche de fond (jamais bloquant pour l'appelant).
function updateSiteStatus(slug, status) {
  sitesStore.updateSiteStatus(slug, status).catch((e) => {
    console.error("Erreur mise à jour statut site", e.message);
  });
}

// Carte { slug: [emails] } des propriétaires de sites (jointure users.sites → slug).
async function getSiteOwnersMap() {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance) return {};
  // depth:1 peuple la relation users.sites (on récupère le slug de chaque site)
  const usersRes = await payloadInstance.find({ collection: 'users', depth: 1, limit: 1000, overrideAccess: true });
  const owners = {};
  for (const u of usersRes.docs) {
    for (const site of (u.sites || [])) {
      const slug = site && typeof site === 'object' ? site.slug : null;
      if (!slug) continue;
      (owners[slug] ||= []).push(u.email);
    }
  }
  return owners;
}

// Emails des propriétaires d'UN seul site. Contrairement à getSiteOwnersMap (qui balaie
// toute la collection users), on filtre côté base sur la relation users.sites → adapté
// aux chemins fréquents/publics (formulaire de contact, notifications de build) sans
// charger tous les comptes. Lecture sans effet de bord (jamais de création implicite).
async function getSiteOwners(slug) {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance || !slug) return [];
  const siteRes = await payloadInstance.find({
    collection: 'payload_sites',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const siteId = siteRes.docs[0]?.id;
  if (!siteId) return [];
  const usersRes = await payloadInstance.find({
    collection: 'users',
    where: { sites: { in: [siteId] } },
    depth: 0,
    limit: 1000,
    overrideAccess: true,
  });
  return usersRes.docs.map((u) => u.email).filter(Boolean);
}

// Rattache un site (id Payload) au compte d'un client (relation users.sites), sans doublon.
async function attachSiteToUser(userId, siteId) {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance) return;
  const fullUser = await payloadInstance.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true
  });
  const existingSiteIds = (fullUser.sites || []).map(s => (typeof s === 'object' && s !== null ? s.id : s));
  if (!existingSiteIds.includes(siteId)) {
    await payloadInstance.update({
      collection: 'users',
      id: userId,
      data: { sites: [...existingSiteIds, siteId] },
      overrideAccess: true
    });
  }
}

module.exports = {
  toPosixPath,
  defaultDocumentRoot,
  resolveSiteDomain,
  initialSslStatus,
  ensureConfinedPaths,
  provisionRepository,
  uniqueSlug,
  updateSiteStatus,
  getSiteOwnersMap,
  getSiteOwners,
  attachSiteToUser,
};
