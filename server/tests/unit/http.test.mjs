import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isExpressRoute } = require('../../core/http.js');

test('isExpressRoute — routes Express custom (corps JSON parsé)', () => {
  for (const p of ['/api/sites', '/api/sites/mon-site/export', '/api/site-pages', '/api/theme', '/webhook/rebuild', '/internal/site-pages', '/api/contact/x', '/api/admin/backups']) {
    assert.equal(isExpressRoute(p), true, p);
  }
});

test('isExpressRoute — routes déléguées à Next/Payload (flux intact)', () => {
  for (const p of ['/api/users/login', '/api/users/me', '/api/media', '/admin', '/', '/api/sitesx', '/api/themes']) {
    assert.equal(isExpressRoute(p), false, p);
  }
});

test('isPublicRoute — seuls le contact et le beacon sont publics', async () => {
  const { isPublicRoute } = require('../../core/http.js');
  assert.equal(isPublicRoute('/api/contact/mon-site'), true);
  assert.equal(isPublicRoute('/api/stats/hit/mon-site'), true);
  assert.equal(isPublicRoute('/api/sites/mon-site/stats'), false);
  assert.equal(isPublicRoute('/api/stats'), false);
  assert.equal(isPublicRoute('/api/contactx'), false);
});

test('trustProxySetting — désactivation explicite et valeurs Express', () => {
  const { trustProxySetting } = require('../../core/http.js');
  for (const off of [undefined, '', 'false', '0', '  ']) assert.equal(trustProxySetting(off), null, String(off));
  assert.equal(trustProxySetting('1'), 1);
  assert.equal(trustProxySetting('2'), 2);
  assert.equal(trustProxySetting('true'), 1);
  assert.equal(trustProxySetting('loopback'), 'loopback');
});

test('asyncHandler — une promesse rejetée est transmise à next()', async () => {
  const { asyncHandler } = require('../../core/http.js');
  const boom = new Error('boom');
  const received = await new Promise((resolve) => {
    asyncHandler(async () => { throw boom; })({}, {}, resolve);
  });
  assert.equal(received, boom);
  const errMw = (err, req, res, next) => next(err);
  assert.equal(asyncHandler(errMw), errMw); // middlewares d'erreur inchangés
});

test('jsonLimitFor — limite du corps JSON par méthode et par route', () => {
  const { jsonLimitFor } = require('../../core/http.js');
  assert.equal(jsonLimitFor('GET', '/api/site-pages'), null);
  assert.equal(jsonLimitFor('DELETE', '/api/sites/demo'), null);
  assert.equal(jsonLimitFor('HEAD', '/api/sites'), null);
  assert.equal(jsonLimitFor('OPTIONS', '/api/onboard'), null);
  assert.equal(jsonLimitFor('POST', '/api/onboard'), '10mb');
  assert.equal(jsonLimitFor('POST', '/api/site-pages'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/site-posts'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/theme'), '2mb');
  assert.equal(jsonLimitFor('POST', '/api/sites'), '256kb');
  assert.equal(jsonLimitFor('PUT', '/api/sites/demo'), '256kb');
  assert.equal(jsonLimitFor('POST', '/api/onboardx'), '256kb');
});

test('authLimiterFor — limiteurs de login et de réinitialisation, quelle que soit la forme du chemin', () => {
  const { authLimiterFor } = require('../../core/http.js');
  for (const p of ['/api/users/login', '/api/users/login/', '/api/users/LOGIN', '/api/users/%6Cogin', '/api/%75sers/login', '/api//users/login', '/api/users/login?x=1']) {
    assert.equal(authLimiterFor(p), 'login', p);
  }
  for (const p of ['/api/users/forgot-password', '/api/users/forgot-p%61ssword', '/api/users/RESET-PASSWORD', '/api/users/reset-password/']) {
    assert.equal(authLimiterFor(p), 'passwordReset', p);
  }
  for (const p of ['/api/users/me', '/api/onboard', '/api/sites', '/api/users/loginx', '/api/users/%E0%A4%A']) {
    assert.equal(authLimiterFor(p), null, p);
  }
});

// Traitement contrôlé de l'extérieur (fin de l'opération Payload simulée)
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));
const fakeReq = () => ({ socket: { destroyed: false } });

test('concurrencyGate — au plus N traitements à la fois, place tenue jusqu’à leur fin', async () => {
  const { concurrencyGate } = require('../../core/http.js');
  const gate = concurrencyGate(2);
  const started = [];
  const tasks = Array.from({ length: 4 }, () => deferred());
  const results = tasks.map((d, i) => gate(fakeReq(), () => { started.push(i); return d.promise; }));
  await tick();
  assert.deepEqual(started, [0, 1]);
  tasks[0].resolve('a');
  assert.equal(await results[0], 'a', 'résultat du traitement renvoyé');
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  tasks[1].reject(new Error('échec'));
  await assert.rejects(results[1], /échec/);
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3], 'un échec libère aussi sa place');
  tasks[2].resolve();
  tasks[3].resolve();
  await Promise.all([results[2], results[3]]);
});

test('concurrencyGate — client parti : place conservée tant que le traitement continue', async () => {
  const { concurrencyGate } = require('../../core/http.js');
  const gate = concurrencyGate(1);
  const started = [];
  const first = deferred();
  const req = fakeReq();
  const done = gate(req, () => { started.push('a'); return first.promise; });
  gate(fakeReq(), () => { started.push('b'); });
  req.socket.destroyed = true; // déconnexion : l'opération Payload, elle, se poursuit
  await tick();
  assert.deepEqual(started, ['a'], 'aucune seconde opération lancée pendant la première');
  first.resolve();
  await done;
  await tick();
  assert.deepEqual(started, ['a', 'b']);
});

test('concurrencyGate — requête fermée pendant l’attente : jamais lancée, aucune place perdue', async () => {
  const { concurrencyGate } = require('../../core/http.js');
  const gate = concurrencyGate(1);
  const started = [];
  const first = deferred();
  gate(fakeReq(), () => { started.push('a'); return first.promise; });
  const gone = fakeReq();
  const skipped = gate(gone, () => { started.push('b'); });
  gate(fakeReq(), () => { started.push('c'); throw new Error('synchrone'); }).catch(() => started.push('c rejetée'));
  gone.socket.destroyed = true;
  first.resolve();
  await skipped;
  await tick();
  await tick();
  assert.deepEqual(started, ['a', 'c', 'c rejetée']);
  const last = gate(fakeReq(), () => 'd');
  assert.equal(await last, 'd', 'place libérée après une exception synchrone');
});

test('isForgotPasswordPath — chemin canonique, quelle que soit sa forme', () => {
  const { isForgotPasswordPath } = require('../../core/http.js');
  for (const p of ['/api/users/forgot-password', '/api/users/%2e/forgot-password', '/api/users/FORGOT-PASSWORD/', '/api/users//forgot-password']) {
    assert.equal(isForgotPasswordPath(p), true, p);
  }
  for (const p of ['/api/users/login', '/api/users/reset-password', '/api/users/forgot-passwordx']) {
    assert.equal(isForgotPasswordPath(p), false, p);
  }
});
