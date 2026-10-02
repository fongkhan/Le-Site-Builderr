// Pipeline de build Astro : verrou, file d'attente, compilation, déploiement atomique,
// releases, publication distante, historique et notifications.
// Astro écrit dans un dossier dist unique : un seul build (ou brouillon) à la fois.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runCommand } = require('../lib/run-command');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const releases = require('../lib/releases');
const seo = require('../lib/seo');
const media = require('../lib/media');
const i18n = require('../lib/i18n');
const { assertSafePath, assertStrictlyInside, previewPathFor } = require('../lib/paths');
const { replaceDirAtomically, recoverInterruptedSwaps } = require('../lib/fs-swap');
const { getPayloadInstance } = require('../core/payload');
const { sendMail } = require('../core/mail');
const { LOG_PATH_MASKS, redactLogText, appendBuildLog, appendRawBuildLog, resetBuildLog } = require('../core/build-log');
const { createPathRedactor, displayPath } = require('../lib/log-redact');
const {
  envInt,
  PORT,
  PROJECT_DIR,
  ASTRO_PROJECT_DIR,
  DIST_DIR,
  LOCK_FILE,
  PUBLIC_HTML_DIR,
  DRAFTS_DIR,
  RELEASES_DIR,
  UPLOADS_DIR,
  DEPLOY_KEEP_RELEASES,
} = require('../core/config');
const { applySiteThemeCss, findPayloadSiteId, readSitePages, readSitePosts } = require('./content');
const { getSiteOwners, updateSiteStatus } = require('./sites');

const BUILD_TIMEOUT_MS = envInt('BUILD_TIMEOUT_MS', 10 * 60 * 1000);

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
// Le déclencheur d'un build EN FILE est gardé à part : il ne doit pas écraser celui du
// build en cours du même site.
const buildTriggers = new Map();
const queuedTriggers = new Map();
const buildStartTimes = new Map();

// Site concerné par le journal de build courant (en cours ou dernier terminé) : seuls
// l'admin et les propriétaires de ce site peuvent lire les logs.
let logSite = null;

// Verrou mémoire synchrone : posé AVANT tout await pour fermer la fenêtre TOCTOU
// (deux webhooks concurrents ne peuvent plus démarrer deux builds simultanés).
let buildLockHeld = false;

// Site en cours de compilation (repli du canal interne quand ?site= est absent) et
// chemin de base sous lequel il sera servi (préfixe des URLs de médias).
let activeBuildingSite = null;
let activeBasePath = '/';

// Vider les logs + reprise après crash : verrou orphelin, bascules de dossiers
// interrompues (site écarté en .old restauré, copies .tmp supprimées) et releases
// partielles.
function resetOnBoot() {
  resetBuildLog('Initialisation du système de build...\n');
  buildLockHeld = false;
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    appendRawBuildLog('Verrou de build orphelin détecté et nettoyé au démarrage.\n');
  }
  // Détail (noms de dossiers d'autres sites) dans le journal du serveur seulement : le
  // journal de build est lisible par tout client tant qu'aucun build n'a eu lieu.
  const actions = [];
  for (const [label, root] of [['production', PUBLIC_HTML_DIR], ['brouillons', DRAFTS_DIR]]) {
    for (const action of recoverInterruptedSwaps(root)) actions.push(`${label} : ${action}`);
  }
  try {
    for (const removed of releases.removePartialReleases(RELEASES_DIR)) actions.push(`releases : partielle supprimée : ${removed}`);
  } catch (err) {
    actions.push(`releases : échec du nettoyage : ${err.message}`);
  }
  for (const action of actions) console.warn(`♻️ [Reprise] ${action}`);
  if (actions.length > 0) {
    appendRawBuildLog(`Reprise après un arrêt brutal : ${actions.length} dossier(s) de déploiement remis en ordre.\n`);
  }
}

// Comparaison à temps constant (pas d'indice sur le jeton via le temps de réponse).
function isValidBuildToken(value) {
  if (typeof value !== 'string' || value.length !== BUILD_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(BUILD_TOKEN));
}

