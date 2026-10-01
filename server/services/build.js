// Pipeline de build Astro : verrou, file d'attente, compilation, déploiement atomique,
// releases, publication distante, historique et notifications.
// Astro écrit dans un dossier dist unique : un seul build (ou brouillon) à la fois.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const releases = require('../lib/releases');
const seo = require('../lib/seo');
const media = require('../lib/media');
const i18n = require('../lib/i18n');
const { assertSafePath } = require('../lib/paths');
const { replaceDirAtomically } = require('../lib/fs-swap');
const { getPayloadInstance } = require('../core/payload');
const { sendMail } = require('../core/mail');
const { appendBuildLog, appendRawBuildLog, resetBuildLog } = require('../core/build-log');
const {
  PORT,
  ASTRO_PROJECT_DIR,
  DIST_DIR,
  LOCK_FILE,
  PUBLIC_HTML_DIR,
  DRAFTS_DIR,
  RELEASES_DIR,
  UPLOADS_DIR,
  DEPLOY_KEEP_RELEASES,
} = require('../core/config');
const { applySiteThemeCss, readSitePages, readSitePosts } = require('./content');
const { getSiteOwners, updateSiteStatus } = require('./sites');

// Jeton interne régénéré à chaque boot : seul le process de build Astro le reçoit (via env)
const BUILD_TOKEN = crypto.randomBytes(24).toString('hex');

const buildStatus = {
  inProgress: false,
  status: "idle", // 'idle', 'running', 'success', 'error'
  lastCompleted: null,
  error: null,
  buildingSite: null
};

// File d'attente FIFO de slugs (dédupliquée). Perdue au restart : acceptable,
// le verrou physique orphelin est nettoyé au boot (resetOnBoot).
const buildQueue = [];

// Déclencheur (email) et heure de départ des builds, pour l'historique (collection
// « builds ») et les notifications. Volatiles comme la file : perte au restart OK.
const buildTriggers = new Map();
const buildStartTimes = new Map();

// Verrou mémoire synchrone : posé AVANT tout await pour fermer la fenêtre TOCTOU
// (deux webhooks concurrents ne peuvent plus démarrer deux builds simultanés).
let buildLockHeld = false;

// Site en cours de compilation (repli du canal interne quand ?site= est absent).
let activeBuildingSite = null;

// Vider les logs + nettoyer un verrou orphelin laissé par un crash
function resetOnBoot() {
  resetBuildLog('Initialisation du système de build...\n');
  buildLockHeld = false;
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    appendRawBuildLog('Verrou de build orphelin détecté et nettoyé au démarrage.\n');
  }
}

function isValidBuildToken(value) {
  return value === BUILD_TOKEN;
}

function getActiveBuildingSite() {
  return activeBuildingSite;
}

function getBuildStatus() {
  return buildStatus;
}

function getQueue() {
  return [...buildQueue];
}

// Un build (ou un brouillon) occupe-t-il le template ?
function isBusy() {
  return buildLockHeld || buildStatus.inProgress || fs.existsSync(LOCK_FILE);
}

// Réserve SYNCHRONEMENT le créneau de build s'il est libre (aucun await intercalé :
// Node étant mono-thread, deux requêtes concurrentes ne peuvent pas réserver toutes deux).
function tryReserve() {
  if (isBusy()) return false;
  buildLockHeld = true;
  return true;
}

// Annule une réservation prise à tort (site introuvable…), sans relancer la file.
function cancelReservation() {
  buildLockHeld = false;
}

function setTrigger(siteSlug, triggeredBy) {
  buildTriggers.set(siteSlug, triggeredBy);
}

// Ajoute un site à la file (dédupliquée). Renvoie sa position (1-based).
function enqueue(siteSlug) {
  const existingIdx = buildQueue.indexOf(siteSlug);
  if (existingIdx !== -1) return existingIdx + 1;
  const position = buildQueue.push(siteSlug);
  appendBuildLog(`FILE D'ATTENTE : "${siteSlug}" ajouté (position ${position}).`);
  return position;
}

