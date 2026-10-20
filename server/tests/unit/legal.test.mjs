import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as tpl from '../../../client-template/src/lib/legal.mjs';
import { LEGAL_TEXTS, lt } from '../../../client-template/src/lib/legal-texts.mjs';
import { LOCALES, DEFAULT_LOCALE } from '../../../client-template/src/lib/i18n.mjs';

const require = createRequire(import.meta.url);
const legal = require('../../lib/legal.js');
const { ROUTE_SLUG_RE } = require('../../lib/i18n.js');

const FULL = {
  companyName: 'Boulangerie Martin',
  legalForm: 'SARL au capital de 5 000 €',
  address: '1 rue du Pain\n75001 Paris',
  registration: 'RCS Paris 123 456 789',
  vatNumber: 'FR12345678901',
  phone: '01 23 45 67 89',
  email: 'contact@boulangerie.example',
  publisherName: 'Jeanne Martin',
  hostName: 'Hébergeur',
  hostAddress: '2 avenue des Serveurs\n69000 Lyon',
  hostPhone: '+33 (0)4 00 00 00 00',
};

// ---- Serveur : validation de la saisie (PUT /api/sites/:slug/legal) ----

test('validateLegal — objet valide nettoyé (retours à la ligne gardés seulement en multiligne)', () => {
  const r = legal.validateLegal({ ...FULL, companyName: '  Boulangerie\r\nMartin\u0007 ', address: ' 1 rue du Pain\r\n75001 Paris ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.companyName, 'Boulangerie Martin');
  assert.equal(r.value.address, '1 rue du Pain\n75001 Paris');
  assert.deepEqual(Object.keys(r.value), legal.LEGAL_KEYS);
});

test('validateLegal — null et clé absente donnent une chaîne vide', () => {
  const r = legal.validateLegal({ companyName: null, phone: '' });
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.value).length, 11);
  for (const key of legal.LEGAL_KEYS) assert.equal(r.value[key], '', key);
});

