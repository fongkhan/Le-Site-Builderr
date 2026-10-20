// Gardes de la collection users (hooks Payload), en fonctions pures testables.

// Échec de login à masquer derrière un message unique (identifiants invalides OU compte
// verrouillé). On se fonde sur le statut HTTP, jamais sur le nom de classe de l'erreur :
// le bundle serveur de Next est minifié en production (noms de classes raccourcis), si
// bien que error.name n'y vaut plus « LockedAuth » ni « AuthenticationError ». Les deux
// erreurs sont en 401 ; UnverifiedEmail (403) et les erreurs de validation (400) ne sont
// pas concernées.
function isLoginFailure(error) {
  return Boolean(error) && Number(error.status) === 401;
}

// Création de compte par un appel HTTP (REST, GraphQL) sans utilisateur connecté.
// Couvre POST /api/users/first-register (écran /admin/create-first-user) : Payload y
// crée le premier compte (rôle admin compris) sans contrôle d'accès dès que la table
// users est vide. Les comptes sont créés par un admin ou par le seed (API locale).
function isAnonymousHttpCreate({ operation, req }) {
  return operation === 'create' && !(req && req.user) && (!req || req.payloadAPI !== 'local');
}

// Chemin d'API canonique, tel que Next et Payload le résolvent : Next résout les segments
// « . » et « .. » (y compris %2e) comme l'URL WHATWG puis décode les segments de la route
// catch-all (/api/users/%6Cogin → login) ; Payload compare les chemins sans tenir compte
// de la casse (/api/users/LOGIN). Sert aux limiteurs et au hook de login.
// Segment mal encodé : laissé brut (Next répondra 400).
function canonicalApiPath(raw) {
  let p = String(raw ?? '').split('?')[0];
  try {
    // Origine fixe devant le chemin : « //hôte/… » reste un chemin
    p = new URL(`http://x${p.startsWith('/') ? '' : '/'}${p}`).pathname;
  } catch {
    // chemin non analysable : laissé tel quel
  }
  p = p.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join('/');
  p = p.toLowerCase().replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function isLoginPath(raw) {
  return canonicalApiPath(raw) === '/api/users/login';
}

// Motif d'un échec de login pour le journal : compte verrouillé (message de LockedAuth,
// dans la langue de la requête) ou identifiants refusés.
function loginFailureReason(error, lockedMessage) {
  return lockedMessage && error && error.message === lockedMessage ? 'verrouille' : 'identifiants';
}

// Changement de mot de passe noté PAR COMPTE dans le contexte de la requête (hooks
// beforeChange → afterChange). Une mise à jour groupée (PATCH /api/users?where=…) traite
// ses comptes en parallèle avec le même contexte : un drapeau unique, remis à zéro par le
// premier compte traité, ferait perdre l'audit des suivants.
function markPasswordChange(context, id) {
  if (!context || id === undefined || id === null) return;
  if (!(context.passwordChangedIds instanceof Set)) context.passwordChangedIds = new Set();
  context.passwordChangedIds.add(String(id));
}

function hasPasswordChange(context, id) {
  return Boolean(context && context.passwordChangedIds instanceof Set && context.passwordChangedIds.has(String(id)));
}

function clearPasswordChange(context, id) {
  if (context && context.passwordChangedIds instanceof Set) context.passwordChangedIds.delete(String(id));
}

module.exports = {
  isLoginFailure,
  isAnonymousHttpCreate,
  canonicalApiPath,
  isLoginPath,
  loginFailureReason,
  markPasswordChange,
  hasPasswordChange,
  clearPasswordChange,
};
