// Assemblage de l'application Express. L'ORDRE de montage est significatif :
// CORS → en-têtes de sécurité → limiteurs → parsing JSON → statiques → routes →
// fallback Next (Payload admin + REST) en dernier.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { FRONTEND_ORIGINS, PUBLIC_HTML_DIR, DRAFTS_DIR } = require('./core/config');
const { mountRateLimits, jsonBodyForExpressRoutes } = require('./core/http');

const ROUTERS = [
  require('./routes/sites'),
  require('./routes/admin'),
  require('./routes/content'),
  require('./routes/domains'),
  require('./routes/public'),
  require('./routes/ai'),
  require('./routes/build'),
];

function createApp({ nextHandler }) {
  const app = express();

  // Derrière un reverse-proxy (o2switch/nginx), faire confiance au proxy pour déduire
  // l'IP client réelle (utilisée par le rate-limit). Conditionné par env : en dev/CI on ne
  // fait PAS confiance (sinon X-Forwarded-For serait usurpable pour contourner la limite).
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }

  app.use(cors({ origin: FRONTEND_ORIGINS, credentials: true }));

  // En-têtes de sécurité HTTP. CSP désactivée : elle casserait l'admin Payload (Next) et
  // les assets injectés ; CORP désactivée car l'orchestrateur est servi sur une autre
  // origine en dev. Le reste (nosniff, frameguard, HSTS…) est conservé. CORS monté avant
  // pour que même les réponses 429 du rate-limit portent les en-têtes cross-origin.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  mountRateLimits(app);
  app.use(jsonBodyForExpressRoutes);

  // Journal des requêtes API (diagnostic)
  app.use((req, res, next) => {
    if (req.url.includes('NaN') || req.url.includes('api')) {
      console.log(`🔍 [HTTP] ${req.method} ${req.url}`);
    }
    next();
  });

  // Sites générés servis sous /preview/<slug>/ (le préfixe /sites est réservé aux
  // routes du dashboard React).
  app.use('/preview', express.static(PUBLIC_HTML_DIR));
  // Prévisualisations brouillon : contenu non publié, jamais indexé par les moteurs.
  app.use('/draft', (req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  }, express.static(DRAFTS_DIR));

  for (const router of ROUTERS) app.use(router);

  // Tout le reste : Next.js (admin Payload, API REST Payload, login…)
  app.all('*', (req, res) => nextHandler(req, res));

  return app;
}

module.exports = { createApp };
