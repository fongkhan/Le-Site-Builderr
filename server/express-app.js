// Assemblage de l'application Express. L'ORDRE de montage est significatif :
// CORS → en-têtes de sécurité → limiteurs → parsing JSON → statiques → routes →
// fallback Next (Payload admin + REST) → gestionnaire d'erreurs JSON.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { FRONTEND_ORIGINS, PUBLIC_HTML_DIR, DRAFTS_DIR, IS_PRODUCTION } = require('./core/config');
const { mountRateLimits, jsonBodyForExpressRoutes, jsonErrorHandler, isPublicRoute, trustProxySetting, sendSignInPage } = require('./core/http');
const auth = require('./auth');
const { isValidSlug } = require('./lib/paths');

const ROUTERS = [
  require('./routes/sites'),
  require('./routes/admin'),
  require('./routes/content'),
  require('./routes/domains'),
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

// Fichiers statiques (/preview, /draft) : les formats interprétables par le navigateur
// (SVG, XML, XSL) peuvent porter du script ; ils sont servis dans un bac à sable sans
// script ni ressource externe.
const SANDBOXED_EXT = /\.(svgz?|xml|xsl)$/i;
const staticOptions = {
  setHeaders(res, filePath) {
    if (SANDBOXED_EXT.test(filePath)) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
  },
};

// Copies de bascule (dossier.tmp-*, dossier.old-*) d'une publication interrompue : jamais
// servies.
const SWAP_DIR = /\.(tmp|old)-/;
function hideSwapDirs(req, res, next) {
  let decoded = req.path;
  try { decoded = decodeURIComponent(req.path); } catch { /* chemin brut */ }
  if (SWAP_DIR.test(req.path) || SWAP_DIR.test(decoded)) return res.status(404).end();
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

// Brouillon non publié : jamais conservé par un cache partagé ni par le navigateur.
const noStore = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};

function createApp({ nextHandler }) {
  const app = express();

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
  app.use('/preview', noindex, hideSwapDirs, express.static(PUBLIC_HTML_DIR, staticOptions));
  app.use('/draft', auth.authenticate, guardDraft, noindex, noStore, hideSwapDirs, express.static(DRAFTS_DIR, staticOptions));

  for (const router of ROUTERS) app.use(router);

  // Tout le reste : Next.js (admin Payload, API REST Payload, login…)
  app.all('*', (req, res) => nextHandler(req, res));

  app.use(jsonErrorHandler);

  return app;
}

module.exports = { createApp };
