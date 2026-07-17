// Middlewares d'authentification / autorisation basés sur l'auth Payload CMS.
// Le front se connecte via les routes REST Payload (/api/users/login) qui posent
// le cookie httpOnly `payload-token` ; ici on vérifie ce cookie sur chaque requête Express.

const DEV_NO_AUTH = process.env.DEV_NO_AUTH === 'true';

let getPayloadInstance = () => null;

// payloadInstance est assigné après le boot de Payload : on passe un getter, jamais la valeur.
function init(getter) {
  getPayloadInstance = getter;
}

// payload.auth() attend des Headers WHATWG, Express fournit un objet brut.
function toWebHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function isAdmin(user) {
  return Boolean(user && Array.isArray(user.roles) && user.roles.includes('admin'));
}

// Résout req.user + req.userSiteSlugs depuis le cookie Payload. Ne rejette pas :
// les gardes requireAuth/requireAdmin/requireSiteAccess décident ensuite.
async function authenticate(req, res, next) {
  if (DEV_NO_AUTH) {
    req.user = { id: 'dev', email: 'dev@localhost', roles: ['admin'], devMode: true };
    req.userSiteSlugs = new Set();
    return next();
  }

  const payload = getPayloadInstance();
  if (!payload) {
    return res.status(503).json({
      error: "Authentification indisponible : la base de données (DATABASE_URI) est requise. En développement local uniquement, DEV_NO_AUTH=true permet de passer outre."
    });
  }

  try {
    const { user } = await payload.auth({ headers: toWebHeaders(req) });
    if (user) {
      req.user = user;
      req.userSiteSlugs = new Set();
      if (!isAdmin(user)) {
        // Recharge avec depth:1 pour garantir des relations peuplées (objets avec slug)
        const fullUser = await payload.findByID({
          collection: 'users',
          id: user.id,
          depth: 1,
          overrideAccess: true
        });
        for (const site of fullUser.sites || []) {
          if (site && typeof site === 'object' && site.slug) {
            req.userSiteSlugs.add(site.slug);
          }
        }
      }
    }
    next();
  } catch (err) {
    console.error('[Auth] Erreur de vérification de session :', err.message);
    res.status(500).json({ error: "Erreur interne d'authentification." });
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentification requise. Veuillez vous connecter." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentification requise. Veuillez vous connecter." });
  }
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }
  next();
}

// Garde d'ownership : l'admin passe toujours, un client seulement sur SES slugs.
// getSlug extrait le slug visé de la requête ; s'il est absent -> 400 (pas de fallback implicite).
function requireSiteAccess(getSlug) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentification requise. Veuillez vous connecter." });
    }
    const slug = getSlug(req);
    if (!slug) {
      return res.status(400).json({ error: "Le paramètre ?site=<slug> est requis." });
    }
    if (isAdmin(req.user)) return next();
    if (!req.userSiteSlugs || !req.userSiteSlugs.has(slug)) {
      return res.status(403).json({ error: "Vous n'avez pas accès à ce site." });
    }
    next();
  };
}

module.exports = {
  init,
  authenticate,
  requireAuth,
  requireAdmin,
  requireSiteAccess,
  isAdmin,
  DEV_NO_AUTH
};
