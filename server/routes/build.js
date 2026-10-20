// Déploiement : état du build, webhook de (re)build et canal interne lu par le build Astro.
const fs = require('fs');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const media = require('../lib/media');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { readBuildLog } = require('../core/build-log');
const { LOCK_FILE } = require('../core/config');
const { readSitePages, readSitePosts } = require('../services/content');
const build = require('../services/build');
const { isShuttingDown } = require('../core/shutdown');
const { siteMediaManifest } = require('../services/media');

const router = createRouter();

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

  // Un client ne voit les logs (et le résultat) que si le build en cours ou le dernier
  // build concerne un de ses sites.
  const logSite = build.getLogSite();
  const canSeeLogs = auth.isAdmin(req.user) || !logSite || req.userSiteSlugs.has(logSite);

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

  // Site en cours de suppression : une publication remettrait ses fichiers en ligne
  if (build.isSiteDeleting(siteSlug)) {
    return res.status(409).json({ error: 'Ce site est en cours de suppression.' });
  }

  // Décision d'occupation SYNCHRONE (aucun await intercalé) : réserve le créneau
  // immédiatement si le build est libre, fermant la fenêtre TOCTOU. Jamais de réservation
  // pendant l'arrêt du serveur (la demande est alors mise en file pour le redémarrage).
  const reserved = build.tryReserve(siteSlug);

  let site;
  try {
    site = await sitesStore.getSiteBySlug(siteSlug);
  } catch (e) {
    if (reserved) build.release(); // jamais de verrou orphelin sur une erreur de base
    return sendError(res, "Impossible de lancer le build.", e);
  }
  if (!site) {
    if (reserved) build.release(); // libérer la réservation prise à tort
    return res.status(404).json({ error: "Site non trouvé dans la base cPanel." });
  }

  const triggeredBy = (req.user && req.user.email) || 'système';
  logAudit(req, 'build.declenchement', siteSlug);

  const restarting = (position) => res.status(202).json({ message: 'Le serveur redémarre : la publication démarrera automatiquement à sa reprise.', queued: true, position, restarting: true });

  // Créneau réservé : démarrage immédiat (le build consomme le verrou déjà posé)
  if (reserved) {
    // Arrêt commencé pendant la lecture du site : launch remet le site en tête de file
    const stopping = isShuttingDown();
    build.launch(siteSlug, triggeredBy);
    if (stopping) return restarting(build.getQueue().indexOf(siteSlug) + 1);
    res.status(202).json({ message: 'Build démarré avec succès.', queued: false });
    return;
  }

  // Build déjà en cours pour CE site : un nouveau build est programmé juste après, pour
  // publier les modifications enregistrées depuis son démarrage (dédupliqué).
  const position = build.enqueue(siteSlug, triggeredBy);
  if (isShuttingDown()) return restarting(position);
  if (build.getBuildStatus().buildingSite === siteSlug) {
    return res.status(202).json({ message: 'Build déjà en cours pour ce site : une nouvelle publication suivra.', queued: true, position, alreadyBuilding: true });
  }

  // Un autre build occupe le verrou : mise en file (dédupliquée)
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
    res.json(media.rewriteMediaUrls(await readSitePages(siteSlug), media.mediaPrefixFor(build.getActiveBasePath())));
  } catch (e) {
    sendError(res, "Impossible de lire les pages du site.", e);
  }
});

// Articles PUBLIÉS uniquement.
router.get('/internal/site-posts', requireBuildToken, async (req, res) => {
  const siteSlug = await resolveInternalSite(req);
  try {
    res.json(media.rewriteMediaUrls(await readSitePosts(siteSlug, { publishedOnly: true }), media.mediaPrefixFor(build.getActiveBasePath())));
  } catch (e) {
    sendError(res, "Impossible de lire les articles du site.", e);
  }
});

// Médiathèque du site : texte alternatif, dimensions et variantes de chaque image (les
// fichiers eux-mêmes sont écrits dans le site au déploiement, même règle de variantes).
router.get('/internal/site-media', requireBuildToken, async (req, res) => {
  try {
    res.json(await siteMediaManifest(await resolveInternalSite(req)));
  } catch (e) {
    sendError(res, "Impossible de lire la médiathèque du site.", e);
  }
});

module.exports = router;
