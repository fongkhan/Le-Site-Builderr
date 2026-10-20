import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Processus dédié (node --test isole chaque fichier) : compteurs des limiteurs neufs.
// Valeurs par défaut des plafonds : 8 échecs de login, 10 demandes de réinitialisation.
delete process.env.RL_LOGIN_MAX;
delete process.env.RL_PASSWORD_RESET_MAX;

const require = createRequire(import.meta.url);
const express = require('express');
const { mountRateLimits } = require('../../core/http.js');

let server;
let base;

before(async () => {
  const app = express();
  mountRateLimits(app);
  // Stand-in de Next/Payload : login toujours refusé, réinitialisation acceptée
  app.all('*', (req, res) => {
    if (/forgot|reset/i.test(decodeURIComponent(req.path))) return res.status(200).json({ ok: true });
    res.status(401).json({ errors: [{ message: 'refusé' }] });
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path) => fetch(`${base}${path}`, { method: 'POST' }).then((r) => r.status);

test('login : chemin encodé (/api/users/%6Cogin) limité comme le chemin canonique', async () => {
  const statuses = [];
  for (let i = 0; i < 9; i++) statuses.push(await post('/api/users/%6Cogin'));
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
  assert.equal(statuses[8], 429);
  // Même compteur pour toutes les formes du chemin
  assert.equal(await post('/api/users/LOGIN'), 429);
  assert.equal(await post('/api/users/login'), 429);
});

test('mot de passe oublié : chemin encodé limité (11e demande refusée)', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push(await post('/api/users/forgot-p%61ssword'));
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
  assert.equal(await post('/api/users/RESET-PASSWORD'), 429);
});

test('routes non concernées : jamais limitées par ces compteurs', async () => {
  assert.equal(await post('/api/users/me'), 401);
});