// Lance un build dont le créneau est déjà réservé ; un échec de lancement libère le
// verrou et relance la file.
function launch(siteSlug, failureLabel = 'Erreur de lancement du build :') {
  startBuild(siteSlug).catch((e) => {
    console.error(failureLabel, e.message);
    buildLockHeld = false;
    drainQueue();
  });
}

// Dépile et lance le build suivant. Appelée à CHAQUE fin de build (succès ou erreur).
function drainQueue() {
  if (buildQueue.length === 0 || buildLockHeld || fs.existsSync(LOCK_FILE)) return;
  const nextSlug = buildQueue.shift();
  buildLockHeld = true; // réserver le créneau avant l'await de startBuild
  appendBuildLog(`FILE D'ATTENTE : lancement du build suivant (${nextSlug}), ${buildQueue.length} restant(s).`);
  launch(nextSlug, 'Erreur de lancement du build en file :');
}

// Environnement du process de build : site actif, jeton d'accès interne, métadonnées
// publiques (Open Graph, JSON-LD) et mesure d'audience. Un brouillon n'a ni URL
// publique (pas de canonique vers la prod) ni mesure d'audience ni beacon de stats.
function buildEnvFor(site, siteSlug, { draft = false } = {}) {
  return {
    ...process.env,
    ACTIVE_SITE_SLUG: siteSlug,
    BUILD_TOKEN,
    ORCHESTRATOR_URL: `http://127.0.0.1:${PORT}`,
    PUBLIC_SITE_NAME: (site && site.name) || siteSlug,
    PUBLIC_SITE_URL: !draft && site && site.domain ? `https://${site.domain}` : '',
    // Mesure d'audience (validée à l'écriture) : chargée après consentement RGPD
    PUBLIC_ANALYTICS_PROVIDER: (!draft && site && site.analyticsProvider) || '',
    PUBLIC_ANALYTICS_ID: (!draft && site && site.analyticsId) || '',
    PUBLIC_ANALYTICS_HOST: (!draft && site && site.analyticsHost) || '',
    ...(draft ? { PUBLIC_IS_DRAFT: '1' } : {}),
  };
}

// Clôture d'un build (succès ou erreur) : historisation en base + notification email
// aux propriétaires. Entièrement non bloquant : un échec ici n'affecte jamais le build.
function finalizeBuild(siteSlug, siteName, status, excerpt) {
  const startedAt = buildStartTimes.get(siteSlug);
  const durationMs = startedAt ? Date.now() - startedAt : null;
  const triggeredBy = buildTriggers.get(siteSlug) || 'système';
  buildStartTimes.delete(siteSlug);
  buildTriggers.delete(siteSlug);

  (async () => {
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) return;
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
    await payloadInstance.create({
      collection: 'builds',
      data: { site: siteDoc.id, status, durationMs, triggeredBy, logExcerpt: String(excerpt || '').slice(-1500) },
      overrideAccess: true,
    });
  })().catch((e) => console.error('Historique de build non enregistré :', e.message));

  notifyBuildResult(siteSlug, siteName, status, durationMs).catch((e) =>
    console.error('Notification de build non envoyée :', e.message)
  );
}

// Email de fin de build aux propriétaires du site.
async function notifyBuildResult(siteSlug, siteName, status, durationMs) {
  const emails = await getSiteOwners(siteSlug);
  if (emails.length === 0) return;

  const ok = status === 'success';
  const seconds = durationMs ? Math.round(durationMs / 1000) : null;
  const subject = `${ok ? '✅ Déploiement réussi' : '❌ Déploiement échoué'} — ${siteName}`;
  const text = ok
    ? `Le site « ${siteName} » a été déployé avec succès${seconds ? ` en ${seconds} s` : ''}.\nAperçu : /preview/${siteSlug}/index.html`
    : `Le déploiement du site « ${siteName} » a échoué${seconds ? ` après ${seconds} s` : ''}.\nConsultez les logs de build dans l'orchestrateur pour le détail.`;

  await sendMail(emails, subject, text);
}

