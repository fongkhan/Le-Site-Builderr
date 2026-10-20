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
const { serializeQueue, parseQueue } = require('../lib/build-queue');
const { writeJsonAtomic } = require('../lib/json-file');
const { trackBackground } = require('../core/shutdown');
const { BUILD_QUEUE_FILE } = require('../core/config');
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

// File d'attente FIFO de slugs (dédupliquée), conservée sur disque à chaque changement
// (data/build-queue.json, relue au démarrage par restoreQueue). Le verrou physique
// orphelin est nettoyé au boot (resetOnBoot).
const buildQueue = [];

// Arrêt du serveur en cours (beginShutdown) : plus aucun build lancé, la file est gardée.
let draining = false;
// Fichier de la file : null tant que restoreQueue n'a pas été appelé (persistance inactive :
// les tests unitaires n'écrivent jamais dans data/).
let queueFile = null;
// Raison de l'interruption du build en cours : 'shutdown' → remis en file, pas d'échec.
let abortReason = null;
// Site d'une opération exclusive réservée (rollback, brouillon, webhook) : vu par isSiteBusy.
let reservedSite = null;
// Sites en cours de suppression (nombre de suppressions en cours par slug) : ni rollback,
// ni brouillon, ni publication demandée pour eux tant qu'elle dure.
const deletingSites = new Map();

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

// Sauvegarde de la file (après chaque changement) : un arrêt, même brutal, ne perd jamais
// une publication acceptée (202 « en file »). Inactive tant que restoreQueue n'a pas été
// appelé. Un échec d'écriture est journalisé, jamais bloquant.
function persistQueue() {
  if (!queueFile) return;
  try {
    const entries = buildQueue.map((slug) => ({ slug, triggeredBy: queuedTriggers.get(slug) || 'système' }));
    writeJsonAtomic(queueFile, serializeQueue(entries), { pretty: false });
  } catch (e) {
    console.error("⚠️ [Build] File d'attente non sauvegardée :", e.message);
  }
}