// Site dont le build vient d'être lancé (avant que buildingSite ne soit posé) et site
// dont le brouillon est en cours : la suppression d'un site les consulte (isSiteBusy).
let launchingSite = null;
let draftSite = null;

// Vrai si un build ou un brouillon de CE site est en cours (ou en train de démarrer).
function isSiteBusy(siteSlug) {
  return Boolean(siteSlug) && (buildStatus.buildingSite === siteSlug || launchingSite === siteSlug || draftSite === siteSlug);
}

// Retire un site de la file d'attente (site supprimé). Vrai s'il y attendait.
function dequeue(siteSlug) {
  const idx = buildQueue.indexOf(siteSlug);
  if (idx === -1) return false;
  buildQueue.splice(idx, 1);
  queuedTriggers.delete(siteSlug);
  appendBuildLog(`FILE D'ATTENTE : "${siteSlug}" retiré (site supprimé).`);
  return true;
}

// Vrai si le site a été supprimé depuis le lancement de son build ou de son brouillon :
// rien ne doit alors être déployé ni publié (fichiers remis en ligne sans site pour les
// retirer, brouillon hérité par un futur site du même slug). Base injoignable : on ne
// conclut pas à une suppression.
async function siteWasDeleted(siteSlug) {
  try {
    return !(await sitesStore.getSiteBySlug(siteSlug));
  } catch {
    return false;
  }
}

function getActiveBuildingSite() {
  return activeBuildingSite;
}

function getActiveBasePath() {
  return activeBasePath;
}

// Chemin sous lequel le site compilé sera servi : à la racine de son domaine en mode
// cPanel ; sous /preview/<dossier du site>/ (publication simulée) ou /draft/<slug>/
// (brouillon) sur l'orchestrateur. Astro préfixe CSS, JS et liens internes avec ce chemin.
function basePathFor(site, siteSlug, { draft = false } = {}) {
  if (draft) return `/draft/${siteSlug}`;
  return hosting.isRemote ? '/' : previewPathFor(site && site.documentRoot, PUBLIC_HTML_DIR, siteSlug);
}

function getBuildStatus() {
  return buildStatus;
}

function getQueue() {
  return [...buildQueue];
}

function getLogSite() {
  return buildStatus.buildingSite || logSite;
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

// Libère une réservation (fin d'opération exclusive ou réservation prise à tort) et
// relance la file d'attente.
function release() {
  buildLockHeld = false;
  launchingSite = null;
  drainQueue();
}

// Lance un build dont le créneau est déjà réservé ; un échec de lancement libère le
// verrou et relance la file.
function launch(siteSlug, triggeredBy, failureLabel = 'Erreur de lancement du build :') {
  buildTriggers.set(siteSlug, triggeredBy || 'système');
  launchingSite = siteSlug;
  startBuild(siteSlug).catch((e) => {
    console.error(failureLabel, e.message);
    buildStatus.inProgress = false;
    buildStatus.buildingSite = null;
    try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    release();
  });
}

// Ajoute un site à la file (dédupliquée). Renvoie sa position (1-based).
function enqueue(siteSlug, triggeredBy) {
  const existingIdx = buildQueue.indexOf(siteSlug);
  if (existingIdx !== -1) return existingIdx + 1;
  const position = buildQueue.push(siteSlug);
  queuedTriggers.set(siteSlug, triggeredBy || 'système');
  appendBuildLog(`FILE D'ATTENTE : "${siteSlug}" ajouté (position ${position}).`);
  return position;
}

// Dépile et lance le build suivant. Appelée à CHAQUE fin de build (succès ou erreur).
function drainQueue() {
  if (buildQueue.length === 0 || buildLockHeld || fs.existsSync(LOCK_FILE)) return;
  const nextSlug = buildQueue.shift();
  const triggeredBy = queuedTriggers.get(nextSlug);
  queuedTriggers.delete(nextSlug);
  buildLockHeld = true; // réserver le créneau avant l'await de startBuild
  appendBuildLog(`FILE D'ATTENTE : lancement du build suivant (${nextSlug}), ${buildQueue.length} restant(s).`);
  launch(nextSlug, triggeredBy, 'Erreur de lancement du build en file :');
}

// Variables du serveur jamais transmises au build (npm install exécute des scripts
// tiers) : base de données (DATABASE_URI/URL, POSTGRES_*, PG*, DB_*), secrets, clés
// d'API, identifiants SMTP/cPanel.
const SECRET_ENV = /(SECRET|PASSWORD|PASSWD|PASS$|TOKEN|API_KEY|_KEY$|DATABASE_UR[IL]|^POSTGRES_|^PG|^DB_|^CPANEL_|^SMTP_|^SEED_)/i;

function sanitizedEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_ENV.test(key)) out[key] = value;
  }
  return out;
}