// Exécute `npm run build` dans le template (callback (error, stdout, stderr)).
function runAstroBuild(command, env, callback) {
  exec(command, { cwd: ASTRO_PROJECT_DIR, env }, callback);
}

// --- Prévisualisation brouillon ---------------------------------------------
// Compile le contenu COURANT du CMS vers un dossier isolé, servi sous /draft/<slug>/.
// Ne touche NI la production (documentRoot), NI les releases, NI le statut du site.
// Partage le verrou de build : Astro écrit dans le même dossier dist.
async function startDraftBuild(siteSlug) {
  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) throw new Error('Site introuvable.');

  fs.writeFileSync(LOCK_FILE, 'locked');
  try {
    // Thème courant appliqué au template avant compilation (comme un vrai build)
    applySiteThemeCss(siteSlug);
    activeBuildingSite = siteSlug;

    await new Promise((resolve, reject) => {
      runAstroBuild('npm run build', buildEnvFor(site, siteSlug, { draft: true }), (error, stdout, stderr) => {
        if (error) return reject(new Error(`Build brouillon échoué : ${String(stderr || stdout).slice(-500)}`));
        resolve();
      });
    });

    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error('Build brouillon sans sortie exploitable.');
    }

    // Publication atomique dans le dossier de brouillons (jamais dans PUBLIC_HTML_DIR)
    const destDir = path.join(DRAFTS_DIR, siteSlug);
    assertSafePath(destDir, DRAFTS_DIR);
    replaceDirAtomically(DIST_DIR, destDir, 'draft');

    return `/draft/${siteSlug}/index.html`;
  } finally {
    activeBuildingSite = null;
    try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  }
}

// Brouillon exclusif : réserve le créneau, compile, puis libère et relance la file.
// Précondition : l'appelant a vérifié isBusy() (sinon 409).
async function runDraftPreview(siteSlug) {
  buildLockHeld = true;
  try {
    return await startDraftBuild(siteSlug);
  } finally {
    buildLockHeld = false;
    drainQueue(); // un build en attente peut repartir
  }
}

// Lance un build : pose le verrou, exécute astro build, copie vers documentRoot,
// puis libère le verrou et draine la file — quel que soit le résultat.
// Précondition : buildLockHeld doit déjà être true (réservé par le webhook ou drainQueue).
async function startBuild(siteSlug) {
  buildLockHeld = true; // défensif (idempotent) : garantit le verrou même si l'appelant l'a oublié
  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    // Le site a pu être supprimé pendant son attente en file
    appendBuildLog(`ANNULÉ : le site "${siteSlug}" n'existe plus.`);
    buildLockHeld = false;
    drainQueue();
    return;
  }

  // Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;
  buildStatus.buildingSite = siteSlug;
  buildStartTimes.set(siteSlug, Date.now());

  resetBuildLog('');
  appendBuildLog(`DÉMARRAGE : Build du site "${site.name}" (${siteSlug})...`);

  // Thème du site appliqué au template CSS avant compilation
  applySiteThemeCss(siteSlug);

  // Site actif pour le routage dynamique d'Astro
  activeBuildingSite = siteSlug;

  // Vérifier si node_modules existe dans client-template, sinon faire npm install
  const needsInstall = !fs.existsSync(path.join(ASTRO_PROJECT_DIR, 'node_modules'));
  const cmd = `${needsInstall ? 'npm install && ' : ''}npm run build`;
  appendBuildLog(`Commande exécutée : ${cmd} (dans ${ASTRO_PROJECT_DIR})`);

  runAstroBuild(cmd, buildEnvFor(site, siteSlug), (error, stdout, stderr) => {
    // Le traitement du résultat est async (publication distante éventuelle) mais le
    // point de sortie reste UNIQUE : libération des verrous dans le finally.
    handleBuildResult(siteSlug, site, error, stdout, stderr)
      .catch((e) => {
        console.error('Erreur inattendue de post-build :', e.message);
        buildStatus.status = 'error';
        buildStatus.error = 'Erreur interne de déploiement.';
        updateSiteStatus(siteSlug, 'error');
      })
      .finally(() => {
        if (fs.existsSync(LOCK_FILE)) {
          fs.unlinkSync(LOCK_FILE);
        }
        buildStatus.inProgress = false;
        buildLockHeld = false;
        drainQueue();
      });
  });
}

