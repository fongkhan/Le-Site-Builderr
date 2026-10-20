// Assemblage de l'application Express. L'ORDRE de montage est significatif :
// CORS → en-têtes de sécurité → limiteurs → parsing JSON → statiques → routes →
// interface de l'orchestrateur (production) → /_next/image fermé → fallback Next (Payload
// admin + REST) → gestionnaire d'erreurs JSON.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./core/config');
const { FRONTEND_ORIGINS, PUBLIC_HTML_DIR, DRAFTS_DIR, IS_PRODUCTION } = config;
const { mountRateLimits, jsonBodyForExpressRoutes, jsonErrorHandler, isPublicRoute, trustProxySetting, sendSignInPage, isForgotPasswordPath, runForgotPassword } = require('./core/http');
const auth = require('./auth');
const { isValidSlug } = require('./lib/paths');
const { isSwapDirRequest } = require('./lib/fs-swap');
const fs = require('fs');
const path = require('path');
const { assertSafePath } = require('./lib/paths');
const { notFoundCandidates } = require('./lib/static-404');
const { isShuttingDown } = require('./core/shutdown');
const { isOrchestratorPagePath } = require('./lib/spa-routes');

const ROUTERS = [
  require('./routes/health'),
  require('./routes/sites'),
  require('./routes/admin'),
  require('./routes/system'),
  require('./routes/content'),
  require('./routes/media'),
  require('./routes/domains'),
  require('./routes/legal'),
  require('./routes/public'),
  require('./routes/ai'),
  require('./routes/build'),
];

// CORS : l'orchestrateur (origines configurées, avec cookies) ; les endpoints publics
// des sites publiés (formulaire de contact, beacon) acceptent toute origine sans cookie.
// Le preflight OPTIONS d'un formulaire envoyé en JSON depuis un autre domaine passe
// donc bien par la politique publique.
const privateCors = { origin: FRONTEND_ORIGINS, credentials: true };
const publicCors = { origin: '*' };
const corsPolicy = cors((req, callback) => callback(null, isPublicRoute(req.path) ? publicCors : privateCors));

// Les copies servies par l'orchestrateur ne doivent pas être indexées (contenu dupliqué
// du site publié sur son vrai domaine, ou brouillon non publié).
const noindex = (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
};

// Fichiers statiques (/preview, /draft) : CSP selon le type (lib/static-csp.js) — bac à
// sable sans script pour SVG, XML et XSL (formats interprétables pouvant porter du
// script) ; pages HTML sans plugin, sans <base> externe, jamais encadrées par un autre site.
const { staticCspFor } = require('./lib/static-csp');
const staticOptions = {
  setHeaders(res, filePath) {
    const csp = staticCspFor(filePath);
    if (csp) res.setHeader('Content-Security-Policy', csp);
  },
};

// Copies de bascule (dossier.tmp-*, dossier.old-*) d'une publication interrompue : jamais
// servies. Seul le PREMIER segment est concerné (dossiers frères des sites) : un média
// « affiche.old-2023.png » reste servi.
function hideSwapDirs(req, res, next) {
  if (isSwapDirRequest(req.path)) return res.status(404).end();
  next();
}

// Brouillons : réservés aux comptes ayant accès au site (le premier segment du chemin est
// le slug). Un navigateur sans session reçoit une page lisible plutôt que du JSON.
const draftSlugOf = (req) => req.path.split('/')[1] || '';
const draftSiteAccess = auth.requireSiteAccess(draftSlugOf);
function guardDraft(req, res, next) {
  if (!req.user) {
    if (req.accepts(['json', 'html']) === 'html') {
      return sendSignInPage(res, 401, 'Brouillon protégé', "Connectez-vous à l'orchestrateur pour voir ce brouillon.", `${FRONTEND_ORIGINS[0]}/login`);
    }
    return res.status(401).json({ error: "Authentification requise. Veuillez vous connecter." });
  }
  // Slug invalide ou absent (traversée encodée…) : 400, jamais résolu en chemin
  if (!isValidSlug(draftSlugOf(req))) {
    return res.status(400).json({ error: "Identifiant de site invalide." });
  }
  draftSiteAccess(req, res, next);
}

// Fichier absent sous /preview ou /draft : la page 404 du site (la plus proche du chemin
// demandé : /en/404.html pour une page anglaise), sinon une page lisible (navigateur) ou du
// JSON (API) — jamais la 404 de Next. Lecture plutôt que sendFile : jamais de 304 sur une 404.
function siteNotFound(root) {
  return (req, res) => {
    for (const rel of notFoundCandidates(req.path)) {
      const file = path.join(root, ...rel.split('/'));
      try {
        assertSafePath(file, root);
        if (!fs.statSync(file).isFile()) continue;
        return res.status(404).type('html').send(fs.readFileSync(file));
      } catch {
        // candidat absent, illisible ou hors de la racine : suivant
      }
    }
    if (req.accepts(['html', 'json']) === 'html') {
      return sendSignInPage(res, 404, 'Page introuvable', "Cette page n'existe pas (ou plus) sur ce site.");
    }
    res.status(404).json({ error: 'Ressource introuvable.' });
  };
}