// Démarrage : relit la file conservée et relance les publications en attente. La relecture
// et la remise en file sont synchrones (aucun build ne peut s'intercaler) ; les sites
// supprimés pendant l'arrêt sont ensuite écartés. Le journal de build (lisible par
// d'autres clients) ne cite aucun slug. Renvoie le nombre de publications relancées.
async function restoreQueue({ file = BUILD_QUEUE_FILE } = {}) {
  if (draining) return 0;
  let entries = [];
  try {
    entries = parseQueue(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('♻️ [Reprise] File de builds illisible, ignorée :', e.message);
  }
  queueFile = file;
  const restored = [];
  for (const { slug, triggeredBy } of entries) {
    if (buildQueue.includes(slug)) continue;
    buildQueue.push(slug);
    queuedTriggers.set(slug, triggeredBy);
    restored.push(slug);
  }
  persistQueue();

  for (const slug of restored) {
    let site;
    try {
      site = await sitesStore.getSiteBySlug(slug);
    } catch {
      continue; // base injoignable : gardé (startBuild revérifie)
    }
    if (site) continue;
    const idx = buildQueue.indexOf(slug);
    if (idx !== -1) {
      buildQueue.splice(idx, 1);
      queuedTriggers.delete(slug);
    }
    console.warn(`♻️ [Reprise] build de « ${slug} » abandonné : site supprimé.`);
  }

  const remaining = restored.filter((slug) => buildQueue.includes(slug));
  persistQueue();
  if (remaining.length === 0) return 0;
  console.log(`♻️ [Reprise] File de builds restaurée : ${remaining.length} site(s) (${remaining.join(', ')}).`);
  appendBuildLog(`REPRISE : ${remaining.length} publication(s) en attente relancée(s) après le redémarrage.`);
  drainQueue();
  return remaining.length;
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

// Vrai si un build, un brouillon ou une opération réservée (rollback) de CE site est en
// cours (ou en train de démarrer).
function isSiteBusy(siteSlug) {
  return Boolean(siteSlug) && (buildStatus.buildingSite === siteSlug || launchingSite === siteSlug || draftSite === siteSlug || reservedSite === siteSlug);
}

// Suppression d'un site en cours (DELETE /api/sites/:slug) : posée de façon synchrone
// juste après le contrôle isSiteBusy, retirée en fin de suppression (succès ou échec).
function markDeleting(siteSlug) {
  if (!siteSlug) return;
  deletingSites.set(siteSlug, (deletingSites.get(siteSlug) || 0) + 1);
}

function unmarkDeleting(siteSlug) {
  const count = deletingSites.get(siteSlug) || 0;
  if (count <= 1) deletingSites.delete(siteSlug);
  else deletingSites.set(siteSlug, count - 1);
}

function isSiteDeleting(siteSlug) {
  return Boolean(siteSlug) && deletingSites.has(siteSlug);
}

// Retire un site de la file d'attente (site supprimé). Vrai s'il y attendait.
function dequeue(siteSlug) {
  const idx = buildQueue.indexOf(siteSlug);
  if (idx === -1) return false;
  buildQueue.splice(idx, 1);
  queuedTriggers.delete(siteSlug);
  persistQueue();
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
// siteSlug : site concerné, visible par isSiteBusy (une suppression attend la fin). Jamais
// de réservation pendant l'arrêt du serveur.
function tryReserve(siteSlug = null) {
  if (draining || isBusy()) return false;
  buildLockHeld = true;
  reservedSite = siteSlug || null;
  return true;
}

// Libère une réservation (fin d'opération exclusive ou réservation prise à tort) et
// relance la file d'attente.
function release() {
  buildLockHeld = false;
  launchingSite = null;
  reservedSite = null;
  drainQueue();
}

// Lance un build dont le créneau est déjà réservé ; un échec de lancement libère le
// verrou et relance la file.
function launch(siteSlug, triggeredBy, failureLabel = 'Erreur de lancement du build :') {
  if (draining) {
    // Créneau réservé juste avant l'arrêt : le site repart en tête de file, et sera publié
    // au redémarrage
    const idx = buildQueue.indexOf(siteSlug);
    if (idx !== -1) buildQueue.splice(idx, 1);
    buildQueue.unshift(siteSlug);
    queuedTriggers.set(siteSlug, triggeredBy || 'système');
    persistQueue();
    buildLockHeld = false;
    launchingSite = null;
    reservedSite = null;
    return;
  }
  buildTriggers.set(siteSlug, triggeredBy || 'système');
  launchingSite = siteSlug;
  reservedSite = null; // relayé par launchingSite puis buildingSite
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
  persistQueue();
  appendBuildLog(`FILE D'ATTENTE : "${siteSlug}" ajouté (position ${position}).`);
  return position;
}

// Dépile et lance le build suivant. Appelée à CHAQUE fin de build (succès ou erreur).
// Jamais pendant l'arrêt du serveur : la file est conservée pour le redémarrage.
function drainQueue() {
  if (draining || buildQueue.length === 0 || buildLockHeld || fs.existsSync(LOCK_FILE)) return;
  const nextSlug = buildQueue.shift();
  const triggeredBy = queuedTriggers.get(nextSlug);
  queuedTriggers.delete(nextSlug);
  persistQueue();
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
function buildEnvFor(site, siteSlug, { draft = false, logo = null } = {}) {
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
    PUBLIC_SITE_LOGO: logo ? logo.staticPath : '', // logo vérifié (resolveSiteLogo), jamais hérité de l'environnement
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

  // Tâches de fond attendues par l'arrêt propre (core/shutdown)
  trackBackground((async () => {
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) return;
    // Lecture seule : un site supprimé pendant son build n'est jamais recréé.
    const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
    if (!siteId) return;
    await payloadInstance.create({
      collection: 'builds',
      data: { site: siteId, status, durationMs, triggeredBy, logExcerpt: buildHistoryExcerpt(excerpt) },
      overrideAccess: true,
    });
  })()).catch((e) => console.error('Historique de build non enregistré :', e.message));

  trackBackground(notifyBuildResult(siteSlug, siteName, status, durationMs)).catch((e) =>
    console.error('Notification de build non envoyée :', e.message)
  );
}

// Extrait de sortie conservé dans l'historique des builds (lisible par le client
// propriétaire), quel que soit le statut : chemins du serveur masqués, 1 500 derniers
// caractères.
function buildHistoryExcerpt(text) {
  return redactLogText(String(text || '')).slice(-1500);
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
  // Arrêt du serveur commencé pendant la préparation (thème, lecture du site) : rien n'est
  // compilé, le build est remis en file comme s'il avait été interrompu
  if (draining) {
    const error = new Error('Build interrompu : le serveur redémarre.');
    error.interrupted = true;
    return callback(error, '', '');
  }
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
      if (abortReason === 'shutdown' && !timedOut) {
        // Interrompu par l'arrêt du serveur : remis en file, ni échec ni notification
        error = new Error('Build interrompu : le serveur redémarre.');
        error.interrupted = true;
      } else if (timedOut) {
        error = new Error(`Build interrompu après ${Math.round(BUILD_TIMEOUT_MS / 1000)} s (délai maximal BUILD_TIMEOUT_MS dépassé).`);
      } else if (code !== 0) {
        error = new Error(signal ? `Build interrompu (signal ${signal}).` : `Build échoué (code de sortie ${code}).`);
      }
      abortReason = null;
      callback(error, tail, tail);
    },
    (err) => {
      if (currentRun === run) currentRun = null;
      abortReason = null;
      callback(err, '', '');
    }
  );
}

// Tue l'arbre de processus du build en cours (s'il y en a un). Le build se termine alors
// par son chemin normal (verrou libéré dans le finally) : en erreur, ou remis en file si
// reason vaut 'shutdown'.
function abortCurrent({ reason = null } = {}) {
  if (!currentRun) return false;
  abortReason = reason;
  currentRun.kill();
  return true;
}

// Arrêt du serveur : plus aucun build lancé, file sauvegardée, build en cours interrompu
// (il sera remis en tête de file). Vrai si un build a été interrompu.
function beginShutdown() {
  draining = true;
  persistQueue();
  return abortCurrent({ reason: 'shutdown' });
}

// Remet un build interrompu par l'arrêt en tête de file (repris au redémarrage). Ni statut
// de site, ni historique, ni email : ce n'est pas un échec.
function requeueForRestart(siteSlug, message) {
  if (buildQueue[0] !== siteSlug) {
    const idx = buildQueue.indexOf(siteSlug);
    if (idx !== -1) buildQueue.splice(idx, 1);
    buildQueue.unshift(siteSlug);
    queuedTriggers.set(siteSlug, buildTriggers.get(siteSlug) || queuedTriggers.get(siteSlug) || 'système');
  }
  buildStartTimes.delete(siteSlug);
  buildTriggers.delete(siteSlug);
  buildStatus.status = 'error';
  buildStatus.error = message;
  appendBuildLog(`INTERROMPU : ${message}`, { gap: true });
  persistQueue();
}

// Délai d'arrêt dépassé pendant une publication : le site est remis en tête de file avant
// la sortie du process (dont le gestionnaire 'exit' tue l'arbre du build). Vrai si remis.
function requeueCurrentForRestart() {
  const siteSlug = buildStatus.buildingSite;
  if (!siteSlug || buildQueue[0] === siteSlug) return false;
  requeueForRestart(siteSlug, "Arrêt du serveur pendant la publication : le déploiement reprendra au redémarrage.");
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
  if (draining) { const e = new Error('Le serveur redémarre.'); e.interrupted = true; throw e; }
  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) throw new Error('Site introuvable.');

  fs.writeFileSync(LOCK_FILE, 'locked');
  try {
    // Thème courant appliqué au template avant compilation (comme un vrai build) ; logo
    // vérifié (le journal de build n'est pas écrit par un brouillon : console seule)
    const theme = await applySiteThemeCss(siteSlug);
    let logo = null;
    try {
      logo = await resolveSiteLogo(siteSlug, theme);
    } catch (logoErr) {
      console.error(`Logo du brouillon non vérifié : ${logoErr.message}`);
    }
    activeBuildingSite = siteSlug;
    activeBasePath = basePathFor(site, siteSlug, { draft: true });

    await new Promise((resolve, reject) => {
      runAstroBuild(buildCommand(), buildEnvFor(site, siteSlug, { draft: true, logo }), (error, stdout, stderr) => {
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
    if (logo) {
      try { copyLogo(logo); } catch (logoErr) { console.error(`Logo du brouillon non copié : ${logoErr.message}`); }
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

  // Thème du site appliqué au template CSS avant compilation. Avertissements de
  // lisibilité dans le journal (jamais bloquants) ; logo vérifié (médiathèque du site).
  const theme = await applySiteThemeCss(siteSlug);
  for (const { message } of require('../lib/theme').themeContrastWarnings(theme)) {
    appendBuildLog(`Avertissement d'accessibilité : ${message}`);
  }
  let logo = null;
  try {
    logo = await resolveSiteLogo(siteSlug, theme);
    if (theme && theme.logo && !logo) appendBuildLog('Logo ignoré : image absente de la médiathèque du site.');
  } catch (logoErr) {
    appendBuildLog(`Logo non vérifié : ${logoErr.message}`);
  }

  // Site actif pour le routage dynamique d'Astro
  activeBuildingSite = siteSlug;
  activeBasePath = basePathFor(site, siteSlug);

  const cmd = buildCommand();
  appendBuildLog(`Commande exécutée : ${cmd} (dans ${displayPath(ASTRO_PROJECT_DIR, PROJECT_DIR)})`);

  runAstroBuild(cmd, buildEnvFor(site, siteSlug, { logo }), (error, stdout, stderr) => {
    // Le traitement du résultat est async (publication distante éventuelle) mais le
    // point de sortie reste UNIQUE : libération des verrous dans le finally.
    handleBuildResult(siteSlug, site, error, stdout, stderr, logo)
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

// Logo du thème publiable avec le site : fichier de la médiathèque DU SITE (jamais celui
// d'un autre client cité par son nom) présent sur le disque. Sinon null : le nom du site
// s'affiche dans l'en-tête et l'icône d'onglet reprend son initiale.
async function resolveSiteLogo(siteSlug, theme) {
  const { logoFilename, publishableLogo } = require('../lib/theme');
  const name = logoFilename(theme && theme.logo);
  if (!name) return null;
  if (!(await require('./content').siteOwnsMedia(siteSlug, name))) return null;
  const logo = publishableLogo(theme, new Set([name]));
  return logo && fs.existsSync(path.join(UPLOADS_DIR, path.basename(logo.name))) ? logo : null;
}

// Copie le fichier du logo dans le site compilé (dist/media/<nom>), servi sous le chemin
// de base comme les autres médias.
function copyLogo(logo) {
  const name = path.basename(logo.name);
  const mediaOut = path.join(DIST_DIR, 'media');
  fs.mkdirSync(mediaOut, { recursive: true });
  fs.copyFileSync(path.join(UPLOADS_DIR, name), path.join(mediaOut, name));
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

// Fiches de la médiathèque qui appartiennent au site (Map nom → fiche) : un contenu qui
// cite le fichier d'un autre client (nom deviné) ne le publie jamais.
async function ownedMediaDocs(siteSlug, filenames) {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance || filenames.length === 0) return new Map();
  const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
  if (!siteId) return new Map();
  const res = await payloadInstance.find({
    collection: 'media',
    where: { and: [{ site: { equals: siteId } }, { filename: { in: filenames } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return new Map(res.docs.filter((d) => d.filename).map((d) => [d.filename, d]));
}

// Médiathèque : copie dans le dist les images du site référencées par les pages et les
// articles publiés (couvertures, images du corps) — URLs /media/… réécrites par le canal
// interne : le site publié est autonome. Seules les images matricielles sont publiées
// (jamais un SVG hérité d'avant la restriction des formats), avec leurs variantes
// redimensionnées (dist/media/w<largeur>/<nom>, annoncées par /internal/site-media).
// Renvoie { copied, ignored: [noms], missing: [noms], resized, variantCopies } : noms
// absents de la médiathèque du site, et fichiers introuvables sur le disque.
async function copyReferencedMedia(siteSlug, pagesData, postsData) {
  const { isPublishableMediaName } = require('../lib/media-policy');
  const { publishMediaFiles } = require('../lib/media-variants');
  const names = media.collectMediaFilenames({ pages: pagesData, posts: postsData }).filter(isPublishableMediaName);
  if (names.length === 0) return { copied: 0, ignored: [], missing: [], resized: 0, variantCopies: 0 };
  return publishMediaFiles({
    names,
    ownedDocs: await ownedMediaDocs(siteSlug, names),
    uploadsDir: UPLOADS_DIR,
    outDir: path.join(DIST_DIR, 'media'),
  });
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

async function handleBuildResult(siteSlug, site, error, stdout, stderr, logo = null) {
  activeBuildingSite = null;
  activeBasePath = '/';
  if (error && error.interrupted) {
    requeueForRestart(siteSlug, "Build interrompu par l'arrêt du serveur : il reprendra automatiquement au redémarrage.");
    return;
  }

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
      const { copied, ignored, missing, resized, variantCopies } = await copyReferencedMedia(siteSlug, pagesData, postsData);
      // Noms des médias écartés dans le journal (neutralisés, bornés) : diagnostic d'une image absente du site
      const { summarizeNames } = require('../lib/media-library');
      if (copied > 0) appendBuildLog(`Médias copiés dans le site : ${copied} fichier(s)${resized > 0 ? `, ${resized} variante(s) redimensionnée(s)` : ''}.`);
      if (variantCopies > 0) appendBuildLog(`Variantes non redimensionnées (copie de l'original) : ${variantCopies}.`);
      if (ignored.length > 0) appendBuildLog(`Médias ignorés (absents de la médiathèque du site) : ${summarizeNames(ignored)}.`);
      if (missing.length > 0) appendBuildLog(`Médias introuvables sur le disque : ${summarizeNames(missing)}.`);
    } catch (mediaErr) {
      appendBuildLog(`Copie des médias échouée : ${mediaErr.message}`);
    }
    if (logo) {
      try { copyLogo(logo); } catch (logoErr) { appendBuildLog(`Logo non copié : ${logoErr.message}`); }
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
      const published = await hosting.publish(siteSlug, DIST_DIR);
      appendBuildLog(`PUBLICATION cPanel SUCCÈS (https://${site.domain}) — archive de ${((Number(published && published.bytes) || 0) / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo.`);
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
  buildEnvFor,
  abortCurrent,
  restoreQueue,
  persistQueue,
  beginShutdown,
  requeueCurrentForRestart,
  markDeleting,
  unmarkDeleting,
  isSiteDeleting,
  buildHistoryExcerpt,
};
