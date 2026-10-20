import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isLoginFailure, isAnonymousHttpCreate } = require('../../lib/account-guards.js');

test('isLoginFailure — statut 401, quel que soit le nom de classe (bundle minifié)', () => {
  // En production, Next minifie le bundle serveur : LockedAuth devient une classe « e »
  class e extends Error {
    constructor() {
      super('This user is locked due to having too many failed login attempts.');
      this.status = 401;
    }
  }
  assert.notEqual(new e().name, 'LockedAuth');
  assert.equal(isLoginFailure(new e()), true);
  assert.equal(isLoginFailure({ name: 'AuthenticationError', status: 401 }), true);
});

test('isLoginFailure — autres erreurs non réécrites', () => {
  assert.equal(isLoginFailure({ name: 'UnverifiedEmail', status: 403 }), false);
  assert.equal(isLoginFailure({ name: 'ValidationError', status: 400 }), false);
  assert.equal(isLoginFailure(new Error('boom')), false);
  assert.equal(isLoginFailure(null), false);
});

test('isAnonymousHttpCreate — first-register et création REST/GraphQL anonymes refusés', () => {
  assert.equal(isAnonymousHttpCreate({ operation: 'create', req: { user: null, payloadAPI: 'REST' } }), true);
  assert.equal(isAnonymousHttpCreate({ operation: 'create', req: { payloadAPI: 'GraphQL' } }), true);
});

test('isAnonymousHttpCreate — seed (API locale), utilisateur connecté et autres opérations autorisés', () => {
  assert.equal(isAnonymousHttpCreate({ operation: 'create', req: { payloadAPI: 'local' } }), false);
  assert.equal(isAnonymousHttpCreate({ operation: 'create', req: { user: { id: 1, roles: ['admin'] }, payloadAPI: 'REST' } }), false);
  assert.equal(isAnonymousHttpCreate({ operation: 'login', req: { payloadAPI: 'REST' } }), false);
  assert.equal(isAnonymousHttpCreate({ operation: 'resetPassword', req: { payloadAPI: 'REST' } }), false);
  assert.equal(isAnonymousHttpCreate({ operation: 'forgotPassword', req: { payloadAPI: 'REST' } }), false);
});

test('canonicalApiPath / isLoginPath — formes du chemin servies par Next et Payload', () => {
  const { canonicalApiPath, isLoginPath } = require('../../lib/account-guards.js');
  for (const p of ['/api/users/login', '/api/users/login/', '/api/users/LOGIN', '/api/users/%6Cogin', '/api/%75sers/login', '/api//users/login', '/api/users/login?x=1']) {
    assert.equal(isLoginPath(p), true, p);
    assert.equal(canonicalApiPath(p), '/api/users/login', p);
  }
  for (const p of ['/api/users/me', '/api/users/loginx', '/api/users/%E0%A4%A', '/api/users', '', undefined]) {
    assert.equal(isLoginPath(p), false, String(p));
  }
  // Encodage invalide : chaîne brute (sans exception), casse normalisée
  assert.equal(canonicalApiPath('/API/users/%E0%A4%A'), '/api/users/%e0%a4%a');
  assert.equal(canonicalApiPath(''), '/');
  assert.equal(canonicalApiPath('/'), '/');
});

test('canonicalApiPath — segments « . » et « .. » (même encodés) résolus comme par Next', () => {
  const { canonicalApiPath, isLoginPath } = require('../../lib/account-guards.js');
  const { authLimiterFor } = require('../../core/http.js');
  for (const p of ['/api/users/./login', '/api/users/%2e/login', '/api/users/%2E%2E/users/login', '/api/users/x/../login', '/api/users/x/.%2e/login', '/api/x/%2e%2e/users/login/.', '/api/users\\login']) {
    assert.equal(canonicalApiPath(p), '/api/users/login', p);
    assert.equal(isLoginPath(p), true, p);
    assert.equal(authLimiterFor(p), 'login', p);
  }
  for (const p of ['/api/users/%2e/forgot-password', '/api/users/x/../forgot-password', '/api/users/./reset-password']) {
    assert.equal(authLimiterFor(p), 'passwordReset', p);
  }
  // Chemin commençant par « // » : jamais lu comme un hôte
  assert.equal(canonicalApiPath('//evil/api/users/login'), '/evil/api/users/login');
  // Segment mal encodé : laissé brut, les autres segments décodés
  assert.equal(canonicalApiPath('/api/%75sers/%E0%A4%A'), '/api/users/%e0%a4%a');
  assert.equal(authLimiterFor('/api/users/me'), null);
  assert.equal(authLimiterFor('/api/users/x/../me'), null);
});

test('marque de mot de passe — par compte, sans interférence entre comptes d’une mise à jour groupée', () => {
  const { markPasswordChange, hasPasswordChange, clearPasswordChange } = require('../../lib/account-guards.js');
  const context = {};
  // Comptes traités en parallèle : beforeChange de chacun, puis leurs afterChange
  markPasswordChange(context, 1);
  markPasswordChange(context, '2');
  assert.equal(hasPasswordChange(context, '1'), true);
  clearPasswordChange(context, 1); // révocation du premier compte
  assert.equal(hasPasswordChange(context, 1), false);
  assert.equal(hasPasswordChange(context, 2), true, 'second compte toujours marqué');
  clearPasswordChange(context, 2);
  assert.equal(hasPasswordChange(context, 2), false);
  // Contexte absent ou identifiant inconnu : aucune marque, aucune exception
  assert.equal(hasPasswordChange(undefined, 1), false);
  markPasswordChange(context, undefined);
  assert.equal(hasPasswordChange(context, undefined), false);
  clearPasswordChange(null, 1);
});

test('loginFailureReason — compte verrouillé ou identifiants', () => {
  const { loginFailureReason } = require('../../lib/account-guards.js');
  const locked = 'This user is locked due to having too many failed login attempts.';
  assert.equal(loginFailureReason({ status: 401, message: locked }, locked), 'verrouille');
  assert.equal(loginFailureReason({ status: 401, message: 'The email or password provided is incorrect.' }, locked), 'identifiants');
  // Message de verrouillage inconnu (traduction absente) : jamais « verrouille » par défaut
  assert.equal(loginFailureReason({ status: 401, message: locked }, undefined), 'identifiants');
  assert.equal(loginFailureReason(null, locked), 'identifiants');
});
