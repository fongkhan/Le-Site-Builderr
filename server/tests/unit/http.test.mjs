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

test('bodyReceived — corps complet, annoncé trop gros, reçu plus tard, connexion fermée', async () => {
  const { bodyReceived } = require('../../core/http.js');
  const req = (over = {}) => ({ headers: {}, complete: false, readableLength: 0, socket: { destroyed: false }, ...over });
  assert.equal(await bodyReceived(req({ complete: true }), 100), true);
  assert.equal(await bodyReceived(req({ headers: { 'content-length': '101' } }), 100), false);
  const later = req({ headers: { 'content-length': '10' } });
  const pending = bodyReceived(later, 100, 5);
  setTimeout(() => { later.complete = true; }, 20);
  assert.equal(await pending, true);
  const closed = req();
  const waiting = bodyReceived(closed, 100, 5);
  setTimeout(() => { closed.socket.destroyed = true; }, 20);
  assert.equal(await waiting, false);
  const chunked = req();
  const growing = bodyReceived(chunked, 100, 5);
  setTimeout(() => { chunked.readableLength = 101; }, 20);
  assert.equal(await growing, false, 'corps sans longueur annoncée dépassant la limite');
});

test('runForgotPassword — corps trop gros : 413 sans traitement', async () => {
  const { runForgotPassword } = require('../../core/http.js');
  const sent = {};
  const res = {
    headersSent: false,
    status(code) { sent.status = code; return this; },
    set(name, value) { sent[name] = value; return this; },
    json(body) { sent.body = body; return this; },
  };
  let ran = false;
  await runForgotPassword({ headers: { 'content-length': String(64 * 1024) }, socket: { destroyed: false } }, res, () => { ran = true; });
  assert.equal(ran, false);
  assert.equal(sent.status, 413);
  assert.equal(sent.Connection, 'close');
  assert.equal(await runForgotPassword({ headers: {}, complete: true, socket: { destroyed: false } }, res, () => 'traité'), 'traité');
});

test('concurrencyGate — release() libère la place avant la fin du traitement, une seule fois', async () => {
  const { concurrencyGate } = require('../../core/http.js');
  const gate = concurrencyGate(1);
  const started = [];
  const never = new Promise(() => {}); // promesse jamais résolue (réponse pipelinée orpheline)
  let releaseFirst;
  gate(fakeReq(), (release) => { started.push('a'); releaseFirst = release; return never; });
  const second = deferred();
  gate(fakeReq(), () => { started.push('b'); return second.promise; });
  gate(fakeReq(), () => { started.push('c'); });
  await tick();
  assert.deepEqual(started, ['a']);
  releaseFirst();
  releaseFirst();
  await tick();
  assert.deepEqual(started, ['a', 'b'], 'un double release ne libère qu’une place');
  second.resolve();
  await tick();
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('runForgotPassword — place libérée à la fin de la réponse (res.end), promesse de Next en suspens', async () => {
  const { runForgotPassword } = require('../../core/http.js');
  const req = () => ({ headers: {}, complete: true, socket: { destroyed: false } });
  const makeRes = () => ({ headersSent: false, ended: false, end() { this.ended = true; return this; } });
  const responses = [makeRes(), makeRes(), makeRes()];
  const started = [];
  // Deux réponses terminées mais jamais envoyées : la promesse du gestionnaire ne se résout pas
  for (const i of [0, 1]) runForgotPassword(req(), responses[i], () => { started.push(i); return new Promise(() => {}); });
  const third = runForgotPassword(req(), responses[2], () => { started.push(2); return 'ok'; });
  await tick();
  assert.deepEqual(started, [0, 1]);
  responses[0].end();
  assert.equal(responses[0].ended, true, 'res.end d’origine toujours appelé');
  assert.equal(await third, 'ok');
  assert.deepEqual(started, [0, 1, 2]);
});

test('runForgotPassword — opération attendue par l’arrêt propre jusqu’à sa fin, même client parti', async () => {
  const { runForgotPassword } = require('../../core/http.js');
  const shutdown = require('../../core/shutdown.js');
  const before = shutdown.pendingBackground();
  const req = () => ({ headers: {}, complete: true, socket: { destroyed: false } });
  const res = { headersSent: false, end() { return this; } };
  const op = deferred();
  const running = runForgotPassword(req(), res, () => op.promise);
  await tick();
  assert.equal(shutdown.pendingBackground(), before + 1, 'inscrite pendant l’opération');
  op.resolve();
  await running;
  await tick();
  assert.equal(shutdown.pendingBackground(), before, 'retirée à la fin de l’opération');
  // Exception synchrone du gestionnaire : jamais de tâche de fond orpheline
  await assert.rejects(runForgotPassword(req(), { headersSent: false, end() {} }, () => { throw new Error('boom'); }), /boom/);
  await tick();
  assert.equal(shutdown.pendingBackground(), before);
  // Réponse terminée mais jamais envoyée (promesse en suspens) : retirée à res.end
  const orphan = { headersSent: false, end() { return this; } };
  runForgotPassword(req(), orphan, () => new Promise(() => {}));
  await tick();
  assert.equal(shutdown.pendingBackground(), before + 1);
  orphan.end();
  await tick();
  assert.equal(shutdown.pendingBackground(), before);
});