test('validateLegal — refus avec le champ en cause', () => {
  const cases = [
    [{ documentRoot: '/etc' }, 'documentRoot', /Champ inconnu : « documentRoot »/],
    [{ companyName: { $ne: 1 } }, 'companyName', /« Raison sociale ou nom de l'éditeur » : texte attendu/],
    [{ phone: 612345678 }, 'phone', /texte attendu/],
    [{ companyName: 'x'.repeat(201) }, 'companyName', /« Raison sociale ou nom de l'éditeur » : 200 caractères maximum/],
    [{ email: 'pas-un-email' }, 'email', /Email de contact invalide/],
    [{ phone: 'abc' }, 'phone', /« Téléphone » : numéro de téléphone invalide/],
    [{ hostPhone: '12 34' }, 'hostPhone', /« Téléphone de l'hébergeur » : numéro de téléphone invalide/],
  ];
  for (const [body, field, message] of cases) {
    const r = legal.validateLegal(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.field, field);
    assert.match(r.error, message);
  }
  // Longueur mesurée avant troncature, après nettoyage : 200 caractères acceptés
  assert.equal(legal.validateLegal({ companyName: `  ${'x'.repeat(200)}  ` }).ok, true);
});

test('validateLegal — corps non objet refusé', () => {
  for (const body of [null, [], 'texte', 42, undefined]) {
    const r = legal.validateLegal(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.error, 'Corps de requête invalide : objet attendu.');
  }
  // Clé « __proto__ » d'un JSON : propriété propre, refusée comme champ inconnu
  const proto = legal.validateLegal(JSON.parse('{"__proto__": {"x": 1}}'));
  assert.equal(proto.ok, false);
  assert.equal(proto.field, '__proto__');
});

test('normalizeLegal — toujours les 11 clés, valeurs non textuelles vidées, bornées', () => {
  assert.deepEqual(Object.keys(legal.normalizeLegal(undefined)), legal.LEGAL_KEYS);
  const n = legal.normalizeLegal({ companyName: 42, address: 'a\r\nb', phone: 'x'.repeat(100), inconnu: 'y' });
  assert.equal(n.companyName, '');
  assert.equal(n.address, 'a\nb');
  assert.equal(n.phone.length, 40);
  assert.ok(!('inconnu' in n));
});

test('hostDefaultsFromEnv, effectiveLegal — hébergeur vide : valeur du serveur', () => {
  const env = { LEGAL_HOST_NAME: ' o2switch ', LEGAL_HOST_ADDRESS: 'Chemin des Pardiaux\n63000 Clermont-Ferrand', LEGAL_HOST_PHONE: '04 44 44 60 40' };
  const defaults = legal.hostDefaultsFromEnv(env);
  assert.deepEqual(defaults, { hostName: 'o2switch', hostAddress: 'Chemin des Pardiaux\n63000 Clermont-Ferrand', hostPhone: '04 44 44 60 40' });
  assert.deepEqual(legal.hostDefaultsFromEnv({}), { hostName: '', hostAddress: '', hostPhone: '' });
  const eff = legal.effectiveLegal({ ...FULL, hostName: '', hostPhone: '' }, defaults);
  assert.equal(eff.hostName, 'o2switch');
  assert.equal(eff.hostAddress, FULL.hostAddress); // saisie conservée
  assert.equal(eff.hostPhone, '04 44 44 60 40');
});

test('missingLegalFields — champs obligatoires vides, dans l’ordre des champs', () => {
  assert.deepEqual(legal.missingLegalFields(legal.normalizeLegal({})), ['companyName', 'address', 'phone', 'email', 'publisherName', 'hostName', 'hostAddress', 'hostPhone']);
  assert.deepEqual(legal.missingLegalFields(FULL), []);
  assert.deepEqual(legal.missingLegalFields({ ...FULL, hostPhone: ' ', companyName: '' }), ['companyName', 'hostPhone']);
});

test('retentionMonthsFrom — 365 jours = 12 mois, minimum 1', () => {
  assert.equal(legal.retentionMonthsFrom(365), 12);
  assert.equal(legal.retentionMonthsFrom(30), 1);
  assert.equal(legal.retentionMonthsFrom(0), 1);
  assert.equal(legal.retentionMonthsFrom(730), 24);
});

test('legalView — saisie, hébergeur par défaut, manques après repli', () => {
  const view = legal.legalView({ ...FULL, hostName: '', hostAddress: '', hostPhone: '' }, { env: { LEGAL_HOST_NAME: 'Hôte' }, retentionDays: 365 });
  assert.equal(view.legal.hostName, '');
  assert.equal(view.hostDefaults.hostName, 'Hôte');
  assert.deepEqual(view.missing, ['hostAddress', 'hostPhone']);
  assert.equal(view.retentionMonths, 12);
});

test('legalBuildData — données du build : 11 champs + rétention, statistiques, mesure d’audience', () => {
  const keys = [...legal.LEGAL_KEYS, 'retentionMonths', 'visitStats', 'analyticsProvider', 'analyticsHost'].sort();
  const ga4 = legal.legalBuildData({ name: 'X', legal: FULL, analyticsProvider: 'ga4', analyticsId: 'G-1234', analyticsHost: 'ignore.example' }, { env: {}, retentionDays: 365 });
  assert.deepEqual(Object.keys(ga4).sort(), keys);
  assert.equal(ga4.analyticsProvider, 'ga4');
  assert.equal(ga4.analyticsHost, '');
  assert.equal(ga4.visitStats, true);
  assert.equal(ga4.retentionMonths, 12);
  const matomo = legal.legalBuildData({ legal: {}, analyticsProvider: 'matomo', analyticsHost: 'stats.example.fr' }, { env: { LEGAL_HOST_NAME: 'Hôte' }, retentionDays: 365 });
  assert.equal(matomo.analyticsHost, 'stats.example.fr');
  assert.equal(matomo.hostName, 'Hôte');
  assert.equal(legal.legalBuildData({ analyticsProvider: 'evil' }, { env: {}, retentionDays: 365 }).analyticsProvider, '');
  // Aller-retour JSON (PUBLIC_LEGAL_JSON) puis lecture par le template : mêmes valeurs
  const parsed = tpl.parseLegalInfo(JSON.stringify(ga4));
  assert.deepEqual(parsed, ga4);
});

// ---- Parité serveur / template / orchestrateur ----

test('LEGAL_FIELDS — mêmes clés, longueurs et champs obligatoires côté template', () => {
  const pick = (f) => ({ key: f.key, max: f.max, required: Boolean(f.required) });
  assert.deepEqual(tpl.LEGAL_FIELDS.map(pick), legal.LEGAL_FIELDS.map(pick));
  assert.deepEqual(legal.HOST_FIELDS, ['hostName', 'hostAddress', 'hostPhone']);
});

test('payload.config.ts — group « legal » de payload_sites avec les 11 champs', () => {
  const source = fs.readFileSync(new URL('../../payload.config.ts', import.meta.url), 'utf-8');
  const start = source.indexOf("name: 'legal'");
  assert.ok(start > source.indexOf("slug: 'payload_sites'") && start < source.indexOf("slug: 'pages'"), 'group legal hors de payload_sites');
  const block = source.slice(start, source.indexOf("slug: 'pages'"));
  assert.match(block, /type: 'group'/);
  for (const f of legal.LEGAL_FIELDS) {
    assert.match(block, new RegExp(`name: '${f.key}', type: '(text|textarea)', maxLength: ${f.max},`), f.key);
  }
});

test('orchestrateur — legalModel.ts déclare les 4 adresses générées et les 11 champs', () => {
  const source = fs.readFileSync(new URL('../../../orchestrator/src/features/legal/legalModel.ts', import.meta.url), 'utf-8');
  for (const slug of ['mentions-legales', 'confidentialite', 'legal-notice', 'privacy-policy']) assert.ok(source.includes(`'${slug}'`), slug);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of legal.LEGAL_FIELDS) {
    assert.match(source, new RegExp(`key: '${f.key}', label: ['"]${esc(f.label)}['"], max: ${f.max}, required: ${Boolean(f.required)}`), f.key);
  }
  for (const [locale, slugs] of Object.entries(tpl.LEGAL_SLUGS)) {
    for (const slug of Object.values(slugs)) assert.match(source, new RegExp(`locale: '${locale}', kind: '\\w+', slug: '${slug}'`), slug);
  }
});

// ---- Template : lecture des informations, adresses, sections ----

test('parseLegalInfo — JSON invalide : valeurs par défaut ; texte hostile conservé tel quel', () => {
  const def = tpl.parseLegalInfo('{pas du json');
  assert.equal(def.companyName, '');
  assert.equal(def.retentionMonths, 12);
  assert.equal(def.visitStats, false);
  assert.equal(def.analyticsProvider, '');
  assert.deepEqual(tpl.parseLegalInfo(undefined), def);
  assert.deepEqual(tpl.parseLegalInfo([]), def);
  const info = tpl.parseLegalInfo({ companyName: 'A & B <script>alert(1)</script>', address: 'l1\r\nl2', phone: 'a\nb' });
  assert.equal(info.companyName, 'A & B <script>alert(1)</script>');
  assert.equal(info.address, 'l1\nl2');
  assert.equal(info.phone, 'a b');
});

test('parseLegalInfo — rétention bornée, fournisseur en liste blanche, hôte réservé à Matomo', () => {
  assert.equal(tpl.parseLegalInfo({ retentionMonths: 0 }).retentionMonths, 12);
  assert.equal(tpl.parseLegalInfo({ retentionMonths: 500 }).retentionMonths, 120);
  assert.equal(tpl.parseLegalInfo({ retentionMonths: 6.4 }).retentionMonths, 6);
  assert.equal(tpl.parseLegalInfo({ retentionMonths: 'x' }).retentionMonths, 12);
  assert.equal(tpl.parseLegalInfo({ analyticsProvider: 'evil' }).analyticsProvider, '');
  assert.equal(tpl.parseLegalInfo({ analyticsProvider: 'ga4', analyticsHost: 'x.fr' }).analyticsHost, '');
  assert.equal(tpl.parseLegalInfo({ analyticsProvider: 'matomo', analyticsHost: 'stats.x.fr' }).analyticsHost, 'stats.x.fr');
  assert.equal(tpl.parseLegalInfo({ visitStats: 'true' }).visitStats, false);
  assert.equal(tpl.parseLegalInfo({ visitStats: true }).visitStats, true);
});

test('legalRoutes — langue par défaut toujours, langues servies en plus, adresse occupée non générée', () => {
  const fr = tpl.legalRoutes(['fr']);
  assert.deepEqual(fr.map((r) => r.route), ['mentions-legales', 'confidentialite']);
  assert.ok(fr.every((r) => r.generated && r.locale === 'fr'));
  const both = tpl.legalRoutes(['en', 'fr', 'en', 'de']);
  assert.deepEqual(both.map((r) => r.route), ['mentions-legales', 'confidentialite', 'en/legal-notice', 'en/privacy-policy']);
  assert.deepEqual(tpl.legalRoutes([]).map((r) => r.locale), ['fr', 'fr']);
  const taken = tpl.legalRoutes(['fr', 'en'], new Set(['mentions-legales', 'en/privacy-policy']));
  assert.deepEqual(taken.filter((r) => !r.generated).map((r) => r.route), ['mentions-legales', 'en/privacy-policy']);
});

test('LEGAL_SLUGS — chaque langue couverte, adresses valides et non réservées', () => {
  assert.deepEqual(Object.keys(tpl.LEGAL_SLUGS).sort(), [...LOCALES].sort());
  for (const slugs of Object.values(tpl.LEGAL_SLUGS)) {
    for (const slug of Object.values(slugs)) {
      assert.match(slug, ROUTE_SLUG_RE);
      assert.ok(!['blog', '404', 'media', ...LOCALES].includes(slug), slug);
    }
  }
});

test('legalHref — page de la langue, sinon de la langue par défaut, sinon vide', () => {
  const routes = tpl.legalRoutes(['fr', 'en']);
  assert.equal(tpl.legalHref(routes, 'en', 'notice'), '/en/legal-notice/');
  assert.equal(tpl.legalHref(routes, 'fr', 'privacy'), '/confidentialite/');
  const frOnly = tpl.legalRoutes(['fr']);
  assert.equal(tpl.legalHref(frOnly, 'en', 'privacy'), '/confidentialite/');
  assert.equal(tpl.legalHref(frOnly, 'xx', 'notice'), '/mentions-legales/');
  assert.equal(tpl.legalHref([], 'fr', 'notice'), '');
  // Page du CMS à la même adresse : le lien la cible quand même
  assert.equal(tpl.legalHref(tpl.legalRoutes(['fr'], new Set(['mentions-legales'])), DEFAULT_LOCALE, 'notice'), '/mentions-legales/');
});

test('noticeSections — brouillon : manques signalés ; publié : manques omis, nom du site en repli', () => {
  const info = tpl.parseLegalInfo({ ...FULL, companyName: '', vatNumber: '', publisherName: '', hostPhone: '' });
  const draft = tpl.noticeSections(info, { draft: true, siteName: 'Mon site' });
  const rows = Object.fromEntries(draft.flatMap((s) => s.rows.map((r) => [r.key, r])));
  assert.equal(rows.companyName.missing, true);
  assert.equal(rows.publisherName.missing, true);
  assert.equal(rows.hostPhone.missing, true);
  assert.ok(!('vatNumber' in rows), 'champ facultatif vide jamais affiché');
  assert.equal(rows.address.value, FULL.address);

  const published = tpl.noticeSections(info, { draft: false, siteName: 'Mon site' });
  assert.deepEqual(published.map((s) => s.section), ['publisher', 'host']); // directeur vide : section retirée
  const pubRows = published.flatMap((s) => s.rows);
  assert.ok(pubRows.every((r) => !r.missing));
  assert.equal(pubRows.find((r) => r.key === 'companyName').value, 'Mon site');
  assert.ok(!pubRows.some((r) => r.key === 'hostPhone'));
  assert.deepEqual(tpl.noticeSections(tpl.parseLegalInfo({}), { draft: false }), []);
});

test('privacySections — selon les formulaires, les statistiques et la mesure d’audience', () => {
  const base = tpl.parseLegalInfo({ ...FULL, visitStats: true });
  assert.deepEqual(tpl.privacySections(base, { formKinds: { contact: true } }), ['controller', 'forms', 'stats', 'cookies', 'rights', 'hosting']);
  assert.deepEqual(tpl.privacySections({ ...base, visitStats: false, hostName: '' }, { formKinds: {} }), ['controller', 'cookies', 'rights']);
  assert.deepEqual(tpl.privacySections({ ...base, analyticsProvider: 'matomo' }, { formKinds: { appointment: true } }), ['controller', 'forms', 'stats', 'analytics', 'rights', 'hosting']);
  assert.deepEqual(tpl.privacySections(base), ['controller', 'stats', 'cookies', 'rights', 'hosting']);
});

test('LEGAL_TEXTS — mêmes clés en fr et en, aucune valeur vide, un libellé par champ', () => {
  assert.deepEqual(Object.keys(LEGAL_TEXTS).sort(), [...LOCALES].sort());
  const reference = Object.keys(LEGAL_TEXTS.fr).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(LEGAL_TEXTS[locale]).sort(), reference, locale);
    for (const [key, value] of Object.entries(LEGAL_TEXTS[locale])) assert.ok(typeof value === 'string' && value.trim(), `${locale}.${key}`);
  }
  for (const f of tpl.LEGAL_FIELDS) assert.ok(Object.hasOwn(LEGAL_TEXTS.fr, `field_${f.key}`), f.key);
});

test('lt — langue demandée, repli sur le français puis sur la clé, marqueurs', () => {
  assert.equal(lt('en', 'legalNotice'), 'Legal notice');
  assert.equal(lt('de', 'legalNotice'), 'Mentions légales');
  assert.equal(lt('__proto__', 'legalNotice'), 'Mentions légales');
  assert.equal(lt('en', 'toString'), 'toString');
  assert.equal(lt('fr', 'formNotice', { months: 12 }), 'Les informations saisies servent uniquement à traiter votre demande et sont conservées 12 mois.');
  assert.match(lt('en', 'formNotice', { months: 6 }), /kept for 6 months\.$/);
  // Une valeur contenant un marqueur n'est pas réinterprétée
  assert.equal(lt('fr', 'privacyHostingText', { host: '{host}' }), 'Le site est hébergé par {host}.');
});