// Environnement du process de build : site actif, jeton d'accès interne, métadonnées
// publiques (Open Graph, JSON-LD) et mesure d'audience. Un brouillon n'a ni URL
// publique (pas de canonique vers la prod) ni mesure d'audience ni beacon de stats.
function buildEnvFor(site, siteSlug, { draft = false } = {}) {
  return {
    ...sanitizedEnv(),
    ACTIVE_SITE_SLUG: siteSlug,
    BUILD_TOKEN,
    ORCHESTRATOR_URL: `http://127.0.0.1:${PORT}`,
    SITE_BASE_PATH: basePathFor(site, siteSlug, { draft }),
    // Origine publique de l'API (formulaire de contact, prise de RDV, statistiques).
    // Vide : même origine que le site (aperçu servi par l'orchestrateur).
    PUBLIC_API_BASE: String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, ''),
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
    // Lecture seule : un site supprimé pendant son build n'est jamais recréé.
    const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
    if (!siteId) return;
    await payloadInstance.create({
      collection: 'builds',
      data: { site: siteId, status, durationMs, triggeredBy, logExcerpt: String(excerpt || '').slice(-1500) },
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

// Plafond de la sortie recopiée dans le journal pour un build (le fichier est sondé par
// l'orchestrateur pendant tout le build).
const MAX_BUILD_OUTPUT_BYTES = 5 * 1024 * 1024;

// Commande en cours (build ou brouillon) : arrêt gracieux du serveur (abortCurrent).
let currentRun = null;

// Exécute la commande de build dans le template (callback (error, stdout, stderr) ; stdout
// et stderr valent tous deux la fin de la sortie entrelacée). Borné dans le temps : au
// délai maximal, TOUT l'arbre de processus est tué (npm, astro…) et le callback n'est
// appelé qu'une fois tous les descripteurs fermés, avant que le build suivant ne reprenne
// le dist. log=true : la sortie est recopiée en direct dans le journal (plafonnée) ; un
// brouillon ne l'écrit pas (journal lisible par les propriétaires du dernier build).
function runAstroBuild(command, env, callback, { log = true } = {}) {
  let written = 0;
  let capped = false;
  const writeOutput = (text) => {
    if (capped || !text) return;
    const bytes = Buffer.byteLength(text);
    if (written + bytes > MAX_BUILD_OUTPUT_BYTES) {
      capped = true;
      appendRawBuildLog('\n[… sortie tronquée …]\n');
      return;
    }
    written += bytes;
    appendRawBuildLog(text);
  };
  // Chemins serveur masqués dans la sortie recopiée (journal lu par le client propriétaire)
  const redactor = createPathRedactor(LOG_PATH_MASKS);
  const onOutput = log ? (raw) => writeOutput(redactor.push(raw)) : undefined;
  const flushOutput = () => { if (log) writeOutput(redactor.flush()); };

  let run;
  try {
    run = runCommand(command, { cwd: ASTRO_PROJECT_DIR, env, timeoutMs: BUILD_TIMEOUT_MS, onOutput });
  } catch (err) {
    return callback(err, '', '');
  }
  currentRun = run;
  run.promise.then(
    ({ code, signal, timedOut, tail }) => {
      if (currentRun === run) currentRun = null;
      flushOutput();
      let error = null;
      if (timedOut) {
        error = new Error(`Build interrompu après ${Math.round(BUILD_TIMEOUT_MS / 1000)} s (délai maximal BUILD_TIMEOUT_MS dépassé).`);
      } else if (code !== 0) {
        error = new Error(signal ? `Build interrompu (signal ${signal}).` : `Build échoué (code de sortie ${code}).`);
      }
      callback(error, tail, tail);
    },
    (err) => {
      if (currentRun === run) currentRun = null;
      callback(err, '', '');
    }
  );
}

// Arrêt gracieux : tue l'arbre de processus du build en cours (s'il y en a un). Le build
// se termine alors en erreur par son chemin normal (verrou libéré dans le finally).
function abortCurrent() {
  if (!currentRun) return false;
  currentRun.kill();
  return true;
}

// Commande de build : installe les dépendances du template au premier build, et à
// nouveau quand son package-lock.json a changé depuis la dernière installation
// (nouvelle dépendance après une mise à jour : polices auto-hébergées…).
function templateNeedsInstall() {
  const installedLock = path.join(ASTRO_PROJECT_DIR, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(installedLock)) return true;
  try {
    return fs.statSync(path.join(ASTRO_PROJECT_DIR, 'package-lock.json')).mtimeMs > fs.statSync(installedLock).mtimeMs;
  } catch {
    return false;
  }
}

function buildCommand() {
  return `${templateNeedsInstall() ? 'npm install --no-audit --no-fund && ' : ''}npm run build`;
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
    await applySiteThemeCss(siteSlug);
    activeBuildingSite = siteSlug;
    activeBasePath = basePathFor(site, siteSlug, { draft: true });

    await new Promise((resolve, reject) => {
      runAstroBuild(buildCommand(), buildEnvFor(site, siteSlug, { draft: true }), (error, stdout, stderr) => {
        if (error) return reject(new Error(`Build brouillon échoué : ${error.message}\n${String(stderr || stdout).slice(-500)}`));
        resolve();
      }, { log: false });
    });

    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error('Build brouillon sans sortie exploitable.');
    }

    // Images de la médiathèque : réécrites en /draft/<slug>/media/ par le canal interne,
    // elles doivent être présentes dans le brouillon (non bloquant)
    try {
      await copyReferencedMedia(siteSlug, await readSitePages(siteSlug), await readSitePosts(siteSlug, { publishedOnly: true }));
    } catch (mediaErr) {
      console.error(`Médias du brouillon non copiés : ${mediaErr.message}`);
    }

    // Site supprimé pendant la compilation : aucun brouillon écrit (il survivrait à la
    // purge et serait servi au propriétaire d'un futur site du même slug).
    if (await siteWasDeleted(siteSlug)) {
      throw new Error('Site supprimé pendant la prévisualisation : brouillon abandonné.');
    }

    // Publication atomique dans le dossier de brouillons (jamais dans PUBLIC_HTML_DIR)
    const destDir = path.join(DRAFTS_DIR, siteSlug);
    assertSafePath(destDir, DRAFTS_DIR);
    replaceDirAtomically(DIST_DIR, destDir, 'draft');

    return `/draft/${siteSlug}/index.html`;
  } finally {
    activeBuildingSite = null;
    activeBasePath = '/';
    try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  }
}

// Brouillon exclusif : compile puis libère le créneau et relance la file.
// Précondition : le créneau a été réservé par l'appelant (tryReserve).
async function runDraftPreview(siteSlug) {
  draftSite = siteSlug;
  try {
    return await startDraftBuild(siteSlug);
  } finally {
    draftSite = null;
    release(); // un build en attente peut repartir
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
    launchingSite = null;
    drainQueue();
    return;
  }

  // Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;
  buildStatus.buildingSite = siteSlug;
  logSite = siteSlug;
  buildStartTimes.set(siteSlug, Date.now());

  resetBuildLog('');
  appendBuildLog(`DÉMARRAGE : Build du site "${site.name}" (${siteSlug})...`);

  // Thème du site appliqué au template CSS avant compilation
  await applySiteThemeCss(siteSlug);

  // Site actif pour le routage dynamique d'Astro
  activeBuildingSite = siteSlug;
  activeBasePath = basePathFor(site, siteSlug);

  const cmd = buildCommand();
  appendBuildLog(`Commande exécutée : ${cmd} (dans ${displayPath(ASTRO_PROJECT_DIR, PROJECT_DIR)})`);

  runAstroBuild(cmd, buildEnvFor(site, siteSlug), (error, stdout, stderr) => {
    // Le traitement du résultat est async (publication distante éventuelle) mais le
    // point de sortie reste UNIQUE : libération des verrous dans le finally.
    handleBuildResult(siteSlug, site, error, stdout, stderr)
      .catch((e) => {
        console.error('Erreur inattendue de post-build :', e.message);
        failBuild(siteSlug, site, 'Erreur interne de déploiement.', e.message);
      })
      .finally(() => {
        try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
        // buildingSite n'est remis à zéro qu'ici, APRÈS le statut final : l'orchestrateur
        // détecte la fin du build et lit success/error au même sondage.
        buildStatus.buildingSite = null;
        buildStatus.inProgress = false;
        release();
      });
  });
}

// Marque le build en erreur (statut, site, historique) — chemin de sortie commun.
// Le message et l'extrait sont lisibles par le client (statut, historique) : chemins masqués.
function failBuild(siteSlug, site, publicError, excerpt) {
  buildStatus.status = "error";
  buildStatus.error = redactLogText(publicError);
  updateSiteStatus(siteSlug, 'error');
  finalizeBuild(siteSlug, site.name, 'error', redactLogText(excerpt || ''));
}

// SEO : sitemap.xml + robots.txt générés dans le dist avant publication.
// Chemins localisés : la langue par défaut est à la racine, les autres préfixées
// (/en/…). '' (accueil de la langue par défaut) est représenté par « home ».
// En mode cPanel (site à la racine de son domaine), .htaccess : page 404, cache,
// compression. Jamais en publication simulée : la base /preview/<dossier>/ rendrait
// « ErrorDocument 404 /404.html » faux, et Express n'utilise pas ce fichier.
function writeSeoFiles(site, pagesData, postsData) {
  const htaccess = require('../lib/htaccess');
  // Exactement les routes générées par le template : jamais d'URL en 404 dans le sitemap
  // (une page CMS d'adresse « 404 » est réservée : voir i18n.RESERVED_ROOT_SLUGS).
  const slugs = i18n.publishedRoutes(pagesData.docs, postsData.docs);
  if (slugs.length > 0) {
    fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), seo.generateSitemap(site.domain, slugs), 'utf-8');
    fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), seo.generateRobots(site.domain), 'utf-8');
  }
  if (hosting.isRemote && basePathFor(site, site && site.slug) === '/') {
    fs.writeFileSync(path.join(DIST_DIR, '.htaccess'), htaccess.generateHtaccess(), 'utf-8');
  }
}

