// Déploiement : état du build, webhook de (re)build et canal interne lu par le build Astro.
const express = require('express');
const fs = require('fs');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const media = require('../lib/media');
const { sendError } = require('../core/http');
const { logAudit } = require('../core/audit');
const { readBuildLog } = require('../core/build-log');
const { LOCK_FILE } = require('../core/config');
const { readSitePages, readSitePosts } = require('../services/content');
const build = require('../services/build');

const router = express.Router();

router.get('/api/build-status', auth.authenticate, auth.requireAuth, (req, res) => {
  const buildStatus = build.getBuildStatus();
  const queue = build.getQueue();
  const queueInfo = auth.isAdmin(req.user)
    ? { queue, queueLength: queue.length }
    : {
        queueLength: queue.length,
        queuedSites: queue
          .map((slug, i) => ({ slug, position: i + 1 }))
          .filter(q => req.userSiteSlugs.has(q.slug))
      };

  // Un client ne voit les logs que si le build en cours/dernier concerne un de ses sites
  const canSeeLogs = auth.isAdmin(req.user) ||
    !buildStatus.buildingSite ||
    req.userSiteSlugs.has(buildStatus.buildingSite);

  if (!canSeeLogs) {
    return res.json({
      inProgress: buildStatus.inProgress,
      status: buildStatus.inProgress ? 'busy' : 'idle',
      lastCompleted: null,
      error: null,
      buildingSite: null,
      lockExists: fs.existsSync(LOCK_FILE),
      logs: "Un déploiement d'un autre site est en cours. Veuillez patienter.",
      ...queueInfo
    });
  }

  res.json({
    ...buildStatus,
    lockExists: fs.existsSync(LOCK_FILE),
    logs: readBuildLog(),
    ...queueInfo
  });
});

router.post('/webhook/rebuild', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;

  // Décision d'occupation SYNCHRONE (aucun await intercalé) : réserve le créneau
  // immédiatement si le build est libre, fermant la fenêtre TOCTOU.
  const reserved = build.tryReserve();

  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    if (reserved) build.cancelReservation(); // libérer la réservation prise à tort
    return res.status(404).json({ error: "Site non trouvé dans la base cPanel." });
  }

  // Mémoriser le déclencheur pour l'historique et les notifications
  build.setTrigger(siteSlug, (req.user && req.user.email) || 'système');
  logAudit(req, 'build.declenchement', siteSlug);

  // Créneau réservé : démarrage immédiat (le build consomme le verrou déjà posé)
  if (reserved) {
    res.status(202).json({ message: 'Build démarré avec succès.', queued: false });
    build.launch(siteSlug);
    return;
  }

  // Build déjà en cours pour CE site : rien à faire
  if (build.getBuildStatus().buildingSite === siteSlug) {
    return res.status(202).json({ message: 'Build déjà en cours pour ce site.', queued: false, alreadyBuilding: true });
  }

  // Un autre build occupe le verrou : mise en file (dédupliquée)
  const position = build.enqueue(siteSlug);
  return res.status(202).json({ message: `Site ajouté à la file d'attente (position ${position}).`, queued: true, position });
});

// --- Canal interne pour le build Astro ---
// Authentifié par le jeton BUILD_TOKEN (jamais exposé au navigateur).

function requireBuildToken(req, res, next) {
  if (!build.isValidBuildToken(req.headers['x-build-token'])) {
    return res.status(401).json({ error: "Jeton de build invalide." });
  }
  next();
}

// Site visé : ?site= explicite, sinon le site en cours de build, sinon le premier site.
async function resolveInternalSite(req) {
  if (req.query.site) return req.query.site;
  const active = build.getActiveBuildingSite();
  if (active) return active;
  try {
    const sites = await sitesStore.listSites();
    if (sites.length > 0) return sites[0].slug;
  } catch (e) { /* repli ci-dessous */ }
  return 'boulangerie-artisanale';
}

// Pages du site. Les URLs de la médiathèque (/api/media/file/…) sont réécrites en
// /media/… : le site statique publié est autonome (fichiers copiés au déploiement).
router.get('/internal/site-pages', requireBuildToken, async (req, res) => {
  const siteSlug = await resolveInternalSite(req);
  try {
    res.json(media.rewriteMediaUrls(await readSitePages(siteSlug)));
  } catch (e) {
    sendError(res, "Impossible de lire les pages du site.", e);
  }
});

// Articles PUBLIÉS uniquement.
router.get('/internal/site-posts', requireBuildToken, async (req, res) => {
  const siteSlug = await resolveInternalSite(req);
  try {
    res.json(media.rewriteMediaUrls(await readSitePosts(siteSlug, { publishedOnly: true })));
  } catch (e) {
    sendError(res, "Impossible de lire les articles du site.", e);
  }
});

module.exports = router;
