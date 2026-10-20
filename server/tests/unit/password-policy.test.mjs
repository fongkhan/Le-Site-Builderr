import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkPassword } = require('../../lib/password-policy.js');

test('checkPassword — trop court ou trop long refusé', () => {
  assert.match(checkPassword('abc'), /12 caractères/);
  assert.match(checkPassword(''), /12 caractères/);
  assert.match(checkPassword(undefined), /12 caractères/);
  assert.match(checkPassword('a'.repeat(257)), /256/);
  assert.equal(checkPassword('Ab-1'.repeat(64)), null);
});

test('checkPassword — mot de passe courant refusé (insensible à la casse)', () => {
  assert.notEqual(checkPassword('password123'), null); // 11 caractères : trop court
  assert.match(checkPassword('motdepasse123'), /courant/);
  assert.match(checkPassword('AZERTYUIOP12'), /courant/);
  assert.match(checkPassword('Password1234'), /courant/);
});

test("checkPassword — identique à l'email ou à sa partie locale refusé", () => {
  const email = 'jean.dupont-1990@exemple.fr';
  assert.match(checkPassword(email, { email }), /email/);
  assert.match(checkPassword('JEAN.DUPONT-1990', { email }), /email/);
});

test('checkPassword — mot de passe robuste accepté', () => {
  assert.equal(checkPassword('Cheval-Correct-42!', { email: 'jean@exemple.fr' }), null);
  assert.equal(checkPassword('Cheval-Correct-42!'), null);
});
