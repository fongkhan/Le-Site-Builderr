// Briques HTTP transverses : réponses d'erreur, limiteurs de débit, parsing JSON.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { envInt } = require('./config');

// Réponse d'erreur serveur : le détail (message, stack) est loggé côté serveur mais
// jamais renvoyé au réseau — le client reçoit un message générique. Réservé aux 500 ;
// les 400/403/404 métier conservent leur message explicite volontairement.
function sendError(res, publicMsg, err, status = 500) {
  console.error(`❌ [${status}] ${publicMsg} —`, (err && (err.stack || err.message)) || err);
  if (!res.headersSent) res.status(status).json({ error: publicMsg });
}

// --- Limiteurs de débit (anti brute-force / anti-abus) ---
// Montés AVANT le catch-all Next : sur succès ils appellent next() et laissent
// Next/Payload traiter la requête (flux intact) ; au-delà du seuil ils renvoient 429 JSON.
const RL_WINDOW_MS = 15 * 60 * 1000;
const makeLimiter = (limit, message, extra = {}) => rateLimit({
  windowMs: RL_WINDOW_MS,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: message }),
  ...extra,
});

const limiters = {
  // Login : ne compte QUE les échecs (skipSuccessfulRequests) — un usage légitime ne
  // consomme jamais le budget ; seules les tentatives ratées (brute-force) comptent.
  login: makeLimiter(
    envInt('RL_LOGIN_MAX', 8),
    "Trop de tentatives de connexion échouées. Réessayez dans quelques minutes.",
    { skipSuccessfulRequests: true }
  ),
  onboard: makeLimiter(30, "Trop de générations demandées. Réessayez dans quelques minutes."),
  webhook: makeLimiter(60, "Trop de requêtes de build reçues. Réessayez plus tard."),
  contact: makeLimiter(10, "Trop de messages envoyés. Réessayez dans quelques minutes."),
  // Beacon de stats : public, appelé une fois par page vue. Plafond généreux (une même
  // IP peut porter plusieurs visiteurs derrière un NAT) mais borné contre le flood.
  stats: makeLimiter(120, "Trop de requêtes."),
  // Domaine personnalisé : chaque appel peut déclencher une requête DNS et un appel cPanel.
  // Admin only, mais on borne quand même contre les boucles/abus. Monté route par route.
  domain: makeLimiter(30, "Trop d'opérations sur le domaine. Réessayez dans quelques minutes."),
};

// Limiteurs montés par préfixe de chemin (le login est servi par Next : le limiter
// appelle next() vers lui).
function mountRateLimits(app) {
  app.use('/api/users/login', limiters.login);
  app.use('/api/onboard', limiters.onboard);
  app.use('/webhook/rebuild', limiters.webhook);
  app.use('/api/contact', limiters.contact);
  app.use('/api/stats', limiters.stats);
}

// Le parsing JSON ne s'applique QU'AUX routes Express custom : les routes déléguées à
// Next/Payload (login, REST Payload, /admin) doivent recevoir leur flux de requête intact.
const EXPRESS_ROUTE_PREFIXES = ['/api/sites', '/api/site-pages', '/api/site-posts', '/api/theme', '/api/config', '/api/onboard', '/api/build-status', '/api/hosting', '/api/contact', '/api/ai', '/api/stats', '/api/admin', '/webhook', '/internal'];

function isExpressRoute(reqPath) {
  return EXPRESS_ROUTE_PREFIXES.some((p) => reqPath === p || reqPath.startsWith(p + '/'));
}

const jsonParser = express.json({ limit: '10mb' });
function jsonBodyForExpressRoutes(req, res, next) {
  if (!isExpressRoute(req.path)) return next();
  jsonParser(req, res, next);
}

module.exports = {
  sendError,
  makeLimiter,
  limiters,
  mountRateLimits,
  EXPRESS_ROUTE_PREFIXES,
  isExpressRoute,
  jsonBodyForExpressRoutes,
};