// Noms des fichiers de la médiathèque qui appartiennent au site : un contenu qui cite le
// fichier d'un autre client (nom deviné) ne le publie jamais.
async function ownedMediaFilenames(siteSlug, filenames) {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance || filenames.length === 0) return new Set();
  const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
  if (!siteId) return new Set();
  const res = await payloadInstance.find({
    collection: 'media',
    where: { and: [{ site: { equals: siteId } }, { filename: { in: filenames } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return new Set(res.docs.map((d) => d.filename).filter(Boolean));
}

// Médiathèque : copie dans le dist les images du site référencées par les pages et les
// articles publiés (couvertures, images du corps) — URLs /media/… réécrites par le canal
// interne : le site publié est autonome. Seules les images matricielles sont publiées
// (jamais un SVG hérité d'avant la restriction des formats). Renvoie { copied, ignored }.
async function copyReferencedMedia(siteSlug, pagesData, postsData) {
  const { isPublishableMediaName } = require('../lib/media-policy');
  const filenames = media.collectMediaFilenames({ pages: pagesData, posts: postsData }).filter(isPublishableMediaName);
  if (filenames.length === 0) return { copied: 0, ignored: 0 };
  const owned = await ownedMediaFilenames(siteSlug, filenames);
  const mediaOut = path.join(DIST_DIR, 'media');
  let copied = 0;
  for (const name of filenames) {
    const src = path.join(UPLOADS_DIR, path.basename(name));
    if (owned.has(name) && fs.existsSync(src)) {
      fs.mkdirSync(mediaOut, { recursive: true });
      fs.copyFileSync(src, path.join(mediaOut, path.basename(name)));
      copied++;
    }
  }
  return { copied, ignored: filenames.length - owned.size };
}

// Build d'un site supprimé en cours de route : ni déploiement, ni publication, ni
// statut ou historique écrit sur un site qui n'existe plus.
function cancelDeletedSiteBuild(siteSlug) {
  appendBuildLog(`ANNULÉ : le site "${siteSlug}" a été supprimé pendant le build, rien n'est déployé.`, { gap: true });
  buildStatus.status = "error";
  buildStatus.error = "Site supprimé pendant le build : déploiement annulé.";
  buildStartTimes.delete(siteSlug);
  buildTriggers.delete(siteSlug);
}

async function handleBuildResult(siteSlug, site, error, stdout, stderr) {
  activeBuildingSite = null;
  activeBasePath = '/';

  if (error) {
    console.error(`Erreur de build : ${error.message}`);
    // La sortie a déjà été recopiée en direct dans le journal
    appendBuildLog(`ERREUR DE BUILD :\n${error.message}`, { gap: true });
    failBuild(siteSlug, site, error.message, `${error.message}\n${stderr || ''}`);
    return;
  }

  appendBuildLog(`Astro compilé. Déploiement atomique vers ${displayPath(site.documentRoot, PROJECT_DIR)}...`);

  // Déploiement atomique LOCAL : sert l'aperçu (/preview) et constitue la publication
  // en mode simulation.
  const siteDestDir = site.documentRoot;
  try {
    // Défensif : ne rien détruire hors périmètre, ni la racine partagée elle-même
    assertStrictlyInside(siteDestDir, PUBLIC_HTML_DIR);
    // Garde : ne pas déployer un build sans sortie exploitable (dist vide malgré exit 0)
    if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error("Build sans sortie exploitable (dist/index.html absent) : déploiement annulé, site actuel préservé.");
    }
    // SEO et médias : non bloquants (un échec ici ne doit pas empêcher le déploiement).
    // Contenu lu une seule fois pour les deux étapes.
    let pagesData = { docs: [] };
    let postsData = { docs: [] };
    try {
      pagesData = await readSitePages(siteSlug);
      postsData = await readSitePosts(siteSlug, { publishedOnly: true });
    } catch (readErr) {
      appendBuildLog(`Contenu non relu pour le SEO et les médias : ${readErr.message}`);
    }
    try {
      writeSeoFiles(site, pagesData, postsData);
    } catch (seoErr) {
      appendBuildLog(`SEO non généré : ${seoErr.message}`);
    }
    try {
      const { copied, ignored } = await copyReferencedMedia(siteSlug, pagesData, postsData);
      if (copied > 0) appendBuildLog(`Médias copiés dans le site : ${copied} fichier(s).`);
      if (ignored > 0) appendBuildLog(`Médias ignorés (absents de la médiathèque du site) : ${ignored} fichier(s).`);
    } catch (mediaErr) {
      appendBuildLog(`Copie des médias échouée : ${mediaErr.message}`);
    }

    // Site supprimé pendant le build : rien n'est déployé ni publié
    if (await siteWasDeleted(siteSlug)) {
      cancelDeletedSiteBuild(siteSlug);
      return;
    }

    replaceDirAtomically(DIST_DIR, siteDestDir, siteSlug);
    appendBuildLog(`DÉPLOIEMENT LOCAL SUCCÈS : Fichiers synchronisés vers ${displayPath(siteDestDir, PROJECT_DIR)} !`);

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
    if (await siteWasDeleted(siteSlug)) {
      cancelDeletedSiteBuild(siteSlug);
      return;
    }
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
  getActiveBasePath,
  basePathFor,
  getBuildStatus,
  getQueue,
  getLogSite,
  isBusy,
  tryReserve,
  release,
  enqueue,
  launch,
  runDraftPreview,
  isSiteBusy,
  dequeue,
  sanitizedEnv,
  abortCurrent,
};
