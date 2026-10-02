// Briques HTTP transverses : réponses d'erreur, limiteurs de débit, parsing JSON.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { envInt } = require('./config');

// TRUST_PROXY : nombre de proxys de confiance (« 1 »), ou valeur Express telle quelle
// (« loopback », liste d'IP/CIDR). Vide, « false » ou « 0 » : désactivé.
function trustProxySetting(raw) {
  const value = String(raw || '').trim();
  if (!value || value === 'false' || value === '0') return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return 1;
  return value;
}

// Réponse d'erreur serveur : le détail (message, stack) est loggé côté serveur mais
// jamais renvoyé au réseau — le client reçoit un message générique. Réservé aux 500 ;
// les 400/403/404 métier conservent leur message explicite volontairement.
function sendError(res, publicMsg, err, status = 500) {
  console.error(`❌ [${status}] ${publicMsg} —`, (err && (err.stack || err.message)) || err);
  if (!res.headersSent) res.status(status).json({ error: publicMsg });
}

// --- Formulaires HTML postés sans JavaScript (sites publiés) ---

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function isHtmlFormPost(req) {
  return req.is('application/x-www-form-urlencoded') === 'application/x-www-form-urlencoded';
}

// Réponse à un formulaire posté SANS JavaScript (navigateur, application/x-www-form-
// urlencoded) : petite page lisible avec un lien de retour vers la page d'origine, jamais
// du JSON brut affiché au visiteur.
function sendFormPage(req, res, status, title, text) {
  let back = '';
  try {
    const ref = new URL(req.get('referer') || '');
    if (ref.protocol === 'http:' || ref.protocol === 'https:') back = ref.href;
  } catch { /* pas de page d'origine exploitable */ }
  res.status(status).type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;text-align:center;color:#222}a{color:#2563eb}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${back ? `<p><a href="${escapeHtml(back)}">← Revenir au site</a></p>` : ''}</body></html>`);
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
  contact: makeLimiter(10, "Trop de messages envoyés. Réessayez dans quelques minutes.", {
    handler: (req, res) => {
      const message = "Trop de messages envoyés. Réessayez dans quelques minutes.";
      if (isHtmlFormPost(req)) return sendFormPage(req, res, 429, 'Message non envoyé', message);
      res.status(429).json({ error: message });
    },
  }),
  // Beacon de stats : public, appelé une fois par page vue. Plafond généreux (une même
  // IP peut porter plusieurs visiteurs derrière un NAT) mais borné contre le flood.
  stats: makeLimiter(120, "Trop de requêtes."),
  // Domaine personnalisé : chaque appel peut déclencher une requête DNS et un appel cPanel.
  // Admin only, mais on borne quand même contre les boucles/abus. Monté route par route.
  domain: makeLimiter(30, "Trop d'opérations sur le domaine. Réessayez dans quelques minutes."),
  // Mot de passe oublié / réinitialisation (servis par Payload) : bornés contre l'envoi
  // massif d'emails et l'essai de jetons.
  passwordReset: makeLimiter(
    envInt('RL_PASSWORD_RESET_MAX', 10),
    "Trop de demandes de réinitialisation. Réessayez dans quelques minutes."
  ),
};

// Limiteurs montés par préfixe de chemin (le login est servi par Next : le limiter
// appelle next() vers lui).
function mountRateLimits(app) {
  app.use('/api/users/login', limiters.login);
  app.use('/api/users/forgot-password', limiters.passwordReset);
  app.use('/api/users/reset-password', limiters.passwordReset);
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

// Endpoints PUBLICS appelés par les sites publiés (formulaire de contact, beacon de
// statistiques) : CORS ouvert à toute origine, sans cookie, petit corps de requête.
const PUBLIC_ROUTE_PREFIXES = ['/api/contact', '/api/stats/hit'];

function isPublicRoute(reqPath) {
  return PUBLIC_ROUTE_PREFIXES.some((p) => reqPath === p || reqPath.startsWith(p + '/'));
}

// Limite du corps JSON selon la route (routes Express non publiques). null : méthode sans
// corps attendu (aucun handler GET/HEAD/DELETE/OPTIONS ne lit req.body).
//  - 10 Mo : onboarding (image d'inspiration en base64) ;
//  - 2 Mo : contenu éditorial (pages, articles, thème) ;
//  - 256 Ko : le reste (formulaires d'administration, IA, domaines…).
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);
const ROUTE_JSON_LIMITS = [
  { prefixes: ['/api/onboard'], limit: '10mb' },
  { prefixes: ['/api/site-pages', '/api/site-posts', '/api/theme'], limit: '2mb' },
];
const DEFAULT_JSON_LIMIT = '256kb';

