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

// Chemin d'API canonique, tel que Next et Payload le résolvent : Next décode les segments
// de la route catch-all (/api/users/%6Cogin → login) et Payload compare les chemins sans
// tenir compte de la casse (/api/users/LOGIN). Sert aux limiteurs et au hook de login.
// Encodage invalide : chaîne brute conservée (Next répondra 400).
function canonicalApiPath(raw) {
  let p = String(raw ?? '').split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    // encodage invalide : chemin laissé tel quel
  }
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

module.exports = { isLoginFailure, isAnonymousHttpCreate, canonicalApiPath, isLoginPath, loginFailureReason };
