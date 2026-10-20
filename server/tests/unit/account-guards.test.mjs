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

test('loginFailureReason — compte verrouillé ou identifiants', () => {
  const { loginFailureReason } = require('../../lib/account-guards.js');
  const locked = 'This user is locked due to having too many failed login attempts.';
  assert.equal(loginFailureReason({ status: 401, message: locked }, locked), 'verrouille');
  assert.equal(loginFailureReason({ status: 401, message: 'The email or password provided is incorrect.' }, locked), 'identifiants');
  // Message de verrouillage inconnu (traduction absente) : jamais « verrouille » par défaut
  assert.equal(loginFailureReason({ status: 401, message: locked }, undefined), 'identifiants');
  assert.equal(loginFailureReason(null, locked), 'identifiants');
});
