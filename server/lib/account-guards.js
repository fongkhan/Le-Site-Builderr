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

module.exports = { isLoginFailure, isAnonymousHttpCreate };
