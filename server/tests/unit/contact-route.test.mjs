import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// POST /api/contact/:slug monté comme dans express-app.js (limiteur, parsing du corps,
// route, gestionnaire d'erreurs), sans base : magasin de sites JSON temporaire avec le
// site « demo » ; enregistrement des messages et propriétaires remplacés AVANT le
// chargement de la route (elle les lit à son chargement).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-route-'));
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, JSON.stringify([{ slug: 'demo', name: 'Demo', domain: 'demo.example' }]));
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const saved = [];
require('../../services/submissions.js').saveSubmission = async (slug, data) => { saved.push({ slug, data }); };
require('../../services/sites.js').getSiteOwners = async () => [];

const express = require('express');
const http = require('../../core/http.js');
const publicRouter = require('../../routes/public.js');

const app = express();
app.use('/api/contact', http.limiters.contact);
app.use(http.jsonBodyForExpressRoutes);
app.use(publicRouter);
app.use(http.jsonErrorHandler);

let server;
let base;
const quietLog = console.log;
before(async () => {
  console.log = () => {}; // message sans propriétaire écrit dans les logs : silencieux ici
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  console.log = quietLog;
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const postJson = (slug, body) => fetch(`${base}/api/contact/${slug}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
});
const postForm = (query, body) => fetch(`${base}/api/contact/demo${query}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

const VALID = { name: 'Jean', email: 'jean@exemple.fr', message: 'Bonjour' };

test('JSON — site inconnu : 404 avec le code unknown_site', async () => {
  const res = await postJson('inconnu', VALID);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Site inconnu.', code: 'unknown_site' });
});

test('JSON — champs invalides : 400 invalid_fields avec la liste des champs', async () => {
  const empty = await postJson('demo', {});
  assert.equal(empty.status, 400);
  const body = await empty.json();
  assert.equal(body.code, 'invalid_fields');
  assert.deepEqual(body.fields, ['name', 'email', 'message']);
  assert.equal(body.error, 'Nom, email valide et message sont requis.');

  const email = await postJson('demo', { ...VALID, email: 'a@b' });
  assert.equal(email.status, 400);
  assert.deepEqual((await email.json()).fields, ['email']);
  assert.equal(saved.length, 0);
});

test('JSON — corps de 64 Ko : 413 too_large', async () => {
  const res = await postJson('demo', { ...VALID, message: 'x'.repeat(64 * 1024) });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, 'too_large');
});

test('sans JavaScript — erreur dans la langue du formulaire (?lang=en)', async () => {
  const res = await postForm('?lang=en', { name: '', email: 'x', message: '' });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Name, a valid email address and a message are required\./);
  assert.match(html, /Message not sent/);
});

test('sans JavaScript — succès traduit ; langue absente ou inconnue : français', async () => {
  const en = await postForm('?lang=en', VALID);
  assert.equal(en.status, 200);
  const enHtml = await en.text();
  assert.match(enHtml, /<html lang="en">/);
  assert.match(enHtml, /Thank you!/);

  for (const query of ['', '?lang=xx']) {
    const fr = await postForm(query, { ...VALID, phone: '0600000000', slot: 'mardi' });
    assert.equal(fr.status, 200);
    const html = await fr.text();
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /Merci !/);
    assert.match(html, /demande de rendez-vous/); // reconnue à ses champs
  }
  assert.equal(saved.length, 3);
  // Le lien de retour (page d'origine) est traduit
  const back = await fetch(`${base}/api/contact/demo?lang=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://demo.example/en/' },
    body: new URLSearchParams(VALID).toString(),
  });
  assert.match(await back.text(), /<a href="https:\/\/demo\.example\/en\/">← Back to the site<\/a>/);
});

// EN DERNIER : épuise le budget du limiteur (10 envois par fenêtre et par IP)
test('limiteur — JSON 429 rate_limited, puis page HTML traduite', async () => {
  let res;
  for (let i = 0; i < 12; i++) {
    res = await postJson('demo', {});
    if (res.status === 429) break;
  }
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.code, 'rate_limited');
  assert.equal(body.error, 'Trop de messages envoyés. Réessayez dans quelques minutes.');

  const form = await postForm('?lang=en', VALID);
  assert.equal(form.status, 429);
  const html = await form.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Too many messages sent/);
});