// Marque le build en erreur (statut, site, historique) — chemin de sortie commun.
function failBuild(siteSlug, site, publicError, excerpt) {
  buildStatus.status = "error";
  buildStatus.error = publicError;
  updateSiteStatus(siteSlug, 'error');
  finalizeBuild(siteSlug, site.name, 'error', excerpt);
}

// SEO : sitemap.xml + robots.txt générés dans le dist avant publication.
// Chemins localisés : la langue par défaut est à la racine, les autres préfixées
// (/en/…). '' (accueil de la langue par défaut) est représenté par « home ».
async function writeSeoFiles(siteSlug, site, pagesData) {
  const slugs = (pagesData.docs || [])
    .filter((p) => p.slug)
    .map((p) => i18n.localeRouteParam(p.locale, p.slug) || 'home');
  // Ajoute l'index du blog + chaque article publié (URL /blog/<slug>/)
  const postsData = await readSitePosts(siteSlug, { publishedOnly: true });
  const postSlugs = (postsData.docs || []).map((p) => p.slug).filter(Boolean);
  if (postSlugs.length > 0) {
    slugs.push('blog', ...postSlugs.map((s) => `blog/${s}`));
  }
  if (slugs.length > 0) {
    fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), seo.generateSitemap(site.domain, slugs), 'utf-8');
    fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), seo.generateRobots(site.domain), 'utf-8');
  }
}

// Médiathèque : copie dans le dist les images référencées par les pages (URLs /media/…
// réécrites par le canal interne) — le site publié est autonome. Renvoie le nombre copié.
function copyReferencedMedia(pagesData) {
  const filenames = media.collectMediaFilenames(pagesData);
  if (filenames.length === 0) return 0;
  const mediaOut = path.join(DIST_DIR, 'media');
  fs.mkdirSync(mediaOut, { recursive: true });
  let copied = 0;
  for (const name of filenames) {
    const src = path.join(UPLOADS_DIR, path.basename(name));
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(mediaOut, path.basename(name)));
      copied++;
    }
  }
  return copied;
}