// Brouillon non publié : jamais conservé par un cache partagé ni par le navigateur.
const noStore = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};

// Interface de l'orchestrateur compilée (production) : fichiers de dist (/assets/* en
// cache long, noms versionnés par Vite) puis, pour toute page de l'application
// (lib/spa-routes.js) demandée par un navigateur, index.html — jamais mis en cache,
// jamais indexé, jamais encadré par un autre site (frame-ancestors est ignoré dans la
// balise <meta> de la CSP : posé ici en en-tête). Lecture paresseuse de la configuration
// (les tests la redirigent).
function setOrchestratorPageHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
}

function mountOrchestrator(app) {
  const distDir = config.ORCHESTRATOR_DIST_DIR;
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    console.warn('⚠️ [Orchestrateur] orchestrator/dist absent : cd orchestrator && npm run build (ou SERVE_ORCHESTRATOR=false si l\'interface est hébergée ailleurs)');
    return;
  }
  const assetsDir = path.join(distDir, 'assets') + path.sep;
  app.use(express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.startsWith(assetsDir)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (filePath === indexFile) setOrchestratorPageHeaders(res);
    },
  }));
  app.get('*', (req, res, next) => {
    if (!isOrchestratorPagePath(req.path) || !req.accepts('html')) return next();
    setOrchestratorPageHeaders(res);
    res.sendFile(indexFile, { cacheControl: false }, (err) => {
      if (err) next(err);
    });
  });
  console.log('✔ [Orchestrateur] Interface servie depuis orchestrator/dist');
}

function createApp({ nextHandler }) {
  const app = express();

  // Arrêt en cours : la connexion est fermée après la réponse (aucun keep-alive ne retient
  // le client sur un serveur qui s'arrête).
  app.use((req, res, next) => {
    if (isShuttingDown()) res.setHeader('Connection', 'close');
    next();
  });

  // Derrière un reverse-proxy (o2switch/nginx), faire confiance au proxy pour déduire
  // l'IP client réelle (utilisée par le rate-limit). Conditionné par env : en dev/CI on ne
  // fait PAS confiance (sinon X-Forwarded-For serait usurpable pour contourner la limite).
  const trustProxy = trustProxySetting(process.env.TRUST_PROXY);
  if (trustProxy !== null) app.set('trust proxy', trustProxy);

  app.use(corsPolicy);

  // En-têtes de sécurité HTTP. CSP désactivée : elle casserait l'admin Payload (Next) et
  // les assets injectés ; CORP désactivée car l'orchestrateur est servi sur une autre
  // origine en dev. Le reste (nosniff, frameguard, HSTS…) est conservé. CORS monté avant
  // pour que même les réponses 429 du rate-limit portent les en-têtes cross-origin.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  mountRateLimits(app);
  app.use(jsonBodyForExpressRoutes);

  // Journal des requêtes API (diagnostic) : en développement, ou sur demande (HTTP_DEBUG).
  if (!IS_PRODUCTION || process.env.HTTP_DEBUG === 'true') {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
        console.log(`🔍 [HTTP] ${req.method} ${req.path}`);
      }
      next();
    });
  }

  // Sites générés servis sous /preview/<slug>/ (le préfixe /sites est réservé aux
  // routes du dashboard React) et brouillons sous /draft/<slug>/ (accès contrôlé).
  app.use('/preview', noindex, hideSwapDirs, express.static(PUBLIC_HTML_DIR, staticOptions), siteNotFound(PUBLIC_HTML_DIR));
  app.use('/draft', auth.authenticate, guardDraft, noindex, noStore, hideSwapDirs, express.static(DRAFTS_DIR, staticOptions), siteNotFound(DRAFTS_DIR));

  for (const router of ROUTERS) app.use(router);

  // Production : l'interface de l'orchestrateur sur la même origine que l'API
  if (config.SERVE_ORCHESTRATOR) mountOrchestrator(app);

  // Optimiseur d'images de Next jamais atteint (désactivé dans next.config.mjs : RCE de
  // l'optimiseur AVIF, SSRF) : 404 JSON. Couvre aussi le proxy /_next de Vite en dev.
  app.all('/_next/image', (req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

  // Tout le reste : Next.js (admin Payload, API REST Payload, login…). Mot de passe
  // oublié : file d'attente bornée (core/http.js), tenue jusqu'à la fin du traitement.
  app.all('*', (req, res, next) => {
    if (!isForgotPasswordPath(req.path)) return nextHandler(req, res);
    runForgotPassword(req, res, () => nextHandler(req, res)).catch(next);
  });

  app.use(jsonErrorHandler);

  return app;
}

module.exports = { createApp };
