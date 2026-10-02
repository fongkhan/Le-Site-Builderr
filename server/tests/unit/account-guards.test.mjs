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