async function handleBuildResult(siteSlug, site, error, stdout, stderr) {
  activeBuildingSite = null;
  buildStatus.buildingSite = null;

  if (error) {
    console.error(`Erreur de build : ${error.message}`);
    appendBuildLog(`ERREUR DE BUILD :\n${error.message}\n${stderr}`, { gap: true });
    failBuild(siteSlug, site, error.message, `${error.message}\n${stderr || ''}`);
    return;
  }

  appendBuildLog(`RÉSULTAT DU BUILD ASTRO :\n${stdout}`, { gap: true });
  appendBuildLog(`Astro compilé. Déploiement atomique vers ${site.documentRoot}...`);

  // Déploiement atomique LOCAL : sert l'aperçu (/preview) et constitue la publication
  // en mode simulation.
  const siteDestDir = site.documentRoot;
  try {
    // Défensif : ne rien détruire hors périmètre (site aux données héritées)
    assertSafePath(siteDestDir, PUBLIC_HTML_DIR);
    // Garde : ne pas déployer un build sans sortie exploitable (dist vide malgré exit 0)
    if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error("Build sans sortie exploitable (dist/index.html absent) : déploiement annulé, site actuel préservé.");
    }
    // SEO et médias : non bloquants (un échec ici ne doit pas empêcher le déploiement)
    try {
      await writeSeoFiles(siteSlug, site, await readSitePages(siteSlug));
    } catch (seoErr) {
      appendBuildLog(`SEO non généré : ${seoErr.message}`);
    }
    try {
      const copied = copyReferencedMedia(await readSitePages(siteSlug));
      if (copied > 0) appendBuildLog(`Médias copiés dans le site : ${copied} fichier(s).`);
    } catch (mediaErr) {
      appendBuildLog(`Copie des médias échouée : ${mediaErr.message}`);
    }

    replaceDirAtomically(DIST_DIR, siteDestDir, siteSlug);
    appendBuildLog(`DÉPLOIEMENT LOCAL SUCCÈS : Fichiers synchronisés vers ${siteDestDir} !`);

    // Conserver une version horodatée pour le rollback (non bloquant si ça échoue)
    try {
      const releaseId = releases.saveRelease(RELEASES_DIR, siteSlug, DIST_DIR);
      const pruned = releases.pruneReleases(RELEASES_DIR, siteSlug, DEPLOY_KEEP_RELEASES);
      appendBuildLog(`Release ${releaseId} conservée${pruned.length ? ` (purge : ${pruned.join(', ')})` : ''}.`);
    } catch (relErr) {
      appendBuildLog(`Release non conservée : ${relErr.message}`);
    }
  } catch (deployError) {
    console.error(`Erreur de déploiement : ${deployError.message}`);
    appendBuildLog(`ERREUR DE DÉPLOIEMENT :\n${deployError.message}`, { gap: true });
    failBuild(siteSlug, site, deployError.message, deployError.message);
    return;
  }

  // Publication DISTANTE (mode cpanel uniquement ; no-op en simulation) : zip du dist,
  // upload et extraction sur l'hébergement o2switch, puis rafraîchissement du statut
  // SSL réel (AutoSSL). En cas d'échec distant, l'aperçu local reste intact mais le
  // build est marqué en erreur : en mode cpanel, l'intention est la mise en ligne.
  if (hosting.isRemote) {
    try {
      appendBuildLog(`Publication cPanel vers public_html/${siteSlug}...`);
      await hosting.publish(siteSlug, DIST_DIR);
      appendBuildLog(`PUBLICATION cPanel SUCCÈS (https://${site.domain}).`);
      try {
        const ssl = await hosting.getSslStatus(site.domain);
        await sitesStore.updateSite(siteSlug, { sslStatus: ssl });
        appendBuildLog(`Statut SSL (AutoSSL) : ${ssl}.`);
      } catch (sslErr) {
        // Non bloquant : le SSL AutoSSL peut mettre du temps, on garde le statut actuel
        appendBuildLog(`Statut SSL indisponible : ${sslErr.message}`);
      }
    } catch (remoteErr) {
      console.error(`Erreur de publication cPanel : ${remoteErr.message}`);
      appendBuildLog(`ERREUR DE PUBLICATION cPanel :\n${remoteErr.message}`, { gap: true });
      failBuild(siteSlug, site, `Publication cPanel échouée : ${remoteErr.message}`, remoteErr.message);
      return;
    }
  }

  buildStatus.status = "success";
  buildStatus.lastCompleted = new Date().toLocaleString();
  updateSiteStatus(siteSlug, 'active');
  finalizeBuild(siteSlug, site.name, 'success', stdout);
}

module.exports = {
  resetOnBoot,
  isValidBuildToken,
  getActiveBuildingSite,
  getBuildStatus,
  getQueue,
  isBusy,
  tryReserve,
  cancelReservation,
  setTrigger,
  enqueue,
  launch,
  runDraftPreview,
};