const matchesPrefix = (reqPath, p) => reqPath === p || reqPath.startsWith(p + '/');

function jsonLimitFor(method, reqPath) {
  if (BODYLESS_METHODS.has(String(method || '').toUpperCase())) return null;
  const rule = ROUTE_JSON_LIMITS.find((r) => r.prefixes.some((p) => matchesPrefix(reqPath, p)));
  return rule ? rule.limit : DEFAULT_JSON_LIMIT;
}

// Un parser par limite, créé une seule fois au chargement du module. Les endpoints
// publics (32 Ko) acceptent aussi un formulaire HTML classique (sans JavaScript).
const jsonParsers = new Map(
  [DEFAULT_JSON_LIMIT, ...ROUTE_JSON_LIMITS.map((r) => r.limit)].map((limit) => [limit, express.json({ limit })])
);
const publicJsonParser = express.json({ limit: '32kb' });
const publicFormParser = express.urlencoded({ extended: false, limit: '32kb' });
function jsonBodyForExpressRoutes(req, res, next) {
  if (!isExpressRoute(req.path)) return next();
  if (isPublicRoute(req.path)) {
    return publicJsonParser(req, res, (err) => (err ? next(err) : publicFormParser(req, res, next)));
  }
  const limit = jsonLimitFor(req.method, req.path);
  if (!limit) return next();
  jsonParsers.get(limit)(req, res, next);
}

// Dernier middleware : erreurs non gérées rendues en JSON (jamais la page HTML par
// défaut d'Express, qui peut contenir une stack en développement).
// eslint-disable-next-line no-unused-vars
function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Formulaire d'un site publié posté sans JavaScript : page HTML plutôt que JSON
  if (isPublicRoute(req.path) && isHtmlFormPost(req) && err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    const tooLarge = err.type === 'entity.too.large';
    return sendFormPage(req, res, tooLarge ? 413 : 400, 'Message non envoyé', tooLarge ? 'Votre message est trop long.' : 'Formulaire invalide.');
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: "Corps de requête JSON invalide." });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: "Corps de requête trop volumineux." });
  }
  const status = err && Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: "Requête invalide." });
  }
  sendError(res, "Erreur interne du serveur.", err);
}

// Enveloppe un handler : une exception ou une promesse rejetée est transmise au
// gestionnaire d'erreurs JSON au lieu de laisser la requête sans réponse (Express 4
// ignore les promesses). Les middlewares d'erreur (4 arguments) sont laissés tels quels.
function asyncHandler(fn) {
  if (typeof fn !== 'function' || fn.length === 4) return fn;
  return function wrapped(req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

// Router Express dont tous les handlers sont protégés par asyncHandler.
function createRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (routePath, ...handlers) => register(routePath, ...handlers.map(asyncHandler));
  }
  return router;
}

module.exports = {
  sendError,
  isHtmlFormPost,
  sendFormPage,
  makeLimiter,
  limiters,
  mountRateLimits,
  EXPRESS_ROUTE_PREFIXES,
  isExpressRoute,
  isPublicRoute,
  jsonLimitFor,
  jsonBodyForExpressRoutes,
  jsonErrorHandler,
  asyncHandler,
  createRouter,
  trustProxySetting,
};
