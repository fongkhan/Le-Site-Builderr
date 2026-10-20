import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// POST /api/contact/:slug : le contenu d'un message (nom, email, texte) n'est jamais écrit
// dans les logs du serveur, qui échappent à la rétention de 12 mois annoncée par la
// politique de confidentialité des sites. Enregistrement, propriétaires et envoi d'email
// simulés, remplacés AVANT le chargement de la route (elle les lit à son chargement).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-logs-'));
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, JSON.stringify([{ slug: 'demo', name: 'Demo', domain: 'demo.example' }]));
require('../../sites-store.js').init({ getPayload: () => null, sitesFile });

const scenario = { stored: true, owners: [], mailFails: false };
const mails = [];
require('../../services/submissions.js').saveSubmission = async () => {
  if (!scenario.stored) throw new Error('base indisponible');
};
require('../../services/sites.js').getSiteOwners = async () => scenario.owners;
require('../../core/mail.js').sendMail = async (to, subject, text) => {
  if (scenario.mailFails) throw new Error('SMTP indisponible');
  mails.push({ to, text });
};

const express = require('express');
const http = require('../../core/http.js');
const publicRouter = require('../../routes/public.js');

const app = express();
app.use(http.jsonBodyForExpressRoutes);
app.use(publicRouter);
app.use(http.jsonErrorHandler);

// Sorties console capturées pendant les envois
const logs = [];
const METHODS = ['log', 'info', 'warn', 'error'];
const originals = Object.fromEntries(METHODS.map((m) => [m, console[m]]));
let server;
let base;
before(async () => {
  for (const m of METHODS) console[m] = (...args) => logs.push(args.map(String).join(' '));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  for (const m of METHODS) console[m] = originals[m];
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MESSAGE = { name: 'Nom-Visiteur-Secret', email: 'visiteur.secret@exemple.fr', message: 'Contenu confidentiel du message' };
const SECRETS = [MESSAGE.name, MESSAGE.email, MESSAGE.message];

async function send(next) {
  Object.assign(scenario, next);
  logs.length = 0;
  mails.length = 0;
  const res = await fetch(`${base}/api/contact/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(MESSAGE),
  });
  const leaks = logs.filter((line) => SECRETS.some((s) => line.includes(s)));
  return { status: res.status, body: await res.json(), leaks, logs: [...logs] };
}

test('aucun propriétaire, message enregistré : succès, journal limité au site et à l’heure', async () => {
  const out = await send({ stored: true, owners: [], mailFails: false });
  assert.equal(out.status, 200);
  assert.deepEqual(out.leaks, []);
  assert.ok(out.logs.some((l) => /« demo » reçu le \d{4}-\d\d-\d\dT[\d:.]+Z \(aucun propriétaire rattaché\)/.test(l)), out.logs.join('\n'));
});

test('email en échec, message enregistré : succès, contenu absent des logs', async () => {
  const out = await send({ stored: true, owners: ['proprietaire@exemple.fr'], mailFails: true });
  assert.equal(out.status, 200);
  assert.deepEqual(out.leaks, []);
  assert.ok(out.logs.some((l) => /Email pour « demo » non envoyé/.test(l)));
  assert.ok(!out.logs.some((l) => /aucun propriétaire/.test(l)));
});

test('email envoyé : contenu transmis au propriétaire, jamais aux logs', async () => {
  const out = await send({ stored: true, owners: ['proprietaire@exemple.fr'], mailFails: false });
  assert.equal(out.status, 200);
  assert.equal(mails.length, 1);
  assert.match(mails[0].text, /Contenu confidentiel du message/);
  assert.deepEqual(out.leaks, []);
});

test('ni enregistré ni envoyé (aucun propriétaire ou email en échec) : échec signalé au visiteur, rien dans les logs', async () => {
  for (const next of [{ stored: false, owners: [], mailFails: false }, { stored: false, owners: ['proprietaire@exemple.fr'], mailFails: true }]) {
    const out = await send(next);
    assert.equal(out.status, 500, JSON.stringify(next));
    assert.equal(out.body.code, 'send_failed');
    assert.deepEqual(out.leaks, [], JSON.stringify(next));
  }
});
